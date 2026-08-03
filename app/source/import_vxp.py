"""
VXP PDF parser — extracts sessions and measurements from VXP report PDFs.

Usage: python import_vxp.py <pdf_path> <tail> [--limits <json_string>]

Outputs a JSON array to stdout (one object per unique session date).
Prints PROGRESS N/TOTAL per page to stderr.
"""

import sys, os, re, json, uuid
from datetime import datetime, date as dt_date
from pathlib import Path
from collections import defaultdict
import pdfplumber

from trend_detection import detect_trend

# ── Constants (shared with pdf_to_excel.py prototype) ─────────────────────────

DATE_RE   = re.compile(r"^\d{2}-\d{2}$")
HEADER_RE = re.compile(
    r"(\d+)\s+logs?\s+of\s+data[,\s]+started\s+(\S+\s+\S+)[,\s]+completed\s+(\S+\s+\S+)",
    re.IGNORECASE,
)
SESSION_DT_RE = re.compile(r"(\d{2}-\d{2}-\d{4})\s+(\d{2}:\d{2}:\d{2})")
# Matches "A/C # 760658_BHT" — captures the suffix after the last underscore
AC_HEADER_RE  = re.compile(r"A/C\s*#\s*\S+_([A-Z0-9]+)", re.IGNORECASE)
TWO_WORD_LOCATIONS = {"TR FA", "IGB V", "HB 1", "HB 2", "HB 3", "HB 4", "HB 5"}

# ── Default VXP limits (mirrors app/frontend/src/data/limits.js) ──────────────
# Format: "COMP | LOCATION" → [lower, caution, critical]   null = no limit
# Used as fallback when no --limits arg supplied.

