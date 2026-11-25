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
capacity and session count have been considered.
The preferred distribution cannot increase those earlier totals. All allocations
stay whole and must still cover each demand target. Changes apply only on Reset planner.

Session counts and costs describe contracted recurring weekly commitments.
Average productive appointment capacity is reduced by
`(52 - annualLeaveWeeks) / 52 * (1 - sicknessPercent / 100)`. Missing leave/sickness
settings use the Clinician Setup defaults of five weeks and zero percent.
Predicted need remains a fractional weekly average. Session counts and all provided,
allocated appointment counts are integers. Productive consultation-mode
capacity per session is rounded down after absence adjustment, while required slots
round demand up. Forecast appointment-type proportions allow a one-slot deviation so
they do not force fractional allocations. Required percentage rules remain exact. All productive capacity in selected sessions must be assigned to eligible appointment types, separately for home-visit and non-home-visit slots. Predicted need is a minimum, not a ceiling; provision may exceed it. Capacity with no eligible appointment type prevents that session from being selected.

Missing annual rates stop cost optimisation. An explicitly entered zero is allowed.
The model is solved only when Reset planner is clicked. It runs in a background
worker with a shared twenty-second budget. The primary search minimises annual cost;
a reserved refinement reduces productive capacity without increasing the best cost found.
There is no trimming of allocated slots back to forecast demand. All whole productive slots are allocated while preserving required rules. A spinner and
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


### Full session allocation
Selected sessions allocate their entire productive capacity after leave and sickness. Required demand remains rounded-up lower bounds; no allocation target forces provision to equal need. No Unallocated category is generated by the cost optimiser. Exact clinician/appointment-mix and weekly-distribution rules remain enforced. Cost remains the first objective, followed by productive capacity and session count; the solver does not buy extra sessions merely to create more appointments. Verified checkpoints must reconcile all allocated pool totals with total productive capacity, including timeout results.


### Session limits in one rule
The existing minimum-session rule now offers independent optional minimum and maximum whole-session bounds. Blank/null bounds impose no limit; equal bounds require an exact count, and zero maximum prohibits that session type in the selected scope. Both blank is a no-op. Existing minimum-only rules retain their values and an unlimited maximum. Daily/weekly limits count the selected session type across all assigned clinician types and periods; legacy morning/afternoon scopes remain supported. Required bounds are enforced by the cost solver and checked in every published incumbent. The editor rejects negative, fractional or reversed bounds; percentage and distribution rules are unchanged. Changes apply only on Reset planner.


### Feasibility-first search and daily symmetry
The shared 20-second budget now begins with up to two seconds seeking a complete integer plan under the same hard constraints, using session count as its initial objective. The phase stops on its first audited incumbent; remaining time searches annual cost, bounded by that incumbent's cost, followed by capacity/session/distribution refinements. A first-phase plan is not claimed optimal and survives a failed or interrupted cost search. For rules scoped entirely to whole days/weeks and paired AM/PM working patterns, interchangeable periods are collapsed to one internal representative, halving session/allocation decisions without changing feasible daily totals. AM/PM-specific rules or asymmetric working patterns preserve both periods. Ordinary rerenders preserve the result's timeout/optimality status rather than overwriting it with 'Plan unchanged'. Scale coverage includes simultaneous hard allocation distributions and session spreads. This improves search strategy but does not guarantee feasibility or completion for arbitrary configurations.
