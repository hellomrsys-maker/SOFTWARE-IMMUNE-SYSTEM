# Software Immune System — Project Details

## Project Name

**Software Immune System (SIS)**

---

## Plain-Language Description

The Software Immune System is a monorepo-based autonomous debugging and repair platform that accepts a TypeScript/Node.js repository together with a failure report, then mimics biological immune-system behaviour to investigate, isolate, and propose a fix. It collects source-linked runtime evidence from logs, traces, metrics, and the repository itself; constructs explicit evidence-backed hypotheses via an IBM Bob investigation layer; reproduces the confirmed failure in a fully isolated sandbox environment; generates a minimal constrained code repair; runs a suite of protected acceptance and business-correctness checks whose results cannot be falsified; and finally delivers a complete, review-ready change package—including diff, rationale, validation output, known limitations, and recovery considerations—to a human developer who retains exclusive authority to approve and deploy the change.

---

## Top-Level Subsystems

| # | Section | Name | One-Sentence Technical Duty |
|---|---------|------|-----------------------------|
| 1 | 01 | Managed Application | Self-contained checkout + payment-simulator + fault-injection sub-application that serves as the primary defect vehicle and maintains its own correctness specification. |
| 2 | 02 | Observation Subsystem | Collects, validates, redacts, and packages runtime logs, distributed traces, metrics, repository state, and documentation into timestamped evidence bundles with explicit collection-gap records. |
| 3 | 03 | Transport and Control Subsystem | Provides the durable event queue, incident state machine, task-coordination DAG scheduler, and authorization engine that move evidence and control signals safely between all other subsystems. |
| 4 | 04 | Diagnostic Subsystem | Builds a system model from source and evidence, detects invariant violations, and drives IBM Bob investigation tasks to produce evidence-backed, adjudicated hypotheses. |
| 5 | 05 | Containment Subsystem | Assesses impact, selects predefined reversible mitigation actions, applies them under authorization, and reverses or escalates on adverse effect. |
| 6 | 06 | Experimental Reproduction Subsystem | Prepares an isolated Git worktree and database schema, executes parameterized fault scenarios, discriminates cause from symptom, and generates a verified regression artifact. |
| 7 | 07 | Repair Subsystem | Plans minimal candidate changes anchored to the confirmed root cause, obtains change authorization, executes Bob-assisted patch application, and documents recovery considerations. |
| 8 | 08 | Protected Validation Subsystem | Runs six mandatory gate groups (identity, execution, business correctness, safety/scope, performance) and adjudicates results from actual exit codes, producing `review_ready` or `rejected`. |
| 9 | 09 | Developer Interface | React/Vite single-page application providing incident intake, live workspace, repair-diff review with approval controls, and local patch/report export. |
| 10 | 10 | Verified Knowledge Subsystem | Stores incident records and prevention artifacts, retrieves applicable guidance by failure signature, and enforces that memory alone never authorizes a repair. |
| 11 | 11 | Platform Infrastructure | Shared persistence layer, control API plugin, artifact storage, sandbox process manager, observability helpers, and reliability safeguards used by every other subsystem. |
| 12 | 12 | Evaluation Harness | Three runnable challenge scenarios, a seven-metric measurement engine, a three-arm comparison protocol, and a static challenge-category coverage manifest. |

---

## Technology Stack

| Layer | Technology |
|-------|-----------|
| Language | TypeScript (strict, ES2022 target) |
| Runtime | Node.js |
| Monorepo | pnpm workspaces (`@sis/*` package prefix) |
| Control API | Fastify |
| Background Worker | Node.js process (TypeScript) |
| React Frontend | Vite + React 18 + Tailwind CSS + shadcn/ui |
| Database | PostgreSQL via `pg` (no ORM); migrations via `node-pg-migrate` |
| Schema validation | `zod` at all API/module boundaries |
| Test runner | Vitest |
| Logging | `pino` (structured JSON) |
| Sandbox | Docker or Podman, runtime-selectable via `SANDBOX_RUNTIME` env var |
| Git integration | `simple-git` |
| IBM Bob integration | Behind `BOB_INTEGRATION_ENABLED` feature flag; stubs when disabled |

