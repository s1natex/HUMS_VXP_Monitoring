"""
Excel export — writes stored import sessions to a styled .xlsx workbook.

Usage: python export_excel.py <payload.json> <output.xlsx>

Payload (built by the renderer from the saved date_import_*.json files over the
user-selected date range; a date may carry multiple sessions):
{
  "tail": "4X-BHT", "date_from": "01-11-2025", "date_to": "15-12-2025",
  "sessions": [
    { "date": "01-11-2025", "session_no": 1, "log_count": 6,
      "started_at": "2025-11-01T11:30:46", "completed_at": "2025-11-01T12:13:19",
      "rows": [ { "comp": "MR VERT", "location": "LHVRT+RHVRT",
                  "avg_meas": 0.163, "max_meas": 0.205,
                  "change": 0.012 | null, "status": "ok" } ] }
  ]
}

Workbook layout mirrors Resources/prototypes/src_prototypes/pdf_to_excel.py:
a navy header row, one banner row per session, Arial data rows. Highlighting
is driven by the app's limit status instead of the prototype's hardcoded
thresholds: caution rows fill yellow, alert rows fill red.

Prints a JSON result line to stdout: {"ok": true, "sessions": N, "rows": N}
"""

import sys, json

from openpyxl import Workbook
from openpyxl.styles import PatternFill, Font, Alignment
from openpyxl.utils import get_column_letter

COLUMNS = [
    "SESSION", "COMP/CONDITION", "LOCATION",
    "AVG MEAS", "UNIT", "CHANGE IN AVG", "MAX MEAS",
    "STATUS", "DATE", "TIME (hh:mm)",
]
COL_WIDTHS = [9, 26, 16, 10, 6, 14, 10, 10, 12, 12]

HDR_FONT = Font(name="Arial", size=10, bold=True, color="FFFFFF")
HDR_FILL = PatternFill("solid", fgColor="1F3864")
BNR_FONT = Font(name="Arial", size=9,  bold=True, color="1F3864")
BNR_FILL = PatternFill("solid", fgColor="D6DCE4")
DAT_FONT = Font(name="Arial", size=9)
RED_FILL    = PatternFill("solid", fgColor="FFC7CE")
YELLOW_FILL = PatternFill("solid", fgColor="FFFF00")
CENTER = Alignment(horizontal="center", vertical="center")
LEFT   = Alignment(horizontal="left",   vertical="center")

STATUS_LABEL = {"alert": "CRITICAL", "caution": "CAUTION", "ok": "NORMAL", "white": ""}


def hhmm(iso_ts):
    """'2025-11-01T11:30:46' -> '11:30' (empty when absent/unparseable)."""
    if not iso_ts or "T" not in iso_ts:
        return ""
    return iso_ts.split("T", 1)[1][:5]


def build_excel(payload, output_path):
    sessions = payload.get("sessions") or []

    wb = Workbook()
    ws = wb.active
    ws.title = "Data"

    for i, w in enumerate(COL_WIDTHS, 1):
        ws.column_dimensions[get_column_letter(i)].width = w

    ws.row_dimensions[1].height = 20
    for c_idx, col_name in enumerate(COLUMNS, 1):
        cell = ws.cell(row=1, column=c_idx, value=col_name)
        cell.font = HDR_FONT; cell.fill = HDR_FILL; cell.alignment = CENTER
    ws.freeze_panes = "A2"

    excel_row = 2
    total_rows = 0

    for session in sessions:
        banner = (
            f"{session.get('date', '')}  |  Session {session.get('session_no', '')}"
            f"  |  {session.get('log_count', '?')} log(s)"
            f"  |  Started: {session.get('started_at', '') or '—'}"
            f"  |  Completed: {session.get('completed_at', '') or '—'}"
        )
        ws.row_dimensions[excel_row].height = 15
        ws.merge_cells(start_row=excel_row, start_column=1,
                       end_row=excel_row, end_column=len(COLUMNS))
        cell = ws.cell(row=excel_row, column=1, value=banner)
        cell.font = BNR_FONT; cell.fill = BNR_FILL; cell.alignment = LEFT
        excel_row += 1

        for data in session.get("rows") or []:
            ws.row_dimensions[excel_row].height = 14
            status = data.get("status") or "white"
            change = data.get("change")
            values = [
                session.get("session_no", ""),
                data.get("comp", ""),
                data.get("location", ""),
                data.get("avg_meas", ""),
                "ips",
                round(change, 3) if isinstance(change, (int, float)) else "",
                data.get("max_meas", ""),
                STATUS_LABEL.get(status, status.upper()),
                session.get("date", ""),
                hhmm(session.get("started_at")),
            ]
            for c_idx, val in enumerate(values, 1):
                cell = ws.cell(row=excel_row, column=c_idx, value=val)
                cell.font = DAT_FONT
                cell.alignment = CENTER
                if status == "alert":
                    cell.fill = RED_FILL
                elif status == "caution":
                    cell.fill = YELLOW_FILL
            excel_row += 1
            total_rows += 1

    wb.save(output_path)
    return {"ok": True, "sessions": len(sessions), "rows": total_rows}


def main():
    if len(sys.argv) < 3:
        print(json.dumps({"ok": False, "error": "Usage: export_excel.py <payload.json> <output.xlsx>"}))
        sys.exit(1)
    try:
        with open(sys.argv[1], encoding="utf-8") as f:
            payload = json.load(f)
        result = build_excel(payload, sys.argv[2])
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}))
        sys.exit(1)
    print(json.dumps(result))


if __name__ == "__main__":
    main()
