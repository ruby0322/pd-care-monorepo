from __future__ import annotations
# pyright: reportMissingImports=false

from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event

from app.api.routes import copilot as copilot_routes
from app.db.models import CopilotModule
from app.services.copilot.sessions import copilot_proxy_rate_limiter
from tests.test_copilot_api import (
    assign,
    build_client,
    headers_for,
    seed_identity,
    seed_patient,
)


# A module that fetches what it shows at run time, through the bridge, under whichever
# viewer opened it. This is the shape a *shared* module has to have, so it is the default
# here; tests about the static shape pass `html=STATIC_HTML` explicitly.
LIVE_HTML = "<html><body><script>pdcare.query('list_patients', {});</script></body></html>"

# A self-contained report: its figures are literals baked in when it was saved, so every
# viewer sees the author's cohort rather than their own.
STATIC_HTML = "<html><body><table><tr><td>P#1</td><td>suspected</td></tr></table></body></html>"


def _create_module(client: TestClient, headers: dict[str, str], **overrides):
    payload = {
        "title": "每週感染趨勢",
        "description": "追蹤本週可疑病例",
        "html": LIVE_HTML,
        "visibility": "private",
    }
    payload.update(overrides)
    return client.post("/v1/copilot/modules", json=payload, headers=headers)


def test_owner_can_save_and_fetch_a_module(tmp_path: Path) -> None:
    with build_client(tmp_path, "module-save") as client:
        owner_id = seed_identity(client, line_user_id="U_OWNER", role="staff")
        headers = headers_for(client, owner_id, role="staff", line_user_id="U_OWNER")

        created = _create_module(client, headers, html="<html><body>Weekly</body></html>")
        assert created.status_code == 201
        body = created.json()
        assert body["html"] == "<html><body>Weekly</body></html>"
        assert body["title"] == "每週感染趨勢"
        assert body["is_owner"] is True
        assert body["can_write"] is True
        assert body["visibility"] == "private"
        module_id = body["module_id"]

        fetched = client.get(f"/v1/copilot/modules/{module_id}", headers=headers)
        assert fetched.status_code == 200
        fetched_body = fetched.json()
        assert fetched_body["title"] == "每週感染趨勢"
        assert fetched_body["html"] == "<html><body>Weekly</body></html>"

        listed = client.get("/v1/copilot/modules", headers=headers)
        assert listed.status_code == 200
        assert [item["module_id"] for item in listed.json()["items"]] == [module_id]


@pytest.mark.parametrize(
    ("visibility", "other_staff", "other_admin"),
    [("private", 404, 404), ("staff", 200, 200), ("admin", 404, 200)],
)
def test_module_visibility_matrix(
    tmp_path: Path, visibility: str, other_staff: int, other_admin: int
) -> None:
    with build_client(tmp_path, f"module-visibility-{visibility}") as client:
        owner_role = "admin" if visibility == "admin" else "staff"
        owner_id = seed_identity(client, line_user_id="U_OWNER", role=owner_role)
        other_staff_id = seed_identity(client, line_user_id="U_OTHER_STAFF", role="staff")
        other_admin_id = seed_identity(client, line_user_id="U_OTHER_ADMIN", role="admin")

        owner_headers = headers_for(client, owner_id, role=owner_role, line_user_id="U_OWNER")
        created = _create_module(client, owner_headers, visibility=visibility)
        assert created.status_code == 201
        module_id = created.json()["module_id"]

        assert client.get(f"/v1/copilot/modules/{module_id}", headers=owner_headers).status_code == 200
        assert (
            client.get(
                f"/v1/copilot/modules/{module_id}",
                headers=headers_for(client, other_staff_id, role="staff", line_user_id="U_OTHER_STAFF"),
            ).status_code
            == other_staff
        )
        assert (
            client.get(
                f"/v1/copilot/modules/{module_id}",
                headers=headers_for(client, other_admin_id, role="admin", line_user_id="U_OTHER_ADMIN"),
            ).status_code
            == other_admin
        )


