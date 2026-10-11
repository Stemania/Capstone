"""Forecasting methods for monthly series (objective 4.3), pure functions only.

Three standard methods are compared on every series with a rolling-origin
back-test (one month ahead, refit at each origin):

  MA3   3-month moving average        F(t+h) = mean(y[t-2..t])
  SES   simple exponential smoothing  l(t) = a*y(t) + (1-a)*l(t-1); F(t+h) = l(t)
  HOLT  Holt's linear trend           l(t) = a*y(t) + (1-a)*(l(t-1)+b(t-1))
                                      b(t) = b*(l(t)-l(t-1)) + (1-b)*b(t-1)
                                      F(t+h) = l(t) + h*b(t)

Smoothing constants are chosen from a 0.1..0.9 grid by the lowest in-sample
one-step squared error. The method with the lowest back-test MAPE wins; when
MAPE is undefined (a back-tested month had 0) the lowest MAE wins. Ties go to
the simpler method (MA3, then SES, then HOLT).

The prediction interval is the point forecast +/- z * RMSE * sqrt(h), where
RMSE is the chosen method's back-test error and z = 1.2816 (80%). Forecasts
and lower bounds are never below 0.
"""

from __future__ import annotations

import math

MA_WINDOW = 3
MIN_TRAIN = 3
GRID = tuple(round(0.1 * i, 1) for i in range(1, 10))
Z_80 = 1.2816
INTERVAL_LEVEL = 80

METHOD_ORDER = ("MA3", "SES", "HOLT")
METHOD_NAMES = {
    "MA3": "3-month moving average",
    "SES": "Simple exponential smoothing",
    "HOLT": "Holt's linear trend",
}


# --- Methods -------------------------------------------------------------------


def moving_average_forecast(values, window=MA_WINDOW):
    """Flat forecast: the mean of the last ``window`` values, or None."""
    if len(values) < window:
        return None
    return sum(values[-window:]) / window


def ses_sse(values, alpha):
    """In-sample one-step squared error of SES started at the first value."""
    level = values[0]
    sse = 0.0
    for y in values[1:]:
        sse += (y - level) ** 2
        level = alpha * y + (1 - alpha) * level
    return sse


def ses_level(values, alpha):
    level = values[0]
    for y in values[1:]:
        level = alpha * y + (1 - alpha) * level
    return level


def fit_ses(values):
    """(alpha, final level) with alpha from the grid; None with no values."""
    if not values:
        return None
    if len(values) == 1:
        return GRID[0], float(values[0])
    alpha = min(GRID, key=lambda a: (ses_sse(values, a), a))
    return alpha, ses_level(values, alpha)


def holt_run(values, alpha, beta):
    """(level, trend, sse) of Holt's method.

    Starts with level = y0 and trend = y1 - y0; the one-step errors are taken
    from the third value on, since the second one fixes the starting trend.
    """
    level, trend = float(values[0]), float(values[1] - values[0])
    sse = 0.0
    for i, y in enumerate(values[1:], start=1):
        if i >= 2:
            sse += (y - (level + trend)) ** 2
        new_level = alpha * y + (1 - alpha) * (level + trend)
        trend = beta * (new_level - level) + (1 - beta) * trend
        level = new_level
    return level, trend, sse


def fit_holt(values):
    """(alpha, beta, level, trend) from the grid; None with fewer than 2 values."""
    if len(values) < 2:
        return None
    alpha, beta = min(
        ((a, b) for a in GRID for b in GRID),
        key=lambda ab: (holt_run(values, ab[0], ab[1])[2], ab[0], ab[1]),
    )
    level, trend, _ = holt_run(values, alpha, beta)
    return alpha, beta, level, trend


def forecast(method, values, h=1):
    """Point forecast ``h`` steps after the last value, or None."""
    if method == "MA3":
        f = moving_average_forecast(values)
        return None if f is None else f
    if method == "SES":
        fit = fit_ses(values)
        return None if fit is None else fit[1]
    if method == "HOLT":
        fit = fit_holt(values)
        return None if fit is None else fit[2] + h * fit[3]
    raise ValueError(f"Unknown method {method}")


def parameters(method, values):
    """The fitted smoothing constants, for display."""
    if method == "SES":
        fit = fit_ses(values)
        return {"alpha": fit[0]} if fit else {}
    if method == "HOLT":
        fit = fit_holt(values)
        return {"alpha": fit[0], "beta": fit[1]} if fit else {}
    return {"window": MA_WINDOW}


# --- Error measures ------------------------------------------------------------


def mae(actuals, forecasts):
    """Mean absolute error, or None with no pairs."""
    if not actuals:
        return None
    return sum(abs(a - f) for a, f in zip(actuals, forecasts)) / len(actuals)


def mape(actuals, forecasts):
    """Mean absolute percentage error in %. None with no pairs or when any
    actual is 0 (the percentage is undefined)."""
    if not actuals or any(a == 0 for a in actuals):
        return None
    return sum(abs(a - f) / abs(a) for a, f in zip(actuals, forecasts)) / len(actuals) * 100.0


def rmse(actuals, forecasts):
    if not actuals:
        return None
    return math.sqrt(sum((a - f) ** 2 for a, f in zip(actuals, forecasts)) / len(actuals))


def rolling_backtest(values, method, min_train=MIN_TRAIN):
    """One-step-ahead forecasts from each origin t >= min_train, refit on values[:t].

    Returns a list of {index, forecast, actual}.
    """
    rows = []
    for t in range(min_train, len(values)):
        f = forecast(method, values[:t], 1)
        if f is None:
            continue
        rows.append({"index": t, "forecast": max(f, 0.0), "actual": float(values[t])})
    return rows


def evaluate(values, min_train=MIN_TRAIN):
    """Back-test every method on the same origins.

    Returns {method: {rows, mae, mapePct, rmse, backtestedMonths}}.
    """
    out = {}
    for m in METHOD_ORDER:
        rows = rolling_backtest(values, m, min_train)
        a = [r["actual"] for r in rows]
        f = [r["forecast"] for r in rows]
        out[m] = {
            "rows": rows,
            "mae": mae(a, f),
            "mapePct": mape(a, f),
            "rmse": rmse(a, f),
            "backtestedMonths": len(rows),
        }
    return out


def select_method(results):
    """(method, metric): lowest MAPE when every method has one, else lowest MAE."""
    usable = [m for m in METHOD_ORDER if results[m]["backtestedMonths"]]
    if not usable:
        return None, None
    if all(results[m]["mapePct"] is not None for m in usable):
        metric, key = "MAPE", "mapePct"
    else:
        metric, key = "MAE", "mae"
    best = min(usable, key=lambda m: (round(results[m][key], 9), METHOD_ORDER.index(m)))
    return best, metric


def interval(point, error_rmse, h, z=Z_80):
    """(lower, upper) of point +/- z * rmse * sqrt(h), lower never below 0."""
    if point is None or error_rmse is None:
        return None, None
    half = z * error_rmse * math.sqrt(h)
    return max(point - half, 0.0), point + half
