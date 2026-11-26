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
capacity across matching sessions of the same clinician type, session type, day and internal period is rounded down after absence adjustment, while required slots
round demand up. Forecast appointment-type proportions allow a one-slot deviation so
they do not force fractional allocations. Required percentage rules remain exact. All productive capacity in selected sessions must be assigned to eligible appointment types, separately for home-visit and non-home-visit slots. Predicted need is a minimum, not a ceiling; provision may exceed it. Capacity with no eligible appointment type prevents that session from being selected.

Missing annual rates stop cost optimisation. An explicitly entered zero is allowed.
The model is solved only when Reset planner is clicked. It runs in a background
worker with a shared thirty-second budget. The primary search minimises annual cost;
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
The worker streams independently audited integer incumbents during branch-and-bound and after each accepted refinement. Only plans meeting demand, working patterns, clinician limits and required rules are retained. The page keeps the best verified result if the 31-second watchdog, a worker error or a later unsuccessful refinement interrupts optimisation, and labels it as valid without claiming minimum cost. With no verified incumbent, timeout reports an interrupted search rather than infeasibility. Checkpoint messages do not resolve the job or enable the reset button early. Cancelled workers cannot update a newer reset. The 30-second solver budget and manual reset workflow are unchanged.


### Full session allocation
Selected sessions allocate their entire productive capacity after leave and sickness. Required demand remains rounded-up lower bounds; no allocation target forces provision to equal need. No Unallocated category is generated by the cost optimiser. Exact clinician/appointment-mix and weekly-distribution rules remain enforced. Cost remains the first objective, followed by productive capacity and session count; the solver does not buy extra sessions merely to create more appointments. Verified checkpoints must reconcile all allocated pool totals with total productive capacity, including timeout results.


### Session limits in one rule
The existing minimum-session rule now offers independent optional minimum and maximum whole-session bounds. Blank/null bounds impose no limit; equal bounds require an exact count, and zero maximum prohibits that session type in the selected scope. Both blank is a no-op. Existing minimum-only rules retain their values and an unlimited maximum. Daily/weekly limits count the selected session type across all assigned clinician types and periods; legacy morning/afternoon scopes remain supported. Required bounds are enforced by the cost solver and checked in every published incumbent. The editor rejects negative, fractional or reversed bounds; percentage and distribution rules are unchanged. Changes apply only on Reset planner.


### Feasibility-first search and daily symmetry
The shared 30-second budget now begins with up to two seconds seeking a complete integer plan under the same hard constraints, using session count as its initial objective. The phase stops on its first audited incumbent; remaining time searches annual cost, bounded by that incumbent's cost, followed by capacity/session/distribution refinements. A first-phase plan is not claimed optimal and survives a failed or interrupted cost search. For rules scoped entirely to whole days/weeks and paired AM/PM working patterns, interchangeable periods are collapsed to one internal representative, halving session/allocation decisions without changing feasible daily totals. AM/PM-specific rules or asymmetric working patterns preserve both periods. Ordinary rerenders preserve the result's timeout/optimality status rather than overwriting it with 'Plan unchanged'. Scale coverage includes simultaneous hard allocation distributions and session spreads. This improves search strategy but does not guarantee feasibility or completion for arbitrary configurations.


### Capacity rounding correction and 30-second budget
Retain fractional productive capacity per session internally after leave and sickness. Integer allocations represent the floor of capacity times the number of matching sessions, preventing one home visit per session from being rounded to zero before sessions are combined. Integer-ratio bounds avoid extra integer capacity variables; every displayed allocation remains whole and total allocated capacity reconciles with productive capacity. The total solver deadline is 30 seconds, with a 31-second worker watchdog to allow completion messaging. Refinement time is reserved only after a verified plan exists; otherwise the cost search may use all remaining solver time. Focused rounding, budget and recovery checks pass. Larger representative models can still time out without returning a verified plan; this change does not guarantee successful solving of every configuration.


