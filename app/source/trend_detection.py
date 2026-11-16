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
7. Level-shift check (step change vs baseline): the slope fit only sees the
   window, so a component that JUMPED to a new level and stays there (the
   whole window sits above the old baseline, but wobbles inside it) reads
   flat — e.g. 0.02 for months, then 0.26, 0.19, 0.03, 0.10, 0.15 ips. The
   baseline is the median of up to SHIFT_BASELINE dates immediately before
   the window (need ≥ SHIFT_MIN_BASELINE). The shift threshold is
     thr = max(ABS_MIN_DELTA, SHIFT_REL × |baseline|, SHIFT_NOISE_GATE × baseline MAD)
   and a shift is called when the window median sits ≥ thr beyond the
   baseline (sustained across most of the window) AND at least 2 of the last
   SHIFT_RECENT (3) dates do too (still shifted right now — one dip inside
   the elevated band is tolerated, a spike that already returned is not).
   An UP shift overrides the slope classification (incl. a reversal veto):
   a component sitting far above its baseline is deteriorating even while it
   wobbles or eases inside the elevated band. A DOWN shift only replaces a
   "stable" slope call, so a component rebounding toward its old level after
   a drop still reads "up" (deteriorating wins every conflict). Once the baseline window has
   rolled past the step, the new level is the norm and the slope rules alone
   apply again.
8. Latest-measurement gate: a trend call must still hold at the MOST RECENT
   measurement (the last session of the latest date — the per-date median can
   hide a low final session). "up" needs that value ≥ ABS_MIN_DELTA above
   where the trend line starts (the fitted value at the window start for a
   slope call, the baseline for a level shift); "down" mirrors it. Otherwise
   → "stable" — an uptrend whose latest point is level with, or below, its
   start is not an uptrend.

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
SHIFT_BASELINE     = 10   # baseline = up to N dates right before the window
SHIFT_MIN_BASELINE = 5    # fewer baseline dates → no level-shift check
SHIFT_REL          = 0.30 # step ≥ 30% of the baseline level…
SHIFT_NOISE_GATE   = 4.0  # …and ≥ 4× the baseline MAD (its own scatter)
SHIFT_ONSET_HITS   = 0.6  # onset run: ≥ 60% of its dates beyond the threshold
SHIFT_RECENT       = 3    # "still shifted now": ≥ 2 of the last 3 dates beyond thr

TREND_UP     = "up"
TREND_DOWN   = "down"
TREND_STABLE = "stable"


def latest_measurement(points):
    """Value of the most recent measurement: the last session of the latest
    date. Points may carry a 3rd element (session start time, sortable); the
    latest time wins, ties/missing times fall back to input order.
    """
    best = None   # (date, time, index, value)
    for i, p in enumerate(points):
        date, value = p[0], p[1]
        if not isinstance(value, (int, float)):
            continue
        key = (date, (p[2] if len(p) > 2 and p[2] else ""), i)
        if best is None or key > best[:3]:
            best = (*key, value)
    return best[3] if best else None


def daily_aggregates(points):
    """[(date, value), …] → [(date, median-of-day), …] sorted by date.

    `date` may be any chronologically sortable string (YYYY-MM-DD).
    Non-numeric values are ignored.
    """
    by_date = defaultdict(list)
    for date, value, *_ in points:
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


def detect_level_shift(prior_values, window_values, abs_min_delta=ABS_MIN_DELTA):
    """Step change of the window vs the baseline just before it.

    prior_values: per-date values BEFORE the window (chronological).
    Returns (shift, baseline, level, thr): shift is None, "up" or "down";
    baseline = median of the last SHIFT_BASELINE prior values, level =
    median of the window (both None when there is too little history), thr
    the step threshold.
    """
    base_vals = prior_values[-SHIFT_BASELINE:]
    if len(base_vals) < SHIFT_MIN_BASELINE or not window_values:
        return None, None, None, None
    baseline = median(base_vals)
    level = median(window_values)
    thr = max(abs_min_delta, SHIFT_REL * abs(baseline),
              SHIFT_NOISE_GATE * median_abs_dev(base_vals))
    recent = window_values[-SHIFT_RECENT:]
    need = len(recent) // 2 + 1                 # majority of the last dates
    if (level - baseline >= thr
            and sum(v - baseline >= thr for v in recent) >= need):
        return TREND_UP, baseline, level, thr
    if (baseline - level >= thr
            and sum(baseline - v >= thr for v in recent) >= need):
        return TREND_DOWN, baseline, level, thr
    return None, baseline, level, thr


