#!/usr/bin/env python3
"""Preload patient records from XLSX/TSV without LIFF binding.

This script creates rows in `patients` only so users can bind later without
waiting for manual review. Duplicate `(case_number, birth_date)` rows are
skipped.
"""

from __future__ import annotations

import argparse
import csv
import os
import re
import sys
import tempfile
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any
from zipfile import BadZipFile, ZipFile
from xml.etree import ElementTree as ET

_BACKEND_ROOT = Path(__file__).resolve().parents[2]
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None  # type: ignore[misc, assignment]

from sqlalchemy import func, select
from sqlalchemy.engine.url import make_url

from app.db.migrations import upgrade_database
from app.db.models import LiffIdentity, Patient
from app.db.session import create_engine_from_url, create_session_factory
from app.services.staff_dashboard import DuplicatePatientError, create_patient_record

XML_NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
XML_REL_NS = {"r": "http://schemas.openxmlformats.org/package/2006/relationships"}
OFFICE_REL_KEY = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
EXCEL_EPOCH = date(1899, 12, 30)

DATE_NUMFMT_IDS = {
    14,
    15,
    16,
    17,
    18,
    19,
    20,
    21,
    22,
    27,
    30,
    36,
    45,
    46,
    47,
    50,
    57,
}

FIELD_ALIASES = {
    "full_name": {"姓名", "病患姓名", "病人姓名", "name", "full_name"},
    "case_number": {"病歷號", "病歷號碼", "病例號", "case_number", "case no", "caseno"},
    "birth_date": {"出生日期", "生日", "birth_date", "birthdate"},
}


@dataclass
class CellValue:
    value: Any
    style_idx: int | None


@dataclass
class RawPatientRow:
    row_number: int
    full_name: CellValue
    case_number: CellValue
    birth_date: CellValue


@dataclass
class Stats:
    total: int = 0
    inserted: int = 0
    skipped_duplicate: int = 0
    skipped_invalid: int = 0
    would_insert: int = 0


@dataclass
class PatientBindingMetrics:
    total: int
    bound: int
    unbound: int


def _normalize_header(value: str) -> str:
    return "".join(value.strip().lower().split())


def _parse_workbook_sheet_target(zf: ZipFile, sheet_name: str | None) -> str:
    workbook = ET.fromstring(zf.read("xl/workbook.xml"))
    rels = ET.fromstring(zf.read("xl/_rels/workbook.xml.rels"))
    rel_by_id = {node.attrib["Id"]: node.attrib["Target"] for node in rels.findall("r:Relationship", XML_REL_NS)}

    selected_rel_id: str | None = None
    for sheet in workbook.findall("m:sheets/m:sheet", XML_NS):
        current_name = sheet.attrib.get("name", "")
        rel_id = sheet.attrib.get(OFFICE_REL_KEY)
        if rel_id is None:
            continue
        if sheet_name is None or current_name == sheet_name:
            selected_rel_id = rel_id
            break
    if selected_rel_id is None:
        if sheet_name is None:
            raise ValueError("Workbook has no readable sheets")
        raise ValueError(f"Sheet '{sheet_name}' not found in workbook")
    target = rel_by_id.get(selected_rel_id)
    if not target:
        raise ValueError("Worksheet relationship target is missing")
    if not target.startswith("xl/"):
        target = f"xl/{target.lstrip('/')}"
    return target


def _parse_shared_strings(zf: ZipFile) -> list[str]:
    if "xl/sharedStrings.xml" not in zf.namelist():
        return []
    root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
    values: list[str] = []
    for node in root.findall("m:si", XML_NS):
        parts = [piece.text or "" for piece in node.findall(".//m:t", XML_NS)]
        values.append("".join(parts))
    return values


def _parse_styles(zf: ZipFile) -> tuple[set[int], dict[int, int]]:
    if "xl/styles.xml" not in zf.namelist():
        return set(), {}
    root = ET.fromstring(zf.read("xl/styles.xml"))
    custom_numfmts: dict[int, str] = {}
    for node in root.findall("m:numFmts/m:numFmt", XML_NS):
        numfmt_id = int(node.attrib.get("numFmtId", "0"))
        code = node.attrib.get("formatCode", "")
        custom_numfmts[numfmt_id] = code

    date_styles: set[int] = set()
    zero_pad_styles: dict[int, int] = {}
    for idx, xf in enumerate(root.findall("m:cellXfs/m:xf", XML_NS)):
        numfmt_id = int(xf.attrib.get("numFmtId", "0"))
        code = custom_numfmts.get(numfmt_id, "")
        normalized_code = code.lower()
        if numfmt_id in DATE_NUMFMT_IDS or any(token in normalized_code for token in ("yy", "mm", "dd")):
            date_styles.add(idx)
        # Handles formats like 0000000 to preserve leading zeros.
        zero_matches = re.fullmatch(r"0+", code)
        if zero_matches:
            zero_pad_styles[idx] = len(code)
    return date_styles, zero_pad_styles


