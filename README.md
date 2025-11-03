# Production Scheduler

A constraint-based production scheduler that builds feasible schedules minimizing total tardiness. Originally a take-home project, the goal was to make something realistic, fast, and easy to reason about. Built with TypeScript and Fastify.

## Quick Start

```bash
# Install dependencies
npm install

# Run the server
npm run dev

# Make a request
curl -X POST http://localhost:3000/schedule \
  -H "Content-Type: application/json" \
  -d @sample-input.json
```

The server runs on port 3000 by default (configurable via `PORT` env var).

## API

**POST /schedule**

Accepts a scheduling problem and returns either a valid schedule or detailed infeasibility reasons.

Example request (abbreviated):

```json
{
  "horizon": { "start": "2025-11-03T08:00:00Z", "end": "2025-11-03T16:00:00Z" },
  "resources": [
    { "id": "Fill-1", "capabilities": ["fill"], "calendar": [...] }
  ],
  "products": [
    { "id": "P-100", "family": "standard", "due": "2025-11-03T12:30:00Z", "route": [...] }
  ],
  "changeover_matrix_minutes": { "values": { "standard->premium": 20 } },
  "settings": { "time_limit_seconds": 30 }
}
```

Returns assignments with start/end times, plus KPIs (tardiness, makespan, utilization, changeovers). Each assignment includes product ID, operation name, resource, and ISO timestamps for start/end.

**GET /health**

Returns service status and version.

## Approach

This uses a Serial Schedule Generation Scheme (SGS) heuristic rather than a full constraint solver.

**The main scheduling loop:**

1. Pick the most urgent ready operation (EDD priority + slack tie-breaker)
2. Find the best available resource and time slot
3. Record the assignment
4. Update resource state and mark dependent operations as ready
5. Repeat until all operations scheduled or infeasible

Each placement considers eligibility, calendar windows, existing assignments, and changeover requirements.

**How it works in detail:**

- Normalizes all times to minutes from horizon start for simpler arithmetic
- Flattens product routes into a pool of schedulable operations
- Operations become "ready" when their previous step completes (enforces precedence)
- Resource selection minimizes projected tardiness, with earliest completion as tie-breaker
- Changeover time is calculated based on the preceding operation's product family in each specific gap

Priority rule: EDD (earliest due date) first, then remaining work (slack), then shortest duration.

### Why a heuristic instead of CP-SAT or MIP?

For this problem size (4 products, 4 resources, 8-hour horizon), a heuristic finishes in milliseconds and produces explainable schedules. The greedy EDD approach is easy to explain to factory managers and debugs cleanly when constraints conflict.

A solver would guarantee optimality but adds complexity (model definition, solver integration, slower runtime, harder debugging). With only about 36 hours to work on this, SGS was the right balance of speed and clarity.

Typical runtime is under 100ms for small problems like the sample input, and well under a second even for 100+ operations.

## Testing

```bash
# Run all tests
npm test

# Run specific test suites
npm test tests/unit/
npm test tests/acceptance/
npm test tests/integration/
```

Tests cover time normalization, interval operations, constraint validation, KPI accuracy, infeasibility cases, and HTTP behavior. The acceptance tests specifically verify no overlaps, precedence respect, and calendar adherence as required.

## Architecture

```
src/
  api/          - Fastify server and routes
  core/         - Scheduling algorithm (SGS)
  util/         - Time normalization and interval logic
  types/        - TypeScript definitions and Zod schemas
tests/
  unit/         - Pure function tests
  acceptance/   - End-to-end scheduler tests
  integration/  - HTTP API tests
```

Input is validated with Zod schemas before reaching the scheduler. All internal calculations use minutes from horizon start. Output converts back to ISO timestamps in UTC.

## Design Decisions

**Time handling**: Everything in UTC. No timezone conversion, no DST issues. Internal calculations use minutes for simplicity.

**Changeover logic**: Calculated per-gap rather than per-resource-end. If an operation fits in a gap between two existing assignments, the changeover depends on the family of the assignment immediately before that gap.

**Infeasibility reporting**: When scheduling fails, return specific reasons (which operation, which resource, what constraint). This makes debugging realistic inputs much easier.

**Empty products**: Valid input, returns success with empty assignments and zeroed KPIs.

## If This Were Production

**Algorithm improvements:**

- Try critical ratio priority (remaining_slack / remaining_work) instead of pure EDD
- For bottleneck resources, schedule those first and fit other work around them

**Features:**

- Frozen zone: lock first N hours, only schedule future work
- Multi-objective mode: return multiple schedules (min tardiness vs min changeovers vs max utilization)

**Operationalization:**

- Add a job queue (BullMQ or similar) so scheduling runs can happen asynchronously
- Schedule comparison endpoint (show diff between two runs)

**Testing:**

- Load tests (1000 products to find scaling limits)
- Fuzz testing for malformed inputs and edge cases

**Code quality:**

- Split scheduler.ts into smaller modules (currently 520 lines)

## Build & Deploy

```bash
# Build for production
npm run build

# Run compiled version
npm start
```

Output goes to `dist/`. The service is stateless and safe to run multiple replicas behind a load balancer.