def test_non_owner_cannot_patch_or_delete(tmp_path: Path) -> None:
    with build_client(tmp_path, "module-non-owner") as client:
        owner_id = seed_identity(client, line_user_id="U_OWNER", role="staff")
        other_id = seed_identity(client, line_user_id="U_OTHER", role="staff")
        owner_headers = headers_for(client, owner_id, role="staff", line_user_id="U_OWNER")
        other_headers = headers_for(client, other_id, role="staff", line_user_id="U_OTHER")

        created = _create_module(client, owner_headers, visibility="staff")
        assert created.status_code == 201
        module_id = created.json()["module_id"]

        # Visible (shared), but writes stay owner-only.
        assert client.get(f"/v1/copilot/modules/{module_id}", headers=other_headers).status_code == 200
        assert (
            client.patch(
                f"/v1/copilot/modules/{module_id}", json={"title": "改名"}, headers=other_headers
            ).status_code
            == 403
        )
        assert client.delete(f"/v1/copilot/modules/{module_id}", headers=other_headers).status_code == 403

        renamed = client.patch(
            f"/v1/copilot/modules/{module_id}", json={"title": "新標題"}, headers=owner_headers
        )
        assert renamed.status_code == 200
        assert renamed.json()["title"] == "新標題"
        # The list is ordered by `updated_at`, so an edit has to move the timestamp.
        assert renamed.json()["updated_at"] != created.json()["updated_at"]

        assert client.delete(f"/v1/copilot/modules/{module_id}", headers=owner_headers).status_code == 204
        assert client.get(f"/v1/copilot/modules/{module_id}", headers=owner_headers).status_code == 404


def test_staff_cannot_create_admin_visible_module(tmp_path: Path) -> None:
    with build_client(tmp_path, "module-admin-denied") as client:
        staff_id = seed_identity(client, line_user_id="U_STAFF", role="staff")
        headers = headers_for(client, staff_id, role="staff", line_user_id="U_STAFF")
        response = _create_module(client, headers, visibility="admin")
        assert response.status_code == 403


def test_module_survives_deletion_of_its_source_session(tmp_path: Path) -> None:
    """Deleting the source session must null the provenance column, not take the module.

    SQLite enforces foreign keys only when a connection asks it to, and the app never
    asks. Without the PRAGMA below the delete just leaves `source_session_id` dangling, so
    this test would pass identically against `ondelete="CASCADE"` -- which is the exact
    bug it exists to prevent, and which on Postgres would delete the module and turn the
    `200` here into a `404`. So enforcement is switched on for this engine, and the
    `SET NULL` itself is asserted rather than assumed.
    """
    with build_client(tmp_path, "module-source-session") as client:
        engine = client.app.state.db_engine

        @event.listens_for(engine, "connect")
        def _enforce_foreign_keys(dbapi_connection, _connection_record) -> None:  # pragma: no cover
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA foreign_keys = ON")
            cursor.close()

        # Connections opened before the listener existed are still pooled without the
        # pragma; drop them so every connection this test uses enforces.
        engine.dispose()
        with engine.connect() as connection:
            assert connection.exec_driver_sql("PRAGMA foreign_keys").scalar() == 1

        owner_id = seed_identity(client, line_user_id="U_OWNER", role="staff")
        headers = headers_for(client, owner_id, role="staff", line_user_id="U_OWNER")

        session_created = client.post("/v1/copilot/sessions", json={}, headers=headers)
        assert session_created.status_code == 201
        source_session_id = session_created.json()["session_id"]

        created = _create_module(client, headers, source_session_id=source_session_id)
        assert created.status_code == 201
        module_id = created.json()["module_id"]
        assert created.json()["source_session_id"] == source_session_id

        assert client.delete(f"/v1/copilot/sessions/{source_session_id}", headers=headers).status_code == 204

        fetched = client.get(f"/v1/copilot/modules/{module_id}", headers=headers)
        assert fetched.status_code == 200
        assert fetched.json()["html"] == LIVE_HTML
        # Provenance is gone, the module is not: `ON DELETE SET NULL`, observed.
        assert fetched.json()["source_session_id"] is None


def test_oversized_html_is_rejected(tmp_path: Path) -> None:
    with build_client(tmp_path, "module-oversized") as client:
        owner_id = seed_identity(client, line_user_id="U_OWNER", role="staff")
        headers = headers_for(client, owner_id, role="staff", line_user_id="U_OWNER")

        oversized_html = "<html>" + ("a" * (512 * 1024 + 1)) + "</html>"
        response = _create_module(client, headers, html=oversized_html)
        assert response.status_code == 422

        # A module within the limit is accepted, confirming the boundary, not just "big fails".
        within_limit_html = "<html>" + ("a" * (512 * 1024 - 100)) + "</html>"
        response = _create_module(client, headers, html=within_limit_html)
        assert response.status_code == 201


def test_a_private_module_may_hold_a_static_report(tmp_path: Path) -> None:
    """Nobody else can open a `private` module, so its inlined figures are the owner's own."""
    with build_client(tmp_path, "module-static-private") as client:
        owner_id = seed_identity(client, line_user_id="U_OWNER", role="staff")
        headers = headers_for(client, owner_id, role="staff", line_user_id="U_OWNER")

        response = _create_module(client, headers, html=STATIC_HTML, visibility="private")
        assert response.status_code == 201, response.text
        assert response.json()["html"] == STATIC_HTML