---

## Operating Restrictions (Section 00.04)

1. **No production payment credentials** — all credentials in the repository are clearly fake test placeholders.
2. **No autonomous production deployment** — the system may export patches and optionally push to a branch; it never executes deploy commands.
3. **No automatic financial compensation** — the system records irreversible-effect warnings and requires explicit human action; it never initiates refunds or destructive cleanup.
4. **No claim of complete correctness** — passing tests constitute evidence within tested conditions, not proof of universal correctness; this limitation is documented on every validation result.
5. **Authorization checks execute in service code before any agent-generated instruction is acted upon** — no model output can bypass the authorization engine (section 03.04).
6. **Sandbox restrictions enforced in process-spawner code, not in prompts** — resource limits, filesystem mounts, and network restrictions are applied as container runtime flags.
7. **Fault injection restricted to test environments** — an explicit `NODE_ENV !== 'production'` guard prevents activation in production.
8. **All evidence redacted of secrets and personal data before storage** — the redactor runs before any write to the evidence bundle or database.
9. **Validation package isolated from repair package** — `packages/validation` has no import dependency on `packages/repair`; the validator runs outside the repair agent's writable file scope and can never be modified by a repair task.
10. **Result adjudication reads actual exit codes** — no model opinion substitutes for process exit codes; a skipped mandatory gate is a rejection, not a warning.

---

## End-to-End Workflow Sequence

```
01 (Managed App — defect vehicle)
 └─► 02 (Observation — collect evidence)
      └─► 03 (Transport — queue, state machine, authorization)
           └─► 04 (Diagnostic — model, detect, hypothesize)
                └─► 05 (Containment — optional early mitigation)
                └─► 06 (Reproduction — isolate, discriminate, artifact)
                     └─► 07 (Repair — plan, authorize, patch)
                          └─► 08 (Validation — six mandatory gates)
                               └─► 09 (Developer Interface — review, approve, export)
                                    └─► 10 (Knowledge — record, prevent, retrieve)

Supporting subsystems (active throughout):
  11 (Platform — persistence, sandbox, observability, reliability)
  12 (Evaluation — scenarios, metrics, coverage)
```

**Detailed reference chain:** `01 → 02 → 03 → 04 → 05 → 06 → 07 → 08 → 09 → 10`, with `11` and `12` supporting throughout.

---

## Implementation Boundary Note (Verbatim from Specification)

> Build a complete, production-grade monorepo implementing the Software Immune System as specified. The system accepts a TypeScript/Node.js repository and a failure report, collects source-linked evidence, investigates competing explanations via IBM Bob, reproduces the failure in an isolated sandbox, prepares a constrained repair, runs protected acceptance checks, and delivers a review-ready change package to a human developer.
>
> **One control application, one background worker, a React interface, PostgreSQL storage, and isolated execution environments.**
>
> - Monorepo: pnpm workspaces
> - Control API: Fastify (TypeScript)
> - Background worker: Node.js process (TypeScript)
> - React UI: Vite + React 18 + Tailwind CSS + shadcn/ui
> - Database: PostgreSQL via `pg` (no ORM), migrations via `node-pg-migrate`
> - Validation: `zod` at all API/module boundaries
> - Tests: Vitest across all packages
> - Sandbox: Docker/Podman, runtime-selectable via `SANDBOX_RUNTIME` env var
> - Bob integration: behind `BOB_INTEGRATION_ENABLED` feature flag, stubs when off
> - Logging: structured JSON (`pino`)
>
> **Primary demonstration scenario:** duplicate-payment caused by timeout + unsafe retries (12.03.01), exercisable through the full `01 → 02 → 03 → 04 → 06 → 07 → 08 → 09` path.
>
> **Node annotation convention:** every class, function, route, migration, and component carries a `@node XX.XX.XX` JSDoc tag or `// node: XX.XX.XX` inline comment.