DEFAULT_LIMITS = {
    "MR VERT | LHVRT+RHVRT":        [0.20, 0.30, 0.50],
    "MR VERT 4P | LHVRT+RHVRT":     None,
    "MR ROLL | LHVRT-RHVRT":        [0.20, 0.30, 0.50],
    "MR ROLL 4P | LHVRT-RHVRT":     None,
    "M/R 1P | LHVRT":               [0.20, 0.30, 0.50],
    "M/R 2P | LHVRT":               None,
    "M/R 4P | LHVRT":               [0.60, 0.70, 0.80],
    "M/R 1P | RHLAT":               [0.20, 0.30, 0.50],
    "M/R 4P | RHLAT":               [0.60, 0.70, 0.80],
    "M/R 1P | PHVRT":               [0.20, 0.30, 0.50],
    "M/R 2P | PHVRT":               None,
    "M/R 4P | PHVRT":               [0.60, 0.70, 0.80],
    "M/R 1P | RHVRT":               [0.20, 0.30, 0.50],
    "M/R 2P | RHVRT":               None,
    "M/R 4P | RHVRT":               [0.60, 0.70, 0.80],
    "AC GEN 1P | XMSNF":            None,
    "OIL COOL BLWR | XMSNF":        None,
    "ENG DS 1P | XMSNF":            None,
    "HYD/OIL PUMP 1P | XMSNF":      None,
    "BEVEL GMX2 | XMSNF":           None,
    "BEVEL GMX2 RMS | XMSNF":       None,
    "MRS BULL GMX2 | XMSNF":        None,
    "MRS BULL GMX2 RMS | XMSNF":    None,
    "HELICAL GM | XMSNF":           None,
    "HELICAL GM RMS | XMSNF":       None,
    "GEN/AC DR GMX2 | XMSNF":       None,
    "GEN/AC DR GMX2 RMS | XMSNF":   None,
    "GEN/AC DR GM | XMSNF":         None,
    "GEN/AC DR GM RMS | XMSNF":     None,
    "HELICAL GMX2 | XMSNF":         None,
    "HELICAL GMX2 RMS | XMSNF":     None,
    "MRS BULL GM | XMSNF":          None,
    "MRS BULL GM RMS | XMSNF":      None,
    "BEVEL GM | XMSNF":             None,
    "BEVEL GM RMS | XMSNF":         None,
    "T/R DS 2P | XMSNL":            None,
    "T/R DS | XMSNL":               None,
    "HYD/OIL PUMP 1P | XMSNL":      None,
    "ENG DS 1P | XMSNL":            None,
    "OIL COOL BLWR | XMSNL":        None,
    "AC GEN 1P | XMSNL":            None,
    "MRS BULL GM | XMSNL":          None,
    "MRS BULL GM RMS | XMSNL":      None,
    "MRS BULL GMX2 | XMSNL":        None,
    "MRS BULL GMX2 RMS | XMSNL":    None,
    "BEVEL GM | XMSNL":             None,
    "BEVEL GM RMS | XMSNL":         None,
    "BEVEL GMX2 | XMSNL":           None,
    "BEVEL GMX2 RMS | XMSNL":       None,
    "GEN/AC DR GM | XMSNL":         None,
    "GEN/AC DR GM RMS | XMSNL":     None,
    "GEN/AC DR GMX2 | XMSNL":       None,
    "GEN/AC DR GMX2 RMS | XMSNL":   None,
    "HELICAL GM | XMSNL":           None,
    "HELICAL GM RMS | XMSNL":       None,
    "HELICAL GMX2 | XMSNL":         None,
    "HELICAL GMX2 RMS | XMSNL":     None,
    "TRDS SO2 | HB 1":              None,
    "TRDS SO1 | HB 1":              None,
    "T/R DS 2P | HB 1":             None,
    "T/R DS | HB 1":                None,
    "TRDS SO1 | HB 2":              None,
    "TRDS SO2 | HB 2":              None,
    "T/R DS 2P | HB 2":             None,
    "T/R DS | HB 2":                None,
    "PYLON DS 1P | TR FA":          None,
    "T/R 2P | TR FA":               None,
    "T/R 1P | TR FA":               None,
    "TR GBX GMX2 | TR FA":          None,
    "TR GBX GMX2 RMS | TR FA":      None,
    "TPDS SO1 | TR FA":             None,
    "T/R 4P | TR FA":               None,
    "TR GBX GM | TR FA":            None,
    "TR GBX GM RMS | TR FA":        None,
    "PYLON DS 2P | TR FA":          None,
    "T/R SO4 | TR FA":              None,
    "TPDS SO2 | TR FA":             None,
    "T/R BALANCE | TR FA":          None,
    "TRDS SO1 | IGB V":             None,
    "T/R DS 2P | IGB V":            None,
    "TRDS SO2 | IGB V":             None,
    "T/R DS | IGB V":               None,
    "INT GBX GM | IGB V":           None,
    "INT GBX GM RMS | IGB V":       None,
    "INT GBX GMX2 | IGB V":         None,
    "INT GBX GMX2 RMS | IGB V":     None,
    "TRDS SO2 | HB 3":              [1.00, 2.00, 3.00],
    "T/R DS 2P | HB 3":             [0.70, 1.00, 1.50],
    "T/R DS | HB 3":                [0.70, 1.00, 1.50],
    "TRDS SO1 | HB 3":              [0.60, 0.90, 1.30],
    "ENGINE BB | ENG1C":            None,
    "ENGINE BB RMS | ENG1C":        None,
    "PWR TURBINE | ENG1C":          None,
    "ENGINE BB | ENG2C":            None,
    "ENGINE BB RMS | ENG2C":        None,
    "PWR TURBINE | ENG2C":          None,
}


# ── Tail detection ────────────────────────────────────────────────────────────

def detect_tail_suffix(pdf_path):
    """Return tail suffix from PDF header (e.g. 'BHT' from 'A/C # 760658_BHT')."""
    with pdfplumber.open(pdf_path) as pdf:
        for line in extract_page_lines(pdf.pages[0]):
            m = AC_HEADER_RE.search(line)
            if m:
                return m.group(1).upper()
    return None


# ── PDF text extraction (verbatim from pdf_to_excel.py) ───────────────────────

