# Admin patient assignment board — UI/UX design

Date: 2026-07-11  
Status: approved for implementation planning  
Scope: frontend UX renovation of `/admin/patient-assignment` plus additive read-API fields for avatars/gender. **Assignment mutation logic and API contracts stay unchanged.**

## Goals

- Replace the table / checkbox / bulk-assign UX with a **drag-and-drop-first** staff–patient board.
- Keep staff cards **equal fixed size**; patient lots use a calculated equal-cell grid.
- Support **mobile staff** with a vertical stack layout and bottom-sheet drawer.
- Preserve existing assign / reassign / unassign behavior via current endpoints.

## Non-goals

- Changing upsert / unassign / bulk mutation semantics or authorization.
- Reintroducing the patient table or bulk checkbox assign UI on this page.
- Redesigning other admin pages.

## Decisions (from brainstorming)

| Topic | Choice |
| --- | --- |
| Drag model | Full board: pool→staff, staff→staff, staff→pool |
| Legacy table / bulk | Remove; keep compact pool search/filters only |
| Read API enrichment | Add `gender` / `picture_url` on assignment reads; `picture_url` on staff identity list |
| `+` click | Open staff Sheet focused on “新增病患” |
| Mobile layout | Vertical stack; Sheet as bottom sheet |
| Approach | `@dnd-kit` + shadcn Sheet + additive read APIs |

## Layout

### Page structure

1. **Top — unassigned pool**
   - Compact search + existing filter controls scoped to the unassigned pool.
   - Pool data is unassigned patients only (`assignment=unassigned` or equivalent client filter); binding/keyword filters still apply.
   - Horizontal patient cards waiting to be assigned.
2. **Below — staff/admin grid**
   - One outer card per assignee (`staff` / `admin`).
   - Desktop: multi-column equal-height grid.
   - Mobile: full-width vertical stack; pool supports horizontal scroll.

### Staff / admin outer card

- **Header:** avatar + display name.
  - Name: `real_name` if present, else LINE `display_name`, else fallback (“未命名人員”).
  - Optional secondary LINE name when `real_name` is shown.
- **Body:** fixed patient-lot region (see lot math).
- Card outer dimensions do **not** grow with patient count.

### Patient cell content

**Chip mode (≤3 assigned patients on that staff):**

- Single row inside the cell: `avatar | name` (real/full name, not LINE display name).
- Sex is **not** inline text.

**Square mode (>3 assigned patients):**

- Avatar fills the cell (`object-cover`).

**Sex badge (both modes + pool chips):**

- Soft-tint badge flush to the **top-right** of the patient cell (`top: 0; right: 0`; no gap to the cell border).
- Palette (soft, not solid primary fills):
  - 男: bg `#dbeafe` / text `#1e40af`
  - 女: bg `#fce7f3` / text `#9d174d`
  - 其他: bg `#ede9fe` / text `#5b21b6`
  - unknown: bg `#f4f4f5` / text `#52525b` (`?`)
- `+` and `+n` cells have no sex badge.

### Patient-lot math (equal cells, fixed card size)

Constants:

- Desktop: `rows = 2`, `columns = 4` → `capacity = 8`
- Mobile: `rows = 1`, `columns = 4` → `capacity = 4`

Always render a full `rows × columns` CSS grid (`1fr` tracks). Every cell (patient, `+n`, `+`, empty pad) shares the **same width and height**. The add (`+`) cell uses the same cell template as patient cells.

Algorithm:

```
capacity = rows * columns
reserve "+" as the last occupied meaningful cell

if patients.length <= 3:
  mode = chip
else:
  mode = square

overflow = patients.length > capacity - 1
if overflow:
  visible = capacity - 2   # room for +n and +
  cells = patients[0..visible) + ["+n"] + ["+"]
else:
  cells = patients[0..patients.length) + ["+"]
  pad with empty equal cells until len(cells) == capacity
```