def _col_from_cell_ref(cell_ref: str) -> str:
    match = re.match(r"([A-Z]+)", cell_ref)
    if not match:
        return cell_ref
    return match.group(1)


def _parse_xlsx_rows(path: Path, sheet_name: str | None) -> tuple[list[RawPatientRow], dict[int, int]]:
    with ZipFile(path) as zf:
        target = _parse_workbook_sheet_target(zf, sheet_name=sheet_name)
        shared = _parse_shared_strings(zf)
        _, zero_pad_styles = _parse_styles(zf)

        root = ET.fromstring(zf.read(target))
        rows = root.findall("m:sheetData/m:row", XML_NS)
        if not rows:
            return [], zero_pad_styles

        header_row = rows[0]
        col_to_field: dict[str, str] = {}
        for cell in header_row.findall("m:c", XML_NS):
            cell_ref = cell.attrib.get("r", "")
            column = _col_from_cell_ref(cell_ref)
            raw_text = _read_cell_value(cell, shared)
            if raw_text is None:
                continue
            normalized = _normalize_header(str(raw_text))
            for field_name, aliases in FIELD_ALIASES.items():
                if normalized in {_normalize_header(alias) for alias in aliases}:
                    col_to_field[column] = field_name
                    break

        missing = [field for field in ("full_name", "case_number", "birth_date") if field not in col_to_field.values()]
        if missing:
            raise ValueError(f"Missing required headers: {', '.join(missing)}")

        parsed: list[RawPatientRow] = []
        for row in rows[1:]:
            row_number = int(row.attrib.get("r", "0") or "0")
            by_field: dict[str, CellValue] = {}
            for cell in row.findall("m:c", XML_NS):
                column = _col_from_cell_ref(cell.attrib.get("r", ""))
                field = col_to_field.get(column)
                if not field:
                    continue
                style_idx = int(cell.attrib["s"]) if "s" in cell.attrib else None
                by_field[field] = CellValue(value=_read_cell_value(cell, shared), style_idx=style_idx)
            if not by_field:
                continue
            parsed.append(
                RawPatientRow(
                    row_number=row_number,
                    full_name=by_field.get("full_name", CellValue(None, None)),
                    case_number=by_field.get("case_number", CellValue(None, None)),
                    birth_date=by_field.get("birth_date", CellValue(None, None)),
                )
            )
    return parsed, zero_pad_styles


def _read_cell_value(cell: ET.Element, shared_strings: list[str]) -> Any:
    cell_type = cell.attrib.get("t")
    value_node = cell.find("m:v", XML_NS)
    if cell_type == "inlineStr":
        text_node = cell.find("m:is/m:t", XML_NS)
        return text_node.text if text_node is not None else None
    if value_node is None:
        return None
    raw = value_node.text or ""
    if cell_type == "s":
        index = int(raw)
        return shared_strings[index] if 0 <= index < len(shared_strings) else raw
    if cell_type in {"str", "b"}:
        return raw
    if re.fullmatch(r"-?\d+", raw):
        return int(raw)
    if re.fullmatch(r"-?\d+\.\d+", raw):
        return float(raw)
    return raw


def _parse_tsv_rows(path: Path) -> list[RawPatientRow]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle, delimiter="\t")
        if reader.fieldnames is None:
            raise ValueError("TSV has no header row")
        normalized_fields = {_normalize_header(field): field for field in reader.fieldnames if field}
        field_to_source: dict[str, str] = {}
        for field_name, aliases in FIELD_ALIASES.items():
            for alias in aliases:
                key = _normalize_header(alias)
                if key in normalized_fields:
                    field_to_source[field_name] = normalized_fields[key]
                    break
        missing = [field for field in ("full_name", "case_number", "birth_date") if field not in field_to_source]
        if missing:
            raise ValueError(f"Missing required headers: {', '.join(missing)}")

        parsed: list[RawPatientRow] = []
        for idx, row in enumerate(reader, start=2):
            parsed.append(
                RawPatientRow(
                    row_number=idx,
                    full_name=CellValue(row.get(field_to_source["full_name"]), None),
                    case_number=CellValue(row.get(field_to_source["case_number"]), None),
                    birth_date=CellValue(row.get(field_to_source["birth_date"]), None),
                )
            )
    return parsed