def extract_page_lines(page):
    chars = page.chars
    by_y  = defaultdict(list)
    for c in chars:
        by_y[round(c["top"])].append(c)
    lines = []
    for y in sorted(by_y.keys()):
        row_chars = sorted(by_y[y], key=lambda c: c["x0"])
        text = ""; prev_x2 = None
        for c in row_chars:
            if prev_x2 is not None and c["x0"] - prev_x2 > 4:
                text += " "
            text += c["text"]
            prev_x2 = c["x1"]
        lines.append(text.strip())
    return lines


def parse_line(line):
    parts = line.strip().split()
    if len(parts) < 8:
        return None
    try:
        ips_idx = parts.index("ips")
    except ValueError:
        return None

    date_idx = next(
        (i for i in range(ips_idx + 1, len(parts)) if DATE_RE.match(parts[i])),
        None
    )
    if date_idx is None:
        return None

    date = parts[date_idx]
    time = parts[date_idx + 1] if date_idx + 1 < len(parts) else ""
    left = parts[:ips_idx]
    if len(left) < 2:
        return None

    avg_meas = left[-1]
    chan     = left[-2]
    loc_comp = left[:-2]
    right    = parts[ips_idx + 1 : date_idx]
    if len(right) < 2:
        return None

    rpm_ord  = right[-1]
    max_meas = right[-2]
    is_rms   = (rpm_ord == "RMS")

    if is_rms:
        change = "0.000"; unit = ""
    else:
        change = right[-3] if len(right) >= 3 else ""; unit = "ips"

    if len(loc_comp) >= 2 and " ".join(loc_comp[-2:]) in TWO_WORD_LOCATIONS:
        location = " ".join(loc_comp[-2:])
        comp     = " ".join(loc_comp[:-2])
    elif loc_comp:
        location = loc_comp[-1]
        comp     = " ".join(loc_comp[:-1])
    else:
        location = comp = ""

    # RMS rows share comp+location with their order row; suffix the comp name
    # so each (comp, location) key stays unique (matches DEFAULT_LIMITS, e.g.
    # "BEVEL GMX2 RMS | XMSNF"). Location is always part of the key.
    if is_rms and comp:
        comp = f"{comp} RMS"

    def to_num(v):
        try: return float(v)
        except: return v

    return {
        "COMP/CONDITION": comp,
        "LOCATION":       location,
        "CHAN":            chan,
        "AVG MEAS":       to_num(avg_meas),
        "CHANGE IN AVG":  change,
        "MAX MEAS":       to_num(max_meas),
        "RPM_ORD":        rpm_ord,
    }


# ── Session extraction ─────────────────────────────────────────────────────────

def extract_sessions(pdf_path, progress_cb=None):
    sessions = []; current = None
    with pdfplumber.open(pdf_path) as pdf:
        total = len(pdf.pages)
        for i, page in enumerate(pdf.pages):
            if progress_cb:
                progress_cb(i + 1, total)
            for line in extract_page_lines(page):
                if not line:
                    continue
                m = HEADER_RE.search(line)
                if m:
                    current = {
                        "log_count": int(m.group(1)),
                        "started":   m.group(2).strip().rstrip(","),
                        "completed": m.group(3).strip().rstrip(","),
                        "rows":      [],
                    }
                    sessions.append(current)
                    continue
                if "COMP/CONDITION" in line or line.startswith("---"):
                    continue
                parsed = parse_line(line)
                if parsed is not None and current is not None:
                    current["rows"].append(parsed)
    return sessions


# ── Date / time helpers ────────────────────────────────────────────────────────

def parse_session_dt(s):
    """'MM-DD-YYYY HH:MM:SS' → ('YYYY-MM-DDTHH:MM:SS', 'DD-MM-YYYY')"""
    m = SESSION_DT_RE.search(s)
    if not m:
        return None, None
    date_part, time_part = m.group(1), m.group(2)   # MM-DD-YYYY, HH:MM:SS
    mo, dd, yr = date_part.split("-")
    iso_dt  = f"{yr}-{mo}-{dd}T{time_part}"
    ddmmyyyy = f"{dd}-{mo}-{yr}"
    return iso_dt, ddmmyyyy