### Planner failure diagnostics
Failures include an independent preflight report with named clinician rates, eligibility gaps, weekday/category capacity ceilings, contradictory session bounds and shared clinician maximums. Capacity ceilings are optimistic and do not double-count a clinician's maximum across session types; duplicate mandatory minima are not summed. Review items are distinguished from confirmed contradictions. A continuous relaxation check and bounded greedy rule-group isolation run inside the existing 30-second deadline. Infeasibility of that relaxation proves a conflict with current demand/capacity; the report links the remaining required rules. Feasibility of a fractional relaxation does not establish integer feasibility and is never described as proof of a valid plan. Diagnostics are streamed before solving completes, retained on the page watchdog, and shown even when an older valid plan is retained. Review buttons open Session Setup, Clinician Setup or the referenced rule. Completed checks are expandable. No settings or rules are automatically relaxed or changed.

When the continuous check passes, the report also lists required rules involving integer decisions that were fractional in that preliminary solution. Those links identify candidates for review, not proven conflicts or rules to remove. A fractional solution is never displayed as a valid appointment plan.


### Session-first integer branching and rounded-plan validation
The pinned solver bundle has a small local patch: optional plannerPriority on integer variables is respected by both enhanced and incremental branching. Session Builder assigns session-count variables higher priority than their dependent appointment allocations. Unprioritised models retain the existing branching behaviour. This fixes the reproduced five-session-rule case that previously failed to return an incumbent within 30 seconds; the representative case now finds its first independently verified plan in approximately 0.7 seconds before continuing cost optimisation. Both page and worker vendor URLs are versioned to avoid cached unpatched solver code.
The independent audit now checks integer-rounded decision values after rejecting material integrality errors. This validates the exact plan displayed rather than allowing large constraint coefficients to amplify tiny solver output noise. Deliberately injected 1e-8 noise is covered by a regression that fails with the old validator. All original demand, working pattern, eligibility, minimum/maximum and full allocation constraints remain checked. Progress reports a verified incumbent while the remaining 30-second budget improves cost; callbacks remain on the page and are never cloned into the worker. Larger distribution-rule workloads can still time out and this change does not claim global optimality for time-limited results.


### Cost and capacity quality, rather than feasibility alone
A verified incumbent is now improved before the global cost search and again while time remains. Whole-appointment max-flow reallocates demand across eligible session capacities, enabling expensive surplus sessions to be removed and lower-cost clinician/session substitutions to be tested. One expensive session may be replaced by several cheaper sessions; equal-cost replacements must reduce productive capacity. Clinician minima/maxima, session-count rules and working patterns remain enforced. Daily urgent splits are restored to their forecast mix. Additional appointment-mix/distribution constraints are repaired with session counts fixed when necessary. Every proposal, including repair results, must pass the original independent full-model audit; required rules and demand coverage are never relaxed. This is a bounded improvement heuristic followed by the existing global MIP search, not a guarantee of a global minimum.
The primary objective uses pounds at penny precision, without an artificial per-session monetary epsilon. Capacity/session tie-breaking remains in separate refinements. Cost lower bounds are converted using the explicit model cost scale. The page displays annual cost and the gap to the fractional-model lower bound; that bound is not necessarily attainable by a whole-number plan. Progress messages show the current verified cost rather than merely announcing feasibility. Original settings are never changed.
Regression coverage now includes deliberately oversized feasible seeds, cheaper multi-session replacements, clinician minima, exact session counts, zero-appointment on-call cost substitutions, equal-cost capacity reductions and exact appointment mixes. The five-rule workload and a workload using the screenshot's rates assert both a cost gap below 5% of the relaxed bound and appointment capacity below 110% of demand for those datasets. Representative results were approximately £1.068m/year with 1,581 slots for 1,511.6 need (0.98% bound gap), and £1.4683m/year with 1,572 slots for 1,511.6 need (1.30% gap). These are test workloads with explicit clinician limits, not promised live practice totals. The 30-second solver and 31-second worker watchdog remain unchanged.


