# Analytics methods

How every number in **Analytics** is calculated: the method, its formula, its
inputs, the minimum data it needs, and where it appears. Grouped by objective 4.

| # | Method | Objective | Tab (card) | Minimum data |
|---|---|---|---|---|
| 1 | KPI change vs previous period | 4.1 | every tab (KPI tiles) | a previous period of the same length |
| 2 | Weekly output and time vs target | 4.1 | Production, Overview | 2 weeks |
| 3 | Machine use by week (heatmap) | 4.1 | Production | 1 week |
| 4 | Workload, next 4 weeks | 4.1 | Production | scheduled operations |
| 5 | Sales and job orders over time | 4.1 | Sales & demand, Overview | 1 finished job |
| 6 | Delay hours and Pareto analysis | 4.2 | Delays, Overview | 1 delay hour |
| 7 | Monthly forecasts (MA3, SES, Holt) | 4.3 | Sales & demand, Overview | 6 full months |
| 8 | Job-completion estimates | 4.3 | Production, Overview | 5 finished operations per ratio |
| 9 | Consumable run-out and reorder point | 4.3 | Inventory, Overview | 2 stocktakes |
| 10 | Supplier reliability score and grade | 4.4 | Suppliers, Overview (Office Staff) | 3 deliveries due |
| 11 | Performance vs target | 4.4 | Workers | 5 finished operations |
| 12 | Worker recommendation weights | 4.4 | Workers | 2 finished operations of the type |

Code: `api/app/services/forecast_methods.py` (forecast methods),
`forecast_service.py` (monthly series, consumables), `analytics_service.py`
(Pareto, utilization, completion estimates, KPIs),
`completion_estimate_service.py`, `supplier_reliability_service.py`,
`scoring_service.py`. Known-value tests: `api/tests/test_analytics_methods.py`.

Roles: Office Staff sees Overview, Sales & demand, Inventory, Suppliers and
Reports. Production, Delays and Workers, and the production cards on the
Admin Overview, are Admin only.

---

## 4.1 Descriptive

### 1. KPI change vs previous period

Each KPI is computed for the selected period and for the same number of days
just before it.

- Counts and amounts: $\Delta\% = \dfrac{x_{now} - x_{prev}}{|x_{prev}|} \times 100$.
  No arrow when $x_{prev} = 0$ or missing.
- Rates (on time, redo rate, time vs target): the change is in percentage
  points, $x_{now} - x_{prev}$.
- The arrow is green when the change is in the good direction (up for jobs,
  sales, on time; down for delay hours, days late, redo rate, time vs target).

On-time rate $= \dfrac{\text{delivered on or before the date required}}{\text{delivered}} \times 100$.

### 2. Weekly output and time vs target

- **Inputs:** finished original operations (redo work left out) with a target
  time, grouped by the Monday of the week they finished; jobs finished per week.
- **Time vs target** of an operation: $v = \dfrac{h_{worked} - h_{target}}{h_{target}} \times 100$.
  The weekly value is the mean of $v$. Below 0 is faster than target.
- **Chart:** straight-line chart, symmetric axis around 0.
- **UI:** Production → *Weekly output*, *Time vs target*; Overview → *Weekly output*.

### 3. Machine use by week (heatmap)

- **Inputs:** operation time logs on each active machine unit, the crew's
  working segments, the shop calendar.
- **Formula:** for unit $u$ and week $w$,
  $U_{u,w} = \min\left(\dfrac{\text{running hours of } u \text{ inside working segments in } w}{\text{shop available hours in } w},\ 1\right) \times 100$.
  The *Avg* column is total running hours ÷ total available hours.
- **Minimum data:** one week in the period. Units with no running time are
  listed under the heatmap as *Idle all period*.
- **UI:** Production → *Machine use by week*. Endpoint `/analytics/utilization/weekly` (Admin).

### 4. Workload, next 4 weeks

- **Formula:** per machine type, $\dfrac{\text{scheduled operation hours in the next 4 weeks}}{\text{available hours per unit} \times \text{active units}} \times 100$; flagged at 80%.
- **UI:** Production → *Workload, next 4 weeks* (dashed line at 80%).

### 5. Sales and job orders over time

- **Sales:** amount of jobs that are Completed or For Delivery, dated by the
  end of their last finished operation.
- **Job orders received:** dated by PO date, else creation date.
- **Pipeline:** released jobs not yet Completed or For Delivery, by expected
  finish month (scheduled end, else date required).
- **UI:** Sales & demand (KPIs, pipeline, sales by client and job type), the
  actual line of both forecast charts.

---

## 4.2 Diagnostic

### 6. Delay hours and Pareto analysis