def test_a_shared_static_module_is_rejected(tmp_path: Path) -> None:
    """A shared module that cannot re-fetch is a shared dataset, not a shared capability.

    Saving a self-contained report as `staff` would hand every other nurse the author's
    cohort rows -- patients they are not assigned to -- without `/v1/copilot/proxy` ever
    being involved, so none of the per-viewer scoping the rest of the system enforces
    would apply to it.
    """
    with build_client(tmp_path, "module-static-shared") as client:
        owner_id = seed_identity(client, line_user_id="U_OWNER", role="staff")
        headers = headers_for(client, owner_id, role="staff", line_user_id="U_OWNER")

        response = _create_module(client, headers, html=STATIC_HTML, visibility="staff")
        assert response.status_code == 422, response.text
        # The nurse has to be able to act on this, so the message says what to do.
        assert "即時" in response.json()["detail"] or "查詢" in response.json()["detail"]

        # ...and nothing was stored.
        listed = client.get("/v1/copilot/modules", headers=headers)
        assert listed.json()["items"] == []


def test_a_shared_module_that_fetches_at_run_time_is_accepted(tmp_path: Path) -> None:
    with build_client(tmp_path, "module-live-shared") as client:
        owner_id = seed_identity(client, line_user_id="U_OWNER", role="staff")
        headers = headers_for(client, owner_id, role="staff", line_user_id="U_OWNER")

        response = _create_module(client, headers, html=LIVE_HTML, visibility="staff")
        assert response.status_code == 201, response.text
        assert response.json()["visibility"] == "staff"


def test_a_private_static_module_cannot_be_patched_to_shared(tmp_path: Path) -> None:
    """The transition is the same defect as the save, so it is refused the same way."""
    with build_client(tmp_path, "module-static-patch") as client:
        owner_id = seed_identity(client, line_user_id="U_OWNER", role="staff")
        headers = headers_for(client, owner_id, role="staff", line_user_id="U_OWNER")

        created = _create_module(client, headers, html=STATIC_HTML, visibility="private")
        assert created.status_code == 201
        module_id = created.json()["module_id"]

        promoted = client.patch(
            f"/v1/copilot/modules/{module_id}", json={"visibility": "staff"}, headers=headers
        )
        assert promoted.status_code == 422, promoted.text

        # The refusal left the module alone rather than half-applying it.
        after = client.get(f"/v1/copilot/modules/{module_id}", headers=headers)
        assert after.json()["visibility"] == "private"

        # Replacing the HTML with a version that fetches at run time unblocks the share.
        swapped = client.patch(
            f"/v1/copilot/modules/{module_id}",
            json={"visibility": "staff", "html": LIVE_HTML},
            headers=headers,
        )
        assert swapped.status_code == 200, swapped.text
        assert swapped.json()["visibility"] == "staff"

        # And a shared module cannot be downgraded back to static HTML in place.
        regressed = client.patch(
            f"/v1/copilot/modules/{module_id}", json={"html": STATIC_HTML}, headers=headers
        )
        assert regressed.status_code == 422, regressed.text


def test_a_title_only_patch_on_a_legacy_shared_static_module_is_allowed(tmp_path: Path) -> None:
    """A row that predates the bridge rule stays renameable.

    The guard exists to stop the bad state being *entered*. A PATCH that touches neither
    `html` nor `visibility` does not enter it, and refusing one would leave rows saved
    before this rule permanently unrenameable.
    """
    with build_client(tmp_path, "legacy-rename") as client:
        staff_id = seed_identity(client, line_user_id="U_STAFF", role="staff")
        headers = headers_for(client, staff_id, role="staff", line_user_id="U_STAFF")

        created = client.post(
            "/v1/copilot/modules",
            json={"title": "舊報表", "html": STATIC_HTML, "visibility": "private"},
            headers=headers,
        )
        assert created.status_code == 201
        module_id = created.json()["module_id"]

        # Reproduce the legacy state the rule would never allow to be created today.
        session_factory = client.app.state.db_session_factory
        with session_factory() as session:
            row = session.get(CopilotModule, module_id)
            assert row is not None
            row.visibility = "staff"
            session.commit()

        renamed = client.patch(
            f"/v1/copilot/modules/{module_id}",
            json={"title": "改個名字"},
            headers=headers,
        )
        assert renamed.status_code == 200
        assert renamed.json()["title"] == "改個名字"

        # Touching either governed field still refuses.
        assert client.patch(
            f"/v1/copilot/modules/{module_id}",
            json={"visibility": "staff"},
            headers=headers,
        ).status_code == 422