### Soft preferences during cost reduction
Transportation-based cost reduction recomputes continuous preference slack before the independent full-model audit. Unmet Prefer spread rules remain reported as unmet preferences; they cannot silently become hard constraints that veto cheaper valid staffing. Required rules, clinician minimums/maximums, working patterns, and integer appointments are still audited without relaxation. Regression coverage includes a fixed trainee minimum with no Thursday availability and a soft five-day spread.


### Global integer optimisation (HiGHS 1.16.0)
The production worker now loads a pinned, locally served HiGHS WebAssembly engine and solves all session and allocation decisions together. The former first-feasible seed and local deletion heuristic are bypassed in production: coupled percentage and distribution rules require coordinated staffing changes. All original constraints remain, and every incumbent is independently audited before display.

Annual cost is the primary objective, followed by productive capacity, session count and preferred distributions without increasing the cost. Refinements warm-start from the retained solution. The total solve budget remains 30 seconds after engine initialization. Loading or solver failures retain the previous plan with an explicit error; there is no silent fallback to the old heuristic. Native models are disposed after each solve. No practice data is transmitted to a solver service.

The UI says Minimum cost proven only when an audited plan attains the global integer solver optimum. Otherwise it shows an unproven minimum and the available lower bound/gap. Whole appointments can exceed fractional predicted need; required clinician minima, eligibility and indivisible session capacity can still require some surplus. The solver does not change user settings to remove that surplus.

Validation covers exhaustive small integer optima, coordinated reductions under exact clinician shares, current-scale staffing with weekly routine spread, small rule edits, visit capacity, clinician limits and working patterns, plus cancellation and a real Chrome Web Worker/WASM execution.

Session-spread targets follow Clinician Setup availability. Each eligible clinician contributes their session count divided across selected working days, excluding unavailable days. If none of the selected days is worked, that clinician’s actual working days are used. Combined session types sum these clinician-specific targets. Required and preferred spread checks use the same adjusted target; clinician working patterns and weekly bounds remain enforced.

Clinician Setup supports dailySessions keyed by Mon–Fri, each with integer min and integer-or-null max. Max 0 means unavailable; null means no daily maximum. Daily bounds aggregate across all session types and periods and remain hard alongside weekly limits. Old workingPattern selections map to minimum 0 and no maximum on working days, and 0/0 otherwise. Values persist through the existing practice-settings save/restore path. Session-spread targets apply exact bounded equalization: capped days retain their permitted capacity and the remaining weekly sessions are redistributed over other working days. Daily minimums are reserved first. The targets follow the selected integer weekly total, with other session types’ daily use reserved. Must meet session spread stays enforced against these adjusted targets and is never dropped by the distribution fallback. Appointment-distribution rules retain their separate Clinician Setup priority handling. Demand, eligibility and clinician limits never yield.


Weekly Session clinician mix rules measure integer assigned session counts for one session type. The chosen clinician type’s count is the numerator; all eligible clinicians’ assigned counts for that same session type are the denominator. The rule includes zero-appointment on-call sessions and never uses appointment volumes. Exactly, At least and At most comparisons support 0–100%. Unused session types do not create extra sessions just to establish a denominator. Required rules are hard constraints alongside clinician weekly/daily limits and working patterns; preferred rules refine session-share deviation after cost/capacity/session-count priorities.

The Optimised planner exposes 10, 30 (default) and 60 second solve allowances. The chosen allowance controls the solver deadline, primary search allocation and worker watchdog; loading the engine is handled separately. The button fill shows elapsed solve time against that allowance, not mathematical completion. Settings changes mark the retained plan as needing re-optimisation without starting a solve. Explanatory text is available through the heading’s information control.

The clinician summary separates Needed sessions per week (average weekly cover) from Employed sessions per week (the contracted integer session counts already used by the optimiser). Cover = employed × (52 − annual leave weeks) / 52 × (1 − sicknessPercent / 100). The summary never uplifts the already absence-adjusted contracted counts a second time. Annual costs remain based on those employed counts. Cover is displayed to two decimals, and the total sums the displayed clinician cover figures.