- **Inputs (existing delay categories and rules, unchanged):** working hours
  lost to late materials, pause reasons, machine breakdowns and redo work in
  the period. Breaks and end-of-shift pauses are not delays. A "Machine down"
  pause that overlaps a breakdown on the same machine is counted once.
- **Formula:** sort causes by hours, largest first. For cause $i$ of $n$ with
  hours $h_i$ and total $H = \sum h$:

  $$\text{share}_i = \frac{h_i}{H} \times 100 \qquad \text{cumulative}_i = \min\left(\sum_{j \le i} \text{share}_j,\ 100\right)$$

  The **vital few** are the causes up to and including the first one whose
  cumulative share reaches 80%.
- **Chart:** bars sorted descending (vital few in blue), cumulative % line on a
  fixed 0–100% right axis, dashed reference line at 80%.
- **Minimum data:** one cause with hours above 0.
- **UI:** Delays → *Delay causes (Pareto)*; Overview → *Top delay causes*.
  Also on Delays: breakdowns by machine, redo by reason, material delays,
  late jobs with their recorded causes.

---

## 4.3 Predictive

### 7. Monthly forecasts: sales and job-order demand

**Series.** Monthly totals of sales (method 5) and of job orders received
(overall and per job type). Only full months are used:

- the current month is in progress and is left out (its total so far is shown
  as a hollow grey dot, not as an actual);
- the first month counts only if records start on or before its first working
  day (Monday–Saturday); otherwise it is partial and left out;
- months with no records inside the history are 0.

**Methods compared** ($y_t$ = month $t$, $h$ = months ahead):

| Method | Formula |
|---|---|
| 3-month moving average (MA3) | $\hat y_{t+h} = \frac{1}{3}(y_t + y_{t-1} + y_{t-2})$ |
| Simple exponential smoothing (SES) | $\ell_t = \alpha y_t + (1-\alpha)\ell_{t-1}$, $\ell_0 = y_0$; $\hat y_{t+h} = \ell_t$ |
| Holt's linear trend | $\ell_t = \alpha y_t + (1-\alpha)(\ell_{t-1} + b_{t-1})$; $b_t = \beta(\ell_t - \ell_{t-1}) + (1-\beta) b_{t-1}$; $\ell_0 = y_0$, $b_0 = y_1 - y_0$; $\hat y_{t+h} = \ell_t + h\,b_t$ |

$\alpha$ and $\beta$ are chosen from $\{0.1, 0.2, \dots, 0.9\}$ by the lowest
in-sample one-step squared error (ties: the smaller constant).

**Rolling back-test.** For every origin $t \ge 3$, each method is refitted on
$y_0..y_{t-1}$ and forecasts $y_t$ one month ahead (forecasts below 0 become 0).
On those pairs:

$$\text{MAE} = \frac{1}{n}\sum |y_t - \hat y_t| \qquad \text{MAPE} = \frac{100}{n}\sum \frac{|y_t - \hat y_t|}{|y_t|} \qquad \text{RMSE} = \sqrt{\frac{1}{n}\sum (y_t - \hat y_t)^2}$$

**Selection.** The method with the lowest MAPE is used. MAPE is undefined when
a back-tested month is 0; then the lowest MAE is used. Ties go to the simpler
method (MA3, then SES, then Holt).

**Forecast and interval.** The chosen method forecasts the current month and
the next two ($h = 1..3$). The 80% prediction interval is

$$\hat y_{t+h} \pm 1.2816 \times \text{RMSE} \times \sqrt{h}$$

with the lower bound floored at 0.

- **Minimum data:** 6 full months (3 to start the back-test + 3 back-tested
  months). With fewer, the card shows the actual line and *Not enough history
  yet · n of 6 full months*, and no forecast.
- **Chart:** actuals solid, forecast dashed (joined to the last actual), band
  for the 80% range; method name and its MAPE (or MAE) in small text; the (i)
  lists the excluded months and all three methods' errors.
- **UI:** Sales & demand → *Sales forecast*, *Job order demand* (All /
  per job type); Overview → both. Endpoints `/analytics/sales/forecast`,
  `/analytics/demand/forecast`.

### 8. Job-completion estimates

- **Inputs:** completed original operations (redo work and outsourced types
  left out) with hours worked and a target.
- **Ratio** for a group of operations: $r = \dfrac{\sum h_{worked}}{\sum h_{target}}$,
  used only with at least 5 operations, else $r = 1$ (target time).
- **Which ratio:** the lead worker's ratio on that operation type, else the
  machine unit's on that type, else the operation type's, else 1.
- **Prediction:** remaining operations of a released job are laid one after
  another from now on the crew's working hours (overtime and holidays
  included). A pending operation takes $h_{target} \times r$; an in-progress one
  takes $\max(h_{target} \times r - h_{worked\ so\ far}, 0)$. Outsourced
  operations use their supplier date.