- With many patients (overflow), meaningful cells fully tile the lot (e.g. desktop 10 patients → 6 avatars + `+4` + `+`).
- Empty pads keep geometry stable when below capacity; pads are non-interactive. The staff card body and `+` cell remain droppable.
- `+n` label = `patients.length - visible`.

## Interactions

### Drag and drop

- Pool → staff card or `+` cell → `upsertAdminAssignment`
- Staff A → staff B → `upsertAdminAssignment` (reassign)
- Staff → pool → `unassignAdminAssignment` (with confirm)
- Valid drop targets show a subtle highlight; invalid drops no-op
- `@dnd-kit` with Pointer + Touch sensors; activation delay ~150–200ms so mobile vertical scroll remains usable
- After mutation: refetch assignment list + by-staff map (same refresh pattern as today)

### Clicks

| Target | Action |
| --- | --- |
| Staff header / card | Open Sheet for that staff |
| `+` cell | Open Sheet focused on “新增病患” picker |
| `+n` cell | Open Sheet focused on assigned-patients list |
| Patient tile on staff card | No drawer on simple tap (avoid drag conflict); remove via Sheet |
| Pool patient | Draggable; tap alone does not assign |

### Staff Sheet (shadcn Sheet)

- Desktop: side sheet. Mobile: bottom sheet.
- Header: staff avatar, real/LINE name, role, active status.
- Section **負責病患:** list with avatar, full name, case number, sex; **移除** per row (confirm).
- Section **新增病患:** search unassigned patients; **加入** calls upsert.

### Confirm

- Confirm only for unassign (Sheet 移除 or drop onto pool).
- Assign / reassign: immediate, no confirm.

### Errors / pending

- Disable in-flight actions; surface failures with existing toast (`sonner`) patterns.

## Data & API

### Additive read fields only

| Type / response | New fields |
| --- | --- |
| `StaffAssignmentItem` | `gender`, `picture_url` |
| `StaffAssignmentByStaffPatientItem` | `gender`, `picture_url` |
| `AdminIdentityItem` | `picture_url` |

Backend services already have access to patient `gender` / `picture_url` and identity `picture_url` elsewhere; extend assignment list / by-staff queries and admin user list serialization accordingly.

Frontend `apps/frontend/lib/api/staff.ts` types and mapping stay in sync.

Missing `picture_url` → initials avatar fallback.

### Unchanged mutations

- `POST /v1/staff/admin/assignments` (`upsertAdminAssignment`)
- `DELETE /v1/staff/admin/assignments/{patientId}` (`unassignAdminAssignment`)
- Bulk endpoint may remain in the API; this page will not expose bulk checkbox UI.

## Frontend components

Primary route remains `apps/frontend/app/admin/patient-assignment/page.tsx`, split into colocated components as needed:

- `AssignmentBoard` — load state, filters, DnD context
- `UnassignedPool` — filters + horizontal chips
- `StaffAssigneeCard` — header + lot grid + modes
- `PatientTile` — chip / square + sex badge
- `StaffDetailSheet` — details, add, remove
- Small shared avatar helper (image or initials)

### Dependencies

- `@dnd-kit/core` (and related utilities as needed for droppable/draggable)
- shadcn `sheet` (and `dialog` if confirm is extracted from the current custom modal)

Install frontend packages with `npx` per repo convention.

## Responsive behavior

- **Desktop (`md+`):** multi-column staff grid; Sheet from the side; patient lot `2×4`.
- **Mobile:** stacked staff cards; sticky/scrollable pool; Sheet from bottom; patient lot `1×4`; touch-friendly drag activation delay.

## Testing

- Update `apps/frontend/app/admin/patient-assignment/__tests__/page.test.tsx` for board/pool/drawer affordances (not table/bulk).
- Backend: extend assignment / by-staff / admin user read tests for new fields.
- Do not weaken mutation tests; behavior stays the same.

## Out of scope reminders

- No changes to who may assign whom beyond existing admin gate.
- No production deploy steps in this design (follow ship-and-deploy only if requested later).