def shift_onset(values, shift, baseline, thr, window=WINDOW):
    """Index where a level shift STARTED: the earliest date (within the last
    window + SHIFT_BASELINE dates) that is itself beyond the threshold and
    from which ≥ SHIFT_ONSET_HITS of the dates through the latest are too —
    so a one-date dip inside the elevated band doesn't cut the run short.
    """
    sign = 1 if shift == TREND_UP else -1
    beyond = [sign * (v - baseline) >= thr for v in values]
    n = len(values)
    onset = n - 1
    hits = 0
    for i in range(n - 1, max(-1, n - 1 - window - SHIFT_BASELINE), -1):
        hits += beyond[i]
        if beyond[i] and hits / (n - i) >= SHIFT_ONSET_HITS:
            onset = i
    return onset


def detect_trend(points, window=WINDOW, min_dates=MIN_DATES,
                 rel_threshold=REL_THRESHOLD, abs_min_delta=ABS_MIN_DELTA,
                 min_tau=MIN_TAU, reversal_veto=REVERSAL_VETO,
                 noise_gate=NOISE_GATE):
    """Classify the trend of a component series.

    points: iterable of (date, value) or (date, value, session_time) tuples,
            session-level — multiple entries per date are fine (they are
            median-aggregated per date; the time picks the latest session).
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
      shift      None, or "up"/"down" when a level shift vs the baseline
                 drove the call (step 7); None when the slope call stood
      baseline   median of the pre-window baseline dates (None if too few)
      level      median of the window values (None if no baseline)
      onset      date the current trend started: the first date of the
                 level shift, or the window's first date for a slope call
                 (None when stable) — charts draw onset → latest
      current    the most recent measurement (last session of the latest date)
      dates      the window's dates (chronological) the fit was computed on
    """
    points = list(points)
    aggs = daily_aggregates(points)
    if len(aggs) < min_dates:
        return {"trend": TREND_STABLE, "slope": 0.0, "intercept": 0.0,
                "delta": 0.0, "rel_change": 0.0, "tau": 0.0,
                "span_days": 0, "noise": 0.0, "reversal": None,
                "shift": None, "baseline": None, "level": None,
                "onset": None, "current": latest_measurement(points),
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

    # Level shift vs the pre-window baseline. An UP shift overrides any slope
    # call (elevated far above baseline = deteriorating, even while easing
    # inside the new band); a DOWN shift only fills in a "stable" slope call,
    # so a component rebounding toward its old level still reads "up".
    shift, baseline, level, thr = detect_level_shift(
        [v for _, v in aggs[:-len(tail)]], values, abs_min_delta)
    onset = dates[0] if trend != TREND_STABLE else None
    if shift == TREND_UP or (shift == TREND_DOWN and trend == TREND_STABLE):
        trend, reversal = shift, None
        all_vals = [v for _, v in aggs]
        onset = aggs[shift_onset(all_vals, shift, baseline, thr, window)][0]
    else:
        shift = None   # report a shift only when it drove the call

    # Latest-measurement gate (step 8): the newest session must sit beyond
    # the trend line's start, or the call does not stand.
    current = latest_measurement(points)
    if trend != TREND_STABLE and current is not None:
        start = baseline if shift else intercept
        if ((trend == TREND_UP and current - start < abs_min_delta) or
                (trend == TREND_DOWN and start - current < abs_min_delta)):
            trend, shift, onset = TREND_STABLE, None, None

    return {"trend": trend, "slope": slope, "intercept": intercept,
            "delta": delta, "rel_change": rel, "tau": tau,
            "span_days": span, "noise": noise, "reversal": reversal,
            "shift": shift, "baseline": baseline, "level": level,
            "onset": onset, "current": current, "dates": dates}


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
