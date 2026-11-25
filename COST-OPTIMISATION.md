# Session Builder cost optimisation

The planner minimises annual workforce cost with mixed-integer programming. Each
decision variable is a whole recurring weekly session, assigned to a session type,
clinician type and weekday; internal period slots are aggregated in the display. Cost is the assigned clinician's saved
annualised sessional rate multiplied by the weekly session count, without another
52-week multiplier. The cost column shows actual assignments rather than equal
splits across eligible clinician types.

Hard constraints include clinician weekly minima/maxima across all session types,
working-pattern masks, consultation-mode capacities, appointment eligibility,
forecast/historical demand, and enabled Must meet rules. Planned care and daily
urgent demand are pooled; routine and weekly urgent type eligibility is retained.
Prefer rules are evaluated and reported but do not override the cost objective.
Weekly distribution is an optional rule type; no rule is created automatically.
Allocation can be any configured appointment type. Planned-care selections use the
shared Planned care pool. Targets can be even or custom percentages (totalling
100% across selected weekdays), with a tolerance in percentage points. Must meet
rules enforce each day's share of the weekly selected allocation, and disallow
that allocation on unselected days. Session spread is a separate, optional rule: it balances each selected session type across the chosen weekdays within a configurable whole-session tolerance. No session spread rule is added automatically. Prefer rules minimise appointments outside these ranges after cost, productive
capacity, session count and allocated-appointment totals have been considered.
The preferred distribution cannot increase those earlier totals. All allocations
stay whole and must still cover each demand target. Changes apply only on Reset planner.

Session counts and costs describe contracted recurring weekly commitments.
Average productive appointment capacity is reduced by
`(52 - annualLeaveWeeks) / 52 * (1 - sicknessPercent / 100)`. Missing leave/sickness
settings use the Clinician Setup defaults of five weeks and zero percent.
Predicted need remains a fractional weekly average. Session counts and all provided,
allocated and unallocated appointment counts are integers. Productive consultation-mode
capacity per session is rounded down after absence adjustment, while required slots
round demand up. Forecast appointment-type proportions allow a one-slot deviation so
they do not force fractional allocations. Required percentage rules remain exact. Unallocated slots remain visible and cannot satisfy demand/share rules.

Missing annual rates stop cost optimisation. An explicitly entered zero is allowed.
The model is solved only when Reset planner is clicked. It runs in a background
worker with a shared twenty-second budget. The primary search minimises annual cost;
a reserved refinement reduces productive capacity without increasing the best cost found.
Unnecessary appointment allocations are removed while preserving required rules. A spinner and
disabled reset button indicate progress; the current result stays visible.
Every returned result is independently checked against all model constraints and
integer session bounds before display. A time-limited feasible incumbent is marked
as not proving minimum cost. If no audited feasible incumbent exists, no plan is
presented as valid. Edits and tab changes never automatically solve or clear a plan;
they flag changed inputs for the next manual reset. Every click requests a fresh
solve. A failed reset retains a previous plan with an explicit warning that it may
not match the current settings. Demand constraints are lower bounds: whole
appointment provision may exceed need but may not fall below it.

The solver is the pinned public-domain `javascript-lp-solver` 1.0.3 browser bundle,
vendored from the official npm registry. Its license is in
`vendor/javascript-lp-solver.LICENSE`.

Validation includes exact comparison with exhaustive enumeration for small cost
problems, a realistic multi-session workload, constraints and missing rates,
actual-assignment costs, and the production background worker/cancellation path.


### Verified timeout recovery
The worker streams independently audited integer incumbents during branch-and-bound and after each accepted refinement. Only plans meeting demand, working patterns, clinician limits and required rules are retained. The page keeps the best verified result if the 21-second watchdog, a worker error or a later unsuccessful refinement interrupts optimisation, and labels it as valid without claiming minimum cost. With no verified incumbent, timeout reports an interrupted search rather than infeasibility. Checkpoint messages do not resolve the job or enable the reset button early. Cancelled workers cannot update a newer reset. The 20-second solver budget and manual reset workflow are unchanged.