# ── Status / trend helpers ─────────────────────────────────────────────────────

def get_status(comp_key, avg_meas, limits):
    # Mirrors the JS getLimitStatus: no limit / no measurement / below the lower
    # threshold -> "white"; at or above lower -> "ok"; then caution / alert.
    thresholds = limits.get(comp_key)
    if not thresholds or not isinstance(avg_meas, (int, float)):
        return "white"
    lower, caution, critical = thresholds
    if critical is not None and avg_meas >= critical: return "alert"
    if caution  is not None and avg_meas >= caution:  return "caution"
    if lower    is not None and avg_meas >= lower:    return "ok"
    return "white"


def _sortable(ddmmyyyy):
    """DD-MM-YYYY → YYYY-MM-DD (chronologically sortable)."""
    p = ddmmyyyy.split("-")
    return f"{p[2]}-{p[1]}-{p[0]}" if len(p) == 3 else ddmmyyyy


# ── Build import JSON structure ────────────────────────────────────────────────

def build_imports(sessions, pdf_path, tail, limits, tail_suffix=""):
    """Group sessions by date and build one import object per date."""
    # Group sessions by date (DD-MM-YYYY)
    by_date = defaultdict(list)

    for raw in sessions:
        started_iso, ddmmyyyy = parse_session_dt(raw["started"])
        completed_iso, _      = parse_session_dt(raw["completed"])

        if ddmmyyyy is None:
            # Fallback: use today's date — warn loudly, a silently reassigned
            # session date corrupts the maintenance timeline.
            print(f"WARNING: could not parse session date from "
                  f"{raw['started']!r} — falling back to today's date",
                  file=sys.stderr, flush=True)
            today = datetime.now()
            ddmmyyyy = today.strftime("%d-%m-%Y")
            started_iso = today.isoformat(timespec="seconds")
            completed_iso = started_iso

        # Build comps dict for this session — one entry per COMP | LOCATION key
        comps = {}
        # Group rows by comp key (in case multiple channels appear; take worst-case avg)
        by_key = defaultdict(list)
        for row in raw["rows"]:
            key = f"{row['COMP/CONDITION']} | {row['LOCATION']}"
            by_key[key].append(row)

        for key, rows in by_key.items():
            # Take the row with the highest avg_meas (worst-case channel)
            best = max(
                rows,
                key=lambda r: r["AVG MEAS"] if isinstance(r["AVG MEAS"], (int, float)) else 0
            )
            avg_meas = best["AVG MEAS"] if isinstance(best["AVG MEAS"], (int, float)) else None
            max_meas = best["MAX MEAS"] if isinstance(best["MAX MEAS"], (int, float)) else None
            comps[key] = {
                "avg_meas": avg_meas,
                "max_meas": max_meas,
                "status":   get_status(key, avg_meas, limits),
                "trend":    "stable",   # filled by the trend pass below
            }

        session_obj = {
            "session_id":   f"vxp_{tail}_{(started_iso or '').replace(':', '').replace('-', '').replace('T', '_')}",
            "log_count":    raw["log_count"],
            "started_at":   started_iso,
            "completed_at": completed_iso,
            "comps":        comps,
        }
        by_date[ddmmyyyy].append(session_obj)

    # ── Trend pass ─────────────────────────────────────────────────────────
    # Per comp: trend *as of* each date, computed from this PDF's own sessions
    # up to and including that date (trend_detection.detect_trend). A single
    # PDF rarely spans the full window, so these stored values are a best-
    # effort snapshot — main.cjs (incident scan) and the renderer recompute
    # trends over the tail's complete import history.
    comp_date_vals = defaultdict(lambda: defaultdict(list))   # comp → {date → [vals]}
    for ddmmyyyy, sess_list in by_date.items():
        d = _sortable(ddmmyyyy)
        for s in sess_list:
            for k, m in s["comps"].items():
                if isinstance(m["avg_meas"], (int, float)):
                    comp_date_vals[k][d].append(m["avg_meas"])

    trend_at = {}   # (comp, date) → trend label
    for k, dates in comp_date_vals.items():
        ordered = sorted(dates)
        for i, d in enumerate(ordered):
            points = [(dd, v) for dd in ordered[: i + 1] for v in dates[dd]]
            trend_at[(k, d)] = detect_trend(points)["trend"]

    for ddmmyyyy, sess_list in by_date.items():
        d = _sortable(ddmmyyyy)
        for s in sess_list:
            for k, m in s["comps"].items():
                m["trend"] = trend_at.get((k, d), "stable")

    # Build one import object per date
    source_file  = Path(pdf_path).name
    imported_at  = datetime.now().isoformat(timespec="seconds")
    result = []

    def _sort_key(item):
        return _sortable(item[0])       # DD-MM-YYYY → YYYY-MM-DD for chrono order

    for ddmmyyyy, sess_list in sorted(by_date.items(), key=_sort_key):
        # Summary: per comp key, the value from the date's chronologically
        # LATEST session (mirrors computeImportSummary in importLoader.js).
        latest = {}
        for s in sorted(sess_list, key=lambda s: s.get("started_at") or ""):
            for k, m in s["comps"].items():
                latest[k] = m

        summary = {"total": len(latest), "white": 0, "green": 0, "yellow": 0,
                   "red": 0, "up": 0, "flat": 0, "down": 0}
        for k, m in latest.items():
            has_limit = limits.get(k) is not None
            st = m["status"] if has_limit else None
            if not st or st in ("white", "nominal"):  summary["white"] += 1
            elif st in ("ok", "normal"):              summary["green"] += 1
            elif st == "caution":                     summary["yellow"] += 1
            elif st in ("alert", "critical"):         summary["red"] += 1
            tr = m.get("trend", "stable")
            if tr == "up":     summary["up"] += 1
            elif tr == "down": summary["down"] += 1
            else:              summary["flat"] += 1

        result.append({
            "import_id":   f"import_{tail or tail_suffix}_{ddmmyyyy.replace('-', '')}_{uuid.uuid4().hex[:8]}",
            "date":        ddmmyyyy,
            "tail":        tail,
            "tail_suffix": tail_suffix,
            "imported_at": imported_at,
            "source_file": source_file,
            "sessions":    sess_list,
            "summary":     summary,
        })

    return result


