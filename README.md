# Software Immune System

> **An autonomous debugging and repair platform that mimics biological immune-system behaviour to investigate, isolate, and propose fixes for software defects — while placing all deployment authority with the human developer.**

---

## What It Does

The Software Immune System (SIS) accepts a TypeScript/Node.js repository and a failure report, then:

1. **Observes** the running application — collecting logs, traces, metrics, repository state, and documentation into validated evidence bundles.
2. **Diagnoses** — builds a system model, detects invariant violations, and drives IBM Bob investigation tasks to produce evidence-backed hypotheses.
3. **Reproduces** the failure in an isolated sandbox to discriminate cause from symptom and generate a verified regression artifact.
4. **Repairs** — plans a minimal candidate change anchored to the confirmed root cause and applies it under strict authorization controls.
5. **Validates** through six mandatory gate groups (identity, execution, business correctness, safety/scope, performance) whose results are read from actual exit codes.
6. **Delivers** a complete, review-ready change package — diff, rationale, validation output, limitations, and recovery considerations — to the human developer, who retains exclusive authority to approve and deploy.

**Primary demonstration scenario:** duplicate-payment caused by timeout + unsafe retries, exercisable through the full `01 → 02 → 03 → 04 → 06 → 07 → 08 → 09` path.

---

## Folder Structure

```
software-immune-system/
├── PROJECT_DETAILS.md            # Full project specification summary
├── README.md                     # This file
├── package.json                  # Monorepo root (pnpm workspaces)
├── pnpm-workspace.yaml
├── tsconfig.json                 # Root TypeScript config (strict, ES2022)
├── vitest.workspace.ts           # Enumerates all package test configs
├── docker-compose.yml            # Full environment (PostgreSQL + all services)
├── .env.example                  # Environment variable template (no secrets)
│
├── apps/
│   ├── control-api/              # § 11.01 — Fastify control API
│   ├── background-worker/        # § 03    — Incident workflow worker
│   └── ui/                       # § 09    — React/Vite developer interface
│
├── packages/
│   ├── managed-app/              # § 01    — Checkout + payment simulator (defect vehicle)
│   ├── observation/              # § 02    — Evidence collection
│   ├── diagnostic/               # § 04    — Hypothesis adjudication
│   ├── containment/              # § 05    — Optional early mitigation
│   ├── reproduction/             # § 06    — Isolated fault reproduction
│   ├── repair/                   # § 07    — Candidate repair planning & patching
│   ├── validation/               # § 08    — Protected acceptance gates
│   └── knowledge/                # § 10    — Verified knowledge store
│
├── platform/
│   ├── persistence/              # § 11.02 — PostgreSQL queries + migrations
│   ├── artifact-storage/         # § 11.03 — SHA-256 artifact storage
│   ├── sandbox/                  # § 11.04 — Docker/Podman process manager
│   └── observability/            # § 11.05 — Pino loggers + metrics gauges
│
└── docs/
    ├── IMPLEMENTATION_ROADMAP.md # Section-by-section priorities and dependencies
    └── architecture/             # Biological justifications and design decisions
```

---

## Prerequisites

| Tool | Minimum version |
|------|----------------|
| Node.js | 20.x |
| pnpm | 9.x |
| Docker (or Podman) | 24.x |
| PostgreSQL | 16.x (via Docker) |

---

## Starting the Environment

```bash
# 1. Clone the repository and enter the project folder
cd software-immune-system

# 2. Copy environment template and review all values
cp .env.example .env
# Edit .env — at minimum set JWT_SECRET to a random string

# 3. Install dependencies
pnpm install

# 4. Start PostgreSQL and all services
docker compose up -d

# 5. Run database migrations (once postgres is healthy)
pnpm migrate
```

The control API is available at `http://localhost:3000`.
The React UI is available at `http://localhost:5173`.

---

## Running the Test Suite

```bash
# Run all tests across all packages
pnpm test

# Run in watch mode
pnpm test:watch

# Type-check all packages
pnpm typecheck

# Run a single package's tests
pnpm --filter @sis/managed-app test
```

---

## IBM Bob Integration

Bob is disabled by default. All Bob tasks return explicit stub notices when `BOB_INTEGRATION_ENABLED=false` — never silent degradation.

To enable:
```bash
# .env
BOB_INTEGRATION_ENABLED=true
BOB_API_ENDPOINT=https://your-bob-endpoint.example.com
BOB_API_KEY=your-real-key   # Never commit this value
```

---

## Operating Constraints

- **No production payment credentials** — all credentials in this repository are clearly fake test placeholders.
- **No autonomous production deployment** — SIS exports patches and can optionally push a branch; it never runs deploy commands.
- **No automatic financial compensation** — irreversible-effect warnings are recorded; human action is always required.
- **Fault injection is test-only** — guarded by `NODE_ENV !== 'production'`; will not activate in production.
- **Validation package is isolated** — `packages/validation` has no import from `packages/repair`; the validator runs outside the repair agent's writable file scope.
- **Passing tests are not proof of correctness** — all validation results carry an explicit limitation: "results valid only for tested conditions."

---

## Node Annotation Convention

Every class, function, route, migration, and component carries a `@node XX.XX.XX` JSDoc tag (or `// node: XX.XX.XX` inline comment) linking it to the section of the specification it implements.

---

## Implementation Status

See [`docs/IMPLEMENTATION_ROADMAP.md`](docs/IMPLEMENTATION_ROADMAP.md) for the section-by-section priority plan.

| Area | Status |
|------|--------|
| Monorepo scaffold (pnpm workspaces, tsconfig, docker-compose) | ✅ Complete |
| Platform — Persistence (DB pool, migrations, typed queries) | ✅ Complete |
| Platform — Artifact Storage (SHA-256, integrity check, cleanup) | ✅ Complete |
| Platform — Sandbox Manager (Docker/Podman, resource limits) | ✅ Complete |
| Platform — Observability (pino loggers, GaugeRegistry) | ✅ Complete |
| Platform — Reliability (idempotent commands, checkpoints, outage wait) | ✅ Complete |
| Managed Application §01 (checkout, payment simulator, fault injection, correctness spec) | ✅ Complete |
| Transport §03 (durable queue, state machine, task coordinator, authorization engine) | ✅ Complete |
| Observation §02 (sensors, collectors, evidence preparation, redactor, bundle writer) | ✅ Complete |
| Diagnostic §04 (system model, detector, hypothesis adjudicator, Bob task wrappers) | ✅ Complete |
| Containment §05 (impact assessor, mitigation selector, mitigation verifier) | ✅ Complete |
| Reproduction §06 (experiment spec, causal discriminator, regression artifact generator) | ✅ Complete |
| Repair §07 (candidate planner, payment spec, change authorizer, recovery planner) | ✅ Complete |
| Validation §08 (identity binder, safety gates, result adjudicator) | ✅ Complete |
| Knowledge §10 (incident recorder, prevention artifacts, retrieval engine, governance) | ✅ Complete |
| Control API app | ✅ Scaffolded (routes wired; DB integration pending) |
| Background Worker app | ✅ Scaffolded (poll loop + dispatch; subsystem calls pending) |
| Developer Interface (React UI) | ✅ Scaffolded (intake, repair review, Bob banner) |

**Test coverage:** 19 test files, 160 tests — all passing.

All safety rules (1–26) are enforced as code invariants, not configuration. See each package's source for `@node` annotations.
