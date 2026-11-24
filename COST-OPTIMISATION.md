# Session Builder cost optimisation

The planner minimises annual workforce cost with mixed-integer programming. Each
decision variable is a whole recurring weekly session, assigned to a session type,
clinician type, weekday and AM/PM period. Cost is the assigned clinician's saved
annualised sessional rate multiplied by the weekly session count, without another
52-week multiplier. The cost column shows actual assignments rather than equal
splits across eligible clinician types.

Hard constraints include clinician weekly minima/maxima across all session types,
working-pattern masks, consultation-mode capacities, appointment eligibility,
forecast/historical demand, and enabled Must meet rules. Planned care and daily
urgent demand are pooled; routine and weekly urgent type eligibility is retained.
Prefer rules are evaluated and reported but do not override the cost objective.

Session counts and costs describe contracted recurring weekly commitments.
Average productive appointment capacity is reduced by
`(52 - annualLeaveWeeks) / 52 * (1 - sicknessPercent / 100)`. Missing leave/sickness
settings use the Clinician Setup defaults of five weeks and zero percent.
Appointment quantities are continuous weekly averages; session counts are whole
numbers. Unallocated slots remain visible and cannot satisfy demand/share rules.

Missing annual rates stop cost optimisation. An explicitly entered zero is allowed.
The model is solved in a background worker with a bounded primary cost search and
a second pass reducing session count without increasing the best annual cost.
Every returned result is independently checked against all model constraints and
integer session bounds before display. A time-limited feasible incumbent is marked
as not proving minimum cost. If no audited feasible incumbent exists, no plan is
presented as valid. New edits cancel stale worker requests.

The solver is the pinned public-domain `javascript-lp-solver` 1.0.3 browser bundle,
vendored from the official npm registry. Its license is in
`vendor/javascript-lp-solver.LICENSE`.

Validation includes exact comparison with exhaustive enumeration for small cost
problems, a realistic multi-session workload, constraints and missing rates,
actual-assignment costs, and the production background worker/cancellation path.
