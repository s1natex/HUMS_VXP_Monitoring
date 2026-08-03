"""
Robust per-component trend detection for HUMS/VXP vibration series.

Reference implementation — mirrored in JS by:
  - app/frontend/electron/main.cjs        (incident scanning at import time)
  - app/frontend/src/utils/trendDetection.js (live UI recomputation)
Keep constants and classification logic in sync across all three.

Classification labels (see constants/status.js trendLabel):
  "up"     → DETERIORATING (vibration rising toward/through limits)
  "down"   → RECOVERING    (vibration falling)
  "stable" → STABLE        (flat, or not enough history to judge)

Algorithm
─────────
1. Aggregate sessions to ONE value per date using the median — a single bad
   session inside a multi-session day cannot skew that day's level.
2. Look at a mid-range window: the last WINDOW (5) dates. Require at least
   MIN_DATES (4) distinct dates, otherwise the answer is "stable"
   (insufficient data — never guess a trend from 2-3 points).
3. Fit a Theil-Sen line over CALENDAR DAYS (not the date index): the slope is
   the MEDIAN of all pairwise slopes between the window's points, in
   ips per day. Unlike least-squares, one outlier date cannot flip the sign
   of the fit, and real day spacing means irregular import schedules
   (1, 2, 3, then 30 days apart) are weighted correctly.
4. Project the slope across the window's day span (delta = slope × span_days)
   and normalise by the window mean (rel_change = delta / mean).
5. Consistency gate (Mann-Kendall): Kendall's tau over the window values —
   the fraction of pairwise comparisons agreeing in direction. |tau| must be
   ≥ MIN_TAU (0.5) for a trend call, so a zigzag series with a small net
   drift stays "stable"; only consistent movement classifies.
5b. Noise gate: |delta| must also be ≥ NOISE_GATE (2.0) × the MAD of the fit
   residuals — the projected change has to clear the series' own scatter, so
   a jittery-but-flat component never classifies as trending.
6. Classify:
     delta ≥ +ABS_MIN_DELTA and rel_change ≥ +REL_THRESHOLD and tau ≥ +MIN_TAU → "up"
     delta ≤ −ABS_MIN_DELTA and rel_change ≤ −REL_THRESHOLD and tau ≤ −MIN_TAU → "down"
     otherwise                                                                 → "stable"
   The relative gate scales with the component's level (0.03 ips of drift
   means nothing at 2.0 ips but a lot at 0.15 ips); the absolute gate stops
   near-zero series from tripping the relative test on noise. The mean (not
   the limit span) is used as the reference deliberately: trend detection is
   an EARLY-WARNING signal and must fire on consistent growth even while the
   component is still well below its limits.

CLI (for testing):
  python trend_detection.py '[["2026-06-01", 0.21], ["2026-06-04", 0.24], ...]'
  echo <json> | python trend_detection.py
Outputs the full detection dict as JSON.
"""

import json
import sys
from collections import defaultdict
from datetime import date as _date
from statistics import mean, median

# Tunables — keep in sync with main.cjs / trendDetection.js
WINDOW        = 5     # analyse the last N import dates
MIN_DATES     = 4     # fewer distinct dates → "stable" (insufficient data)
REL_THRESHOLD = 0.15  # |projected change| must be ≥ 15% of the window mean
ABS_MIN_DELTA = 0.02  # …and ≥ 0.02 ips in absolute terms
MIN_TAU       = 0.5   # Mann-Kendall consistency: |tau| ≥ 0.5 for a trend call
REVERSAL_VETO = 0.35  # last date ≥ 35% of |delta| below the fit cancels the call
NOISE_GATE    = 2.0   # …and |delta| ≥ 2× the residual MAD (fit noise)

TREND_UP     = "up"
TREND_DOWN   = "down"
TREND_STABLE = "stable"


def daily_aggregates(points):
    """[(date, value), …] → [(date, median-of-day), …] sorted by date.

    `date` may be any chronologically sortable string (YYYY-MM-DD).
    Non-numeric values are ignored.
    """
    by_date = defaultdict(list)
    for date, value in points:
        if isinstance(value, (int, float)):
            by_date[date].append(value)
    return [(d, median(by_date[d])) for d in sorted(by_date)]


def _day_number(date_str):
    """'YYYY-MM-DD' → ordinal day number, or None if unparseable."""
    try:
        y, m, d = (int(x) for x in date_str.split("-")[:3])
        return _date(y, m, d).toordinal()
    except (ValueError, TypeError):
        return None


def theil_sen(xs, values):
    """(slope, intercept) of a Theil-Sen fit of values over positions xs.

    slope = median of all pairwise slopes; intercept = median residual at
    x = 0. With xs in calendar days the slope is in ips per day, so
    irregular import spacing is weighted correctly.
    """
    n = len(values)
    if n < 2:
        return 0.0, (values[0] if values else 0.0)
    slopes = [
        (values[j] - values[i]) / (xs[j] - xs[i])
        for i in range(n) for j in range(i + 1, n)
        if xs[j] != xs[i]
    ]
    if not slopes:
        return 0.0, median(values)
    slope = median(slopes)
    intercept = median(v - slope * x for x, v in zip(xs, values))
    return slope, intercept