def _normalize_name(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        raise ValueError("full_name is empty")
    return text


def _normalize_case_number(value: Any, *, zero_pad_length: int | None) -> str:
    if value is None:
        raise ValueError("case_number is empty")
    if isinstance(value, (int, float)):
        number = int(value)
        normalized = str(number)
    else:
        text = str(value).strip()
        if not text:
            raise ValueError("case_number is empty")
        if re.fullmatch(r"\d+\.0+", text):
            text = text.split(".", maxsplit=1)[0]
        normalized = text
    if zero_pad_length and normalized.isdigit():
        normalized = normalized.zfill(zero_pad_length)
    return normalized


def _excel_serial_to_date(serial: float) -> date:
    return EXCEL_EPOCH + timedelta(days=int(serial))


def _normalize_birth_date(value: Any) -> str:
    if value is None:
        raise ValueError("birth_date is empty")
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, (int, float)):
        if value <= 0:
            raise ValueError("birth_date serial is invalid")
        return _excel_serial_to_date(float(value)).isoformat()
    text = str(value).strip()
    if not text:
        raise ValueError("birth_date is empty")
    for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%Y.%m.%d", "%Y%m%d"):
        try:
            return datetime.strptime(text, fmt).date().isoformat()
        except ValueError:
            continue
    raise ValueError(f"birth_date format is invalid: {text}")


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Import patient preloaded records into DB")
    source_group = parser.add_mutually_exclusive_group(required=True)
    source_group.add_argument("--xlsx", type=Path, help="Path to XLSX source file")
    source_group.add_argument("--tsv", type=Path, help="Path to TSV source file")
    parser.add_argument("--sheet", type=str, default=None, help="Sheet name for XLSX (default first sheet)")
    parser.add_argument("--password", type=str, default=None, help="Password for encrypted XLSX")
    parser.add_argument("--dry-run", action="store_true", help="Validate rows only; do not write to DB")
    parser.add_argument("--yes", action="store_true", help="Skip interactive confirmation before real import")
    parser.add_argument("--limit", type=int, default=None, help="Only process first N data rows")
    parser.add_argument("--database-url", type=str, default=None, help="Override DB URL")
    return parser.parse_args()


def _load_database_url(override: str | None) -> str:
    if override:
        return override
    if load_dotenv:
        load_dotenv(_BACKEND_ROOT / ".env")
    database_url = os.getenv("PDCARE_DATABASE_URL") or os.getenv("DATABASE_URL")
    if not database_url:
        raise RuntimeError("Neither PDCARE_DATABASE_URL nor DATABASE_URL is set")
    return database_url


def _mask_database_url(database_url: str) -> str:
    parsed = make_url(database_url)
    if parsed.password is None:
        return str(parsed)
    return str(parsed.set(password="***"))


def _describe_database_target(database_url: str) -> str:
    parsed = make_url(database_url)
    backend = parsed.get_backend_name()
    if backend.startswith("sqlite"):
        return f"type=sqlite path={parsed.database or '(memory)'}"
    host = parsed.host or "(none)"
    port = parsed.port or "(default)"
    db_name = parsed.database or "(none)"
    return f"type={backend} host={host} port={port} db={db_name}"


def _confirm_real_import(args: argparse.Namespace, *, source_rows: int) -> None:
    if args.dry_run or args.yes:
        return
    prompt = (
        f"This will import up to {source_rows} source rows into the target database. "
        "Type 'yes' to continue: "
    )
    if not sys.stdin.isatty():
        raise RuntimeError("Non-interactive shell detected. Re-run with --yes to confirm real import.")
    answer = input(prompt).strip().lower()
    if answer != "yes":
        raise RuntimeError("Import cancelled by user.")


def _load_rows(args: argparse.Namespace) -> tuple[list[RawPatientRow], dict[int, int]]:
    if args.xlsx:
        try:
            return _parse_xlsx_rows(args.xlsx, sheet_name=args.sheet)
        except BadZipFile:
            if not args.password:
                raise ValueError("XLSX appears encrypted; please provide --password")
            decrypted_path = _decrypt_xlsx_to_temp(args.xlsx, args.password)
            try:
                return _parse_xlsx_rows(decrypted_path, sheet_name=args.sheet)
            finally:
                decrypted_path.unlink(missing_ok=True)
    assert args.tsv is not None
    return _parse_tsv_rows(args.tsv), {}