- **Compared with the date required:** finish = later of predicted and
  scheduled finish; slack = date required − finish (days). On track if the finish
  is on or before the date required, At risk if one day after, Late otherwise.
- **UI:** Production → *Open jobs: predicted finish* (the (i) lists each
  operation type's ratio and samples); Overview → *Open jobs at risk*. The job
  page and at-risk alerts use the same estimate. Endpoint
  `/analytics/completion-estimates` (Admin).

### 9. Consumable run-out and reorder point

For each consumable:

- **Daily use** $\bar u$ = mean over its last 3 stocktake periods of
  $\dfrac{\text{previous count} + \text{deliveries} - \text{count}}{\text{shop working days in the period}}$.
- **On hand today** $= \text{last count} + \text{deliveries since} - \bar u \times \text{working days since}$ (not below 0).
- **Days of cover** $= \text{on hand} / \bar u$, counted forward on the shop
  calendar to give the **run-out date**.
- **Lead time** $L$ (working days): the average order-to-receipt days of past
  restocks of that item, else the supplier's stated lead time, else 7 days.
- **Safety stock** $SS = z \times s_u \times \sqrt{L}$, $z = 1.65$ (95% service
  level), $s_u$ = sample standard deviation of the period daily uses (0 with
  fewer than 2 periods).
- **Reorder point** $ROP = \bar u \times L + SS$.
- **Status:** *Likely out* if on hand ≤ 0; *Reorder now* if on hand ≤ ROP;
  *OK* otherwise; *No usage yet* with fewer than 2 stocktakes.
- **Minimum data:** 2 stocktakes (one period).
- **UI:** Inventory → *Consumables* (stock bar = on hand, tick = reorder
  point; hover the reorder value for lead time and safety stock); Overview →
  *Stock alerts*. Endpoint `/analytics/consumables/run-out`.

---

## 4.4 Prescriptive

### 10. Supplier reliability score

- **Inputs:** one delivery per supplier order (or per line without a PO),
  promised in the selected period; due once received or past its promised date.
- **Parts (each 0–1):**

  | Part | Weight | Formula |
  |---|---|---|
  | On-time delivery rate | 50% | $p_1 = \dfrac{\text{on time}}{\text{due}}$ (received on or before the promised date) |
  | Average days late | 30% | $p_2 = \max\left(0,\ 1 - \dfrac{\bar d_{late}}{7}\right)$, $\bar d_{late}$ = mean days late of the late deliveries |
  | Actual vs stated lead time | 20% | $p_3 = \min\left(1,\ \dfrac{\text{stated lead days}}{\text{mean actual order-to-receipt days}}\right)$ |

- **Score** $= 100 \times \dfrac{\sum w_k p_k}{\sum w_k}$ over the parts with
  data (a missing part passes its weight to the others).
- **Grade:** A ≥ 90, B ≥ 80, C ≥ 70, D below 70.
- **Minimum data:** 3 deliveries due in the period; fewer shows *Not enough
  deliveries* (listed under the cards with their count).
- **UI:** Suppliers → *Supplier reliability* (ring = score, colour = grade;
  weights in the (i)); Overview (Office Staff) → *Supplier scores*. The
  on-time % and *Not enough deliveries* label are also used when ordering
  materials.

### 11. Performance vs target

- **Formula:** per worker, operation type or machine unit, the mean of
  $v = \dfrac{h_{worked} - h_{target}}{h_{target}} \times 100$ over finished
  original operations in the period. Also: on-target rate (share within the
  on-target band), target and worked hours.
- **Minimum data:** 5 finished operations per row; others are not shown
  (a note says so when fewer than 3 rows qualify).
- **Chart:** diverging bars around 0, faster (left, teal) and slower (right,
  amber), sorted fastest first; optional table.
- **UI:** Workers → *Performance vs target* (Worker / Operation / Machine).

### 12. Worker recommendation (unchanged)

Candidates who are available are ranked by a weighted sum of 0–1 factor
scores:

| Suggestion | Weights |
|---|---|
| Machine operation, lead | assigned operator 40%, skill 30%, past performance 20%, workload 10% |
| No machine | past performance 60%, workload 40% |
| Helper | past performance 50%, workload 50% |

- **Past performance** = mean over the worker's finished operations of that
  type (all types when fewer than 2) of $\dfrac{\min(h_{target} / h_{worked},\ 1.5)}{1.5}$;
  0.5 with fewer than 2 operations. This is the data shown in method 11.
- **Workload** = min–max among the candidates' hours booked this week:
  $\dfrac{h_{max} - h_{worker}}{h_{max} - h_{min}}$ (lightest 1, heaviest 0;
  all equal 1).
- **Availability** is a filter, not a weight.
- **UI:** Workers → *How workers are recommended*; full detail on
  Settings → Scoring weights.