def test_a_shared_module_shows_each_viewer_only_their_own_patients(tmp_path: Path) -> None:
    """Sharing a module shares a capability, not a dataset.

    Staff A saves a `staff`-visible module built from their own data. Staff B can open
    that module (the code is shared), but every figure it shows is fetched live through
    `/v1/copilot/proxy` under B's own token. So when B's copy of the module calls
    `list_patients`, B must see only B's assigned patients -- never A's -- even though B
    is looking at A's saved module. Nothing special enforces this; it falls out of the
    proxy resolving the caller's own permissions. This test pins that property so a
    future change (e.g. the proxy resolving the module owner's identity instead of the
    caller's) cannot quietly break it.
    """
    copilot_proxy_rate_limiter.reset()
    with build_client(tmp_path, "module-capability") as client:
        staff_a_id = seed_identity(client, line_user_id="U_STAFF_A", role="staff")
        staff_b_id = seed_identity(client, line_user_id="U_STAFF_B", role="staff")

        patient_x = seed_patient(client, case_number="PX00001")
        patient_y = seed_patient(client, case_number="PY00002")
        assign(client, staff_identity_id=staff_a_id, patient_id=patient_x)
        assign(client, staff_identity_id=staff_b_id, patient_id=patient_y)

        headers_a = headers_for(client, staff_a_id, role="staff", line_user_id="U_STAFF_A")
        headers_b = headers_for(client, staff_b_id, role="staff", line_user_id="U_STAFF_B")

        created = _create_module(
            client,
            headers_a,
            visibility="staff",
            html=LIVE_HTML,
        )
        assert created.status_code == 201
        module_id = created.json()["module_id"]

        # The code is shared: B can open A's module.
        fetched = client.get(f"/v1/copilot/modules/{module_id}", headers=headers_b)
        assert fetched.status_code == 200

        # The data is not: B's own token on the proxy only ever resolves to B's patients.
        # `binding_filter: "all"` sidesteps the (unrelated) LINE-account-binding filter --
        # neither seeded patient has a bound LiffIdentity -- so only the assignment-based
        # access scoping this test cares about is in play.
        proxy_response = client.post(
            "/v1/copilot/proxy",
            json={"tool": "list_patients", "params": {"binding_filter": "all"}},
            headers=headers_b,
        )
        assert proxy_response.status_code == 200, proxy_response.text
        items = proxy_response.json()["data"]["items"]
        cases = {item["case_number"] for item in items}
        assert cases == {"PY00002"}
        assert "PX00001" not in cases