def _decrypt_xlsx_to_temp(path: Path, password: str) -> Path:
    try:
        import msoffcrypto  # type: ignore[import-not-found]
    except ImportError as exc:
        raise RuntimeError("Encrypted XLSX requires msoffcrypto-tool package") from exc

    tmp = tempfile.NamedTemporaryFile(prefix="patient-import-", suffix=".xlsx", delete=False)
    tmp_path = Path(tmp.name)
    tmp.close()
    try:
        with path.open("rb") as encrypted_file, tmp_path.open("wb") as decrypted_file:
            office_file = msoffcrypto.OfficeFile(encrypted_file)
            office_file.load_key(password=password)
            office_file.decrypt(decrypted_file)
    except Exception as exc:
        tmp_path.unlink(missing_ok=True)
        raise ValueError("Failed to decrypt XLSX. Check --password") from exc
    return tmp_path


def _row_is_empty(row: RawPatientRow) -> bool:
    return not str(row.full_name.value or "").strip() and not str(row.case_number.value or "").strip() and not str(
        row.birth_date.value or ""
    ).strip()


def _collect_patient_binding_metrics(session) -> PatientBindingMetrics:
    total = int(session.execute(select(func.count(Patient.id))).scalar_one() or 0)
    bound = int(
        session.execute(
            select(func.count(func.distinct(Patient.id)))
            .select_from(Patient)
            .join(LiffIdentity, LiffIdentity.patient_id == Patient.id)
        ).scalar_one()
        or 0
    )
    unbound = int(
        session.execute(
            select(func.count(Patient.id))
            .select_from(Patient)
            .outerjoin(LiffIdentity, LiffIdentity.patient_id == Patient.id)
            .where(LiffIdentity.id.is_(None))
        ).scalar_one()
        or 0
    )
    return PatientBindingMetrics(total=total, bound=bound, unbound=unbound)


def main() -> int:
    args = _parse_args()
    database_url = _load_database_url(args.database_url)
    print("=== Target database ===")
    print(f"database_url={_mask_database_url(database_url)}")
    print(_describe_database_target(database_url))

    rows, zero_pad_styles = _load_rows(args)
    if args.limit is not None:
        rows = rows[: args.limit]
    _confirm_real_import(args, source_rows=len(rows))

    engine = create_engine_from_url(database_url)
    # Keep real credentials for Alembic connection; str(engine.url) masks password as ***.
    upgrade_database(engine.url.render_as_string(hide_password=False))
    session_factory = create_session_factory(engine)

    stats = Stats(total=0)
    invalid_samples: list[str] = []
    metrics: PatientBindingMetrics | None = None

    with session_factory() as session:
        for row in rows:
            if _row_is_empty(row):
                continue
            stats.total += 1
            try:
                pad_len = zero_pad_styles.get(row.case_number.style_idx or -1)
                full_name = _normalize_name(row.full_name.value)
                case_number = _normalize_case_number(row.case_number.value, zero_pad_length=pad_len)
                birth_date = _normalize_birth_date(row.birth_date.value)
            except ValueError as exc:
                stats.skipped_invalid += 1
                if len(invalid_samples) < 20:
                    invalid_samples.append(f"row {row.row_number}: {exc}")
                continue

            if args.dry_run:
                exists = session.execute(
                    select(Patient.id).where(
                        Patient.case_number == case_number,
                        Patient.birth_date == birth_date,
                    )
                ).scalar_one_or_none()
                if exists is None:
                    stats.would_insert += 1
                else:
                    stats.skipped_duplicate += 1
                continue

            try:
                create_patient_record(
                    session,
                    case_number=case_number,
                    birth_date=birth_date,
                    full_name=full_name,
                    gender="unknown",
                )
                stats.inserted += 1
            except DuplicatePatientError:
                stats.skipped_duplicate += 1
        metrics = _collect_patient_binding_metrics(session)

    print("=== Patient preload import summary ===")
    print(f"source_rows={len(rows)}")
    print(f"processed={stats.total}")
    if args.dry_run:
        print(f"would_insert={stats.would_insert}")
    else:
        print(f"inserted={stats.inserted}")
    print(f"skipped_duplicate={stats.skipped_duplicate}")
    print(f"skipped_invalid={stats.skipped_invalid}")
    print(f"dry_run={args.dry_run}")
    if metrics is not None:
        print(f"patients_total={metrics.total}")
        print(f"patients_bound={metrics.bound}")
        print(f"patients_unbound={metrics.unbound}")
    if invalid_samples:
        print("invalid_samples:")
        for sample in invalid_samples:
            print(f"  - {sample}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
