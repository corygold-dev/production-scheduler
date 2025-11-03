# Constraint Model

## Problem Statement

Schedule a set of products through a factory's resources to minimize total tardiness while respecting eligibility, precedence, calendars, and changeover requirements.

## Variables

**Decision variables:**

- `start[p, s]`: Start time (minutes from horizon start) for product `p`, step `s`
- `resource[p, s]`: Which resource executes product `p`, step `s`

**Derived values:**

- `end[p, s] = start[p, s] + duration[p, s]`
- `completion[p] = max(end[p, s])` for all steps `s` of product `p`
- `tardiness[p] = max(0, completion[p] - due[p])`

## Constraints

1. **Eligibility**: `resource[p, s]` must have the capability required by step `s` of product `p`

2. **Precedence**: For each product `p` and consecutive steps `s` and `s+1`:

   ```
   start[p, s+1] >= end[p, s]
   ```

3. **No Overlap**: For any resource `r`, no two operations overlap in time:

   ```
   For all (p1, s1) ≠ (p2, s2) assigned to resource r:
   end[p1, s1] <= start[p2, s2]  OR  end[p2, s2] <= start[p1, s1]
   ```

4. **Calendar Windows**: Each operation must fit entirely within one working window:

   ```
   For resource[p, s] = r, there exists a calendar window [w_start, w_end] such that:
   w_start <= start[p, s] AND end[p, s] <= w_end
   ```

5. **Changeover Time**: When two operations `(p₁, s₁)` and `(p₂, s₂)` are scheduled consecutively on the same resource `r` with different product families:

   ```
   If family[p₁] ≠ family[p₂] and both assigned to r with (p₁, s₁) immediately before (p₂, s₂):
   start[p₂, s₂] >= end[p₁, s₁] + changeover[family[p₁], family[p₂]]
   ```

6. **Horizon Bounds**: All operations occur within the scheduling horizon:
   ```
   0 <= start[p, s] and end[p, s] <= horizon_length
   ```

## Objective

Minimize total tardiness across all products:

```
minimize: sum(tardiness[p]) for all products p
```

Where `tardiness[p] = max(0, completion[p] - due[p])`

## Assumptions

- **Operations are non-preemptive**: Once started, an operation runs to completion without interruption
- **Operations cannot span multiple calendar windows**: Must fit entirely within one working window
- **Changeover time is deterministic**: Depends only on product families, not on specific operations
- **Resources are single-capacity**: Each resource handles at most one operation at a time
- **All times are deterministic**: No stochastic durations or breakdowns
- **No resource sharing**: An operation requires exactly one resource

## Solution Method

This implementation uses a Serial Schedule Generation Scheme (SGS) heuristic with Earliest Due Date (EDD) priority. Operations are scheduled one at a time in priority order, placing each on the resource that minimizes projected tardiness.

Ties between operations with equal due dates are broken by remaining slack (remaining work), then by shortest processing time.

The heuristic runs in O(N × R × W) time, where N is the number of operations, R is the number of resources, and W is the average number of calendar windows per resource. This provides near-instantaneous scheduling for realistic problem sizes (hundreds of operations).

The heuristic does not guarantee global optimality but produces feasible schedules quickly and predictably for realistic problem sizes.