def median_abs_dev(values):
    """Median absolute deviation — robust scatter estimate of the fit residuals."""
    m = median(values)
    return median(abs(v - m) for v in values)


def kendall_tau(values):
    """Mann-Kendall consistency: (concordant − discordant) / all pairs ∈ [−1, 1].

    +1 = every pair rises, −1 = every pair falls, near 0 = zigzag/flat.
    Ties count in the denominator only, so flat-ish series score low.
    """
    n = len(values)
    if n < 2:
        return 0.0
    c = d = 0
    for i in range(n):
        for j in range(i + 1, n):
            diff = values[j] - values[i]
            if diff > 0:
                c += 1
            elif diff < 0:
                d += 1
    return (c - d) / (n * (n - 1) / 2)


def detect_trend(points, window=WINDOW, min_dates=MIN_DATES,
                 rel_threshold=REL_THRESHOLD, abs_min_delta=ABS_MIN_DELTA,
                 min_tau=MIN_TAU, reversal_veto=REVERSAL_VETO,
                 noise_gate=NOISE_GATE):
    """Classify the trend of a component series.

    points: iterable of (date, value) pairs, session-level — multiple entries
            per date are fine (they are median-aggregated per date).
    Returns a dict:
      trend      "up" | "down" | "stable"
      slope      Theil-Sen slope in value units per DAY (window points only)
      intercept  fitted value at the first window date
      delta      projected change across the window (slope × span_days)
      rel_change delta / window mean
      tau        Mann-Kendall consistency of the window ∈ [−1, 1]
      span_days  calendar days covered by the window
      noise      MAD of the fit residuals (the series' own scatter)
      reversal   None, or "fall"/"rise" when a sharp last-date move against
                 an otherwise-qualified trend cancelled the call
      dates      the window's dates (chronological) the fit was computed on
    """
    aggs = daily_aggregates(points)
    if len(aggs) < min_dates:
        return {"trend": TREND_STABLE, "slope": 0.0, "intercept": 0.0,
                "delta": 0.0, "rel_change": 0.0, "tau": 0.0,
                "span_days": 0, "noise": 0.0, "reversal": None,
                "dates": [d for d, _ in aggs]}

    tail = aggs[-window:]
    dates  = [d for d, _ in tail]
    values = [v for _, v in tail]

    # Calendar-day x positions; fall back to index spacing if a date is odd.
    days = [_day_number(d) for d in dates]
    xs = ([day - days[0] for day in days] if all(day is not None for day in days)
          else list(range(len(values))))

    slope, intercept = theil_sen(xs, values)
    span  = xs[-1] - xs[0]
    delta = slope * span
    ref   = max(mean(values), 1e-9)
    rel   = delta / ref
    tau   = kendall_tau(values)

    # Noise gate: the projected change must clear the scatter around the fit
    # (residual MAD), so a "trend" smaller than the series' own noise never
    # classifies — kills false calls on jittery-but-flat components.
    noise = median_abs_dev([v - (intercept + slope * x)
                            for x, v in zip(xs, values)])
    clears_noise = abs(delta) >= noise_gate * noise

    # Sharp-reversal veto: the last date landing well off the FITTED LINE
    # against the trend means it is broken RIGHT NOW — report stable, flag
    # the reversal. Judged on the last date's residual (not the step from the
    # previous date), so an outlier spike one date earlier can't fake a
    # reversal while the last value still sits on the trend.
    last_resid = values[-1] - (intercept + slope * xs[-1])
    veto_size = max(abs_min_delta, reversal_veto * abs(delta))

    trend, reversal = TREND_STABLE, None
    if delta >= abs_min_delta and rel >= rel_threshold and tau >= min_tau and clears_noise:
        if last_resid <= -veto_size:
            reversal = "fall"
        else:
            trend = TREND_UP
    elif delta <= -abs_min_delta and rel <= -rel_threshold and tau <= -min_tau and clears_noise:
        if last_resid >= veto_size:
            reversal = "rise"
        else:
            trend = TREND_DOWN

    return {"trend": trend, "slope": slope, "intercept": intercept,
            "delta": delta, "rel_change": rel, "tau": tau,
            "span_days": span, "noise": noise, "reversal": reversal,
            "dates": dates}


def main():
    raw = sys.argv[1] if len(sys.argv) > 1 else sys.stdin.read()
    try:
        points = json.loads(raw)
    except json.JSONDecodeError as e:
        print(f"Invalid JSON input: {e}", file=sys.stderr)
        sys.exit(1)
    print(json.dumps(detect_trend([tuple(p) for p in points])))


if __name__ == "__main__":
    main()