def test_capability_test_detects_a_proxy_that_impersonates_the_owner(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Prove the capability test above has teeth, without touching production code.

    `test_a_shared_module_shows_each_viewer_only_their_own_patients` only means something
    if it would actually go red when the property it pins breaks. This test manufactures
    exactly that breakage -- `/v1/copilot/proxy` resolving the module owner's identity
    instead of the caller's -- entirely inside test scope, by monkeypatching
    `_authorization_header` (the single call in `post_copilot_proxy` that decides whose
    token gets forwarded to the underlying tool) to always return the module owner's
    token, then shows the leak that causes: B's proxy call for `list_patients` comes
    back with A's patient, not B's -- the exact failure that would break the real
    capability test's `assert cases == {"PY00002"}`.

    (This same break was previously confirmed by hand-editing
    `app/api/routes/copilot.py` to mint the module owner's token, watching the real
    capability test go red with `assert {'PX00001'} == {'PY00002'}`, and reverting with
    `git checkout --`. That is recorded in the task report. This test pins the same
    proof permanently, so production code never has to carry a live authorization
    bypass again to re-demonstrate it.)
    """
    copilot_proxy_rate_limiter.reset()
    with build_client(tmp_path, "module-capability-teeth") as client:
        staff_a_id = seed_identity(client, line_user_id="U_STAFF_A2", role="staff")
        staff_b_id = seed_identity(client, line_user_id="U_STAFF_B2", role="staff")

        patient_x = seed_patient(client, case_number="PX00003")
        patient_y = seed_patient(client, case_number="PY00004")
        assign(client, staff_identity_id=staff_a_id, patient_id=patient_x)
        assign(client, staff_identity_id=staff_b_id, patient_id=patient_y)

        headers_a = headers_for(client, staff_a_id, role="staff", line_user_id="U_STAFF_A2")
        headers_b = headers_for(client, staff_b_id, role="staff", line_user_id="U_STAFF_B2")

        created = _create_module(
            client,
            headers_a,
            visibility="staff",
            html=LIVE_HTML,
        )
        assert created.status_code == 201

        # Simulate the exact breakage the sabotage run exercised: the proxy forwards the
        # module owner's (A's) token instead of the caller's (B's).
        monkeypatch.setattr(
            copilot_routes,
            "_authorization_header",
            lambda request: headers_a["Authorization"],
        )

        proxy_response = client.post(
            "/v1/copilot/proxy",
            json={"tool": "list_patients", "params": {"binding_filter": "all"}},
            headers=headers_b,
        )
        assert proxy_response.status_code == 200, proxy_response.text
        items = proxy_response.json()["data"]["items"]
        cases = {item["case_number"] for item in items}

        # Under this impersonation, B's result is A's data -- confirming the capability
        # test's assertions would catch this regression if it ever landed for real.
        assert "PX00003" in cases
        assert cases != {"PY00004"}


@pytest.mark.parametrize("as_role", ["staff", "admin"])
def test_module_list_respects_visibility_matrix(tmp_path: Path, as_role: str) -> None:
    """`GET /v1/copilot/modules` must filter by visibility, not just by ownership.

    The detail route's visibility matrix is already covered by
    `test_module_visibility_matrix`; this pins the same matrix for the list route,
    which has its own (separate) query and had no coverage of its filtering at all.
    """
    with build_client(tmp_path, f"module-list-visibility-{as_role}") as client:
        owner_staff_id = seed_identity(client, line_user_id="U_OWNER_STAFF", role="staff")
        owner_admin_id = seed_identity(client, line_user_id="U_OWNER_ADMIN", role="admin")
        viewer_id = seed_identity(client, line_user_id="U_VIEWER", role=as_role)

        owner_staff_headers = headers_for(
            client, owner_staff_id, role="staff", line_user_id="U_OWNER_STAFF"
        )
        owner_admin_headers = headers_for(
            client, owner_admin_id, role="admin", line_user_id="U_OWNER_ADMIN"
        )

        private_module = _create_module(
            client, owner_staff_headers, visibility="private", title="Private (staff-owned)"
        )
        assert private_module.status_code == 201
        private_module_id = private_module.json()["module_id"]

        staff_module = _create_module(
            client, owner_staff_headers, visibility="staff", title="Staff-shared"
        )
        assert staff_module.status_code == 201
        staff_module_id = staff_module.json()["module_id"]

        admin_module = _create_module(
            client, owner_admin_headers, visibility="admin", title="Admin-shared"
        )
        assert admin_module.status_code == 201
        admin_module_id = admin_module.json()["module_id"]

        admin_private_module = _create_module(
            client, owner_admin_headers, visibility="private", title="Private (admin-owned)"
        )
        assert admin_private_module.status_code == 201
        admin_private_module_id = admin_private_module.json()["module_id"]

        viewer_headers = headers_for(client, viewer_id, role=as_role, line_user_id="U_VIEWER")
        listed = client.get("/v1/copilot/modules", headers=viewer_headers)
        assert listed.status_code == 200
        visible_ids = {item["module_id"] for item in listed.json()["items"]}

        # Never see others' private modules, regardless of viewer role.
        assert private_module_id not in visible_ids
        assert admin_private_module_id not in visible_ids

        # Others' staff-visible modules are visible to staff and admin alike.
        assert staff_module_id in visible_ids

        # Others' admin-visible modules are visible only to admin.
        if as_role == "admin":
            assert admin_module_id in visible_ids
        else:
            assert admin_module_id not in visible_ids

        # The viewer owns none of the above, so this pins "others'" visibility only.
        # Now confirm the complementary half: a viewer always sees their *own* modules,
        # of any visibility, even ones nobody else could see.
        own_private = _create_module(
            client, viewer_headers, visibility="private", title="Private (viewer-owned)"
        )
        assert own_private.status_code == 201
        own_private_id = own_private.json()["module_id"]

        own_visibility = "staff" if as_role == "staff" else "admin"
        own_shared = _create_module(
            client, viewer_headers, visibility=own_visibility, title="Shared (viewer-owned)"
        )
        assert own_shared.status_code == 201
        own_shared_id = own_shared.json()["module_id"]

        relisted = client.get("/v1/copilot/modules", headers=viewer_headers)
        assert relisted.status_code == 200
        relisted_ids = {item["module_id"] for item in relisted.json()["items"]}
        assert own_private_id in relisted_ids
        assert own_shared_id in relisted_ids