# ── Entry point ────────────────────────────────────────────────────────────────

def main():
    args = sys.argv[1:]
    if not args:
        print("Usage: import_vxp.py <pdf_path> [--tail <tail>] [--limits <json_string>]", file=sys.stderr)
        sys.exit(1)

    pdf_path = args[0]

    if not os.path.isfile(pdf_path):
        print(f"File not found: {pdf_path}", file=sys.stderr)
        sys.exit(1)

    # Optional explicit tail override
    tail = None
    if "--tail" in args:
        idx = args.index("--tail")
        if idx + 1 < len(args):
            tail = args[idx + 1]

    # Optional limits override
    limits = dict(DEFAULT_LIMITS)
    if "--limits" in args:
        idx = args.index("--limits")
        if idx + 1 < len(args):
            try:
                override = json.loads(args[idx + 1])
                limits.update(override)
            except json.JSONDecodeError as e:
                print(f"Warning: could not parse --limits JSON: {e}", file=sys.stderr)

    # Auto-detect tail suffix from PDF header if not explicitly provided
    tail_suffix = detect_tail_suffix(pdf_path) or ""
    if not tail:
        tail = tail_suffix  # main.cjs will resolve to full tail (e.g. BHT → 4X-BHT)

    def on_progress(page, total):
        print(f"PROGRESS {page}/{total}", file=sys.stderr, flush=True)

    sessions = extract_sessions(pdf_path, progress_cb=on_progress)
    imports  = build_imports(sessions, pdf_path, tail, limits, tail_suffix=tail_suffix)
    print(json.dumps(imports))


if __name__ == "__main__":
    main()
