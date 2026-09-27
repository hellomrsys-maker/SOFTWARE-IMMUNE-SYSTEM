# Software Immune System — Section-by-Section Implementation Roadmap

> **Priority legend**
> - `foundation` — must be built first; all other packages depend on it
> - `core` — primary operational path; required for the demonstration scenario
> - `extended` — necessary for completeness but not the critical first path
> - `evaluation` — measurement, comparison, and challenge scenarios built last

---

## Section 01 — Managed Application

**Biological design principle:** The organism being monitored. The immune system exists to protect it, so its behaviour — including its defects — must be precisely specified.

**Technical duty in plain language:** Provide a realistic Node.js checkout + payment simulator that contains a deliberate duplicate-payment defect (unsafe retry without stable idempotency key) and a correctness specification the immune system must satisfy.

**Key components to implement:**
- `01.01` Checkout engine: request handler, order-state manager (pending / attempted / confirmed / uncertain-outcome), payment client with logical payment identity, 5 s timeout, and intentionally buggy retry (no stable idempotency key)
- `01.02` Payment simulator: request processor, idempotency processor (atomic key reservation via `SELECT … FOR UPDATE SKIP LOCKED`), persistence processor, status lookup with caller isolation
- `01.03` Fault-injection engine: delayed response after commit, dropped response after commit, concurrent duplicate submission, temporary unavailability; guarded by `NODE_ENV !== 'production'`
- `01.04` Correctness specification: API contracts, order/payment transition rules, no-duplicate-logical-charge invariant, amount/currency consistency, timeout-uncertainty preservation; protected acceptance tests that the repair agent must never modify

**Dependencies:** PostgreSQL (platform), none from other SIS packages

**Priority:** `core`

---

## Section 02 — Observation Subsystem

**Biological design principle:** Sensory cells and antigen receptors — the immune system must observe the organism from multiple angles simultaneously; a missing signal is recorded as a gap, never assumed healthy.

**Technical duty in plain language:** Collect structured evidence (logs, traces, metrics, repository state, documentation) and package it into validated, redacted, timestamped evidence bundles with explicit collection-gap records.

**Key components to implement:**
- `02.01` Sensor lifecycle: registry, scheduler (event / periodic / incident-specific), health tracker writing to `sensor_health`
- `02.02` Runtime observation: log collector, trace collector (OpenTelemetry-compatible), metric collector, business-state observer (read-only DB queries)
- `02.03` Repository observation: Git adapter, source indexer, change collector, test observer (Vitest discovery + coverage)
- `02.04` Document ingestion: markdown/text parser, section/heading extractor, API-expectation extractor, runbook extractor, untrusted-content classifier
- `02.05` Evidence preparation: schema validator (zod), secret redactor, deduplicator, timestamp normalizer (original + collection + `clockOrderUncertain`), identity correlator, bundle writer with source manifest + collection gaps + checksums

**Dependencies:** `01` (managed app log/trace endpoints), `11` (persistence, artifact-storage)

**Priority:** `core`

---

## Section 03 — Transport and Control Subsystem

**Biological design principle:** The circulatory system and lymphatic vessels — signals and control commands must travel through controlled, authenticated channels; nothing bypasses the authorization checkpoint.

**Technical duty in plain language:** Operate the durable PostgreSQL-backed event queue, the incident state machine, the dependency-DAG task coordinator, and the authorization engine whose decisions are enforced in service code before any agent instruction is executed.

**Key components to implement:**
- `03.01` Durable delivery: enqueue / claim-with-lease / ack / nack / quarantine; bounded exponential-backoff retry with jitter; backpressure admission check
- `03.02` Incident state machine: hardcoded allowed-transition table; states `created → observing → diagnosing → reproducing → repairing → validating → review_ready | rejected | escalated | abstained`; deduplication by fingerprint; restart recovery
- `03.03` Task coordination: dependency DAG builder, parallel independent-task dispatch, input snapshot at dispatch time, output schema validation (zod), attempt count + wall-clock budget
- `03.04` Authorization engine: `checkRead / checkWrite / checkCommand / checkNetwork / checkApproval`; denial audit record written to DB before denial returned; approved-command registry loaded from config (never from model output)

**Dependencies:** `11` (persistence), no dependency on any other SIS package

**Priority:** `foundation`

---

## Section 04 — Diagnostic Subsystem

**Biological design principle:** Antigen-presenting cells and T-cell activation — raw observations are processed into specific, named threats with evidence citations; competing explanations are explicitly registered and tested.

**Technical duty in plain language:** Build a system model from source and evidence, detect invariant and contract violations, drive IBM Bob investigation tasks, adjudicate hypotheses using exactly four permitted status values, and refuse to treat duplicate agent outputs as independent confirmation.

**Key components to implement:**
- `04.01` System model builder: service topology graph, source-to-service map, contract-to-endpoint map, test-to-behavior map, model uncertainty records
- `04.02` Detection engine: invariant/contract/threshold violation detectors, request-sequence reconstructor, affected-component locator, recent-change correlator
- `04.03` Hypothesis adjudicator: evidence-reference validator, contradiction checker, missing-evidence checker, alternative-explanation register, duplicate-claim merger (no evidence amplification), experiment-requirement generator, status assigner (`Supported | Contradicted | Reproduced within stated conditions | Insufficient evidence`)
- `04.04` IBM Bob task wrappers: repository investigator, runtime investigator, contract/test investigator, coordinator; all behind `BOB_INTEGRATION_ENABLED` flag with explicit stub notices

**Dependencies:** `02` (evidence bundles), `03` (transport/authorization), `11` (persistence)

**Priority:** `core`

---

## Section 05 — Containment Subsystem

**Biological design principle:** Innate immune response — a rapid, coarse first-line reaction that limits spread while the adaptive response (repair) is prepared.

**Technical duty in plain language:** Assess known and unknown impact, select a predefined reversible mitigation from a catalog, apply it under authorization, observe for adverse effects, and reverse or escalate if necessary.

**Key components to implement:**
- `05.01` Impact assessor: affected endpoint/operation/records; explicit `unknownImpact: true` flag when scope cannot be determined
- `05.02` Mitigation selector: catalog of predefined reversible actions with preconditions, approval requirements, expected benefit, availability trade-off, expiry duration, reversal command
- `05.03` Mitigation verifier: pre-action state snapshot, apply authorized action via `03.04`, post-action state observation, adverse-effect detection, reversal or escalation

**Dependencies:** `04` (diagnostic output), `03` (authorization), `11` (persistence)

**Priority:** `extended`

---

## Section 06 — Experimental Reproduction Subsystem

**Biological design principle:** In-vitro cell culture — the failure is reproduced under controlled conditions to prove the suspected mechanism causes it, not merely correlates with it.

**Technical duty in plain language:** Spin up an isolated Git worktree with a dedicated DB schema, execute parameterized fault scenarios, discriminate cause from symptom by varying the suspected mechanism, and generate a verified regression artifact whose failure on the defective baseline is confirmed before storage.

**Key components to implement:**
- `06.01` Experiment specification: typed `ExperimentSpec` (hypothesis ref, env vars, controlled fault, input sequence, expected observations, time/resource limits)
- `06.02` Environment preparation: `git worktree add`, `pnpm install --frozen-lockfile` in sandbox, dedicated PostgreSQL schema `exp_<uuid>`, deterministic SQL fixtures, readiness polling, `EnvironmentManifest`
- `06.03` Scenario executor: fault activation, payment submission, commit-before-timeout capture, retry observation, persisted-payment-count query, trial repetition
- `06.04` Causal discriminator: faulty vs normal comparison, retry-identity variation (fixed vs regenerated key), alternative-explanation checking, causal-conclusion limits
- `06.05` Regression artifact generator: Vitest test file generation, baseline failure verification (throws if not performed), SHA-256 hash, `regression_tests` table persistence, reproduction command export

**Dependencies:** `04` (hypothesis / experiment requirements), `11` (sandbox, persistence, artifact-storage), `01` (fault injection API)

**Priority:** `core`

---

## Section 07 — Repair Subsystem

**Biological design principle:** Adaptive immune effector response — a targeted repair that fixes the confirmed mechanism, not a broad immunosuppressant that just masks symptoms.

**Technical duty in plain language:** Map the confirmed root cause to a minimal candidate change, verify authorization against an allowed-file list and line-budget, apply Bob-assisted patch in a sandbox, and document recovery considerations including explicit irreversible-effect warnings.

**Key components to implement:**
- `07.01` Candidate planner: root-cause-to-change mapping, alternative-fix comparison (rejecting timeout-only fixes), minimal-change selection, contract compatibility check, protected-invariant references
- `07.02` Payment repair specification: stable logical key `${callerId}:${orderId}`, atomic reservation (`INSERT … ON CONFLICT`), concurrency-safe reuse, conflicting-payload rejection, unknown-outcome reconciliation, duplicate-record handling report
- `07.03` Change authorizer: allowed-file list, max-changed-lines limit, migration review requirement, protected-test-file and validation-code modification rejection without `approval_records` entry
- `07.04` Patch executor: Bob-assisted code generation, diff validation via change authorizer, `git apply`, candidate commit, `tsc --noEmit` + ESLint via sandbox, execution audit record
- `07.05` Recovery planner: `git revert` procedure, migration reversibility assessment, persisted-data reconciliation requirements, irreversible-effect warning, no auto-refund

**Dependencies:** `06` (reproduction results), `04` (hypothesis / root cause), `03` (authorization), `11` (sandbox, persistence)

**Priority:** `core`

---

## Section 08 — Protected Validation Subsystem

**Biological design principle:** Thymic selection and clonal deletion — candidates are tested against the organism's complete self-identity before release; any that attack protected structure are eliminated.

**Technical duty in plain language:** Run six mandatory gate groups whose results are read from actual process exit codes, adjudicate to `review_ready` or `rejected`, and operate entirely outside the repair agent's writable file scope so its results can never be falsified.

**Key components to implement:**
- `08.01` Identity binder: SHA-256 of candidate commit + environment manifest + acceptance-suite file hashes; invalidate if any change
- `08.02` Execution gates: build/typecheck, existing test suite, original failure scenario, regression test, baseline comparison — all from actual exit codes
- `08.03` Business gates: single logical charge, concurrent duplicate safety, conflicting amount/currency rejection, caller-scoped key isolation, order/payment consistency — run against acceptance tests that the repair agent cannot modify
- `08.04` Safety/scope gates: protected-test weakening detection, validator modification detection, unauthorized file change, secrets in artifacts, unapproved external access
- `08.05` Performance checks: concurrent-request scenario, DB lock-wait observation, duration comparison, resource budget, explicit "results valid only for tested load" note
- `08.06` Result adjudicator: collects gate results, reads exit codes, distinguishes `GATE_FAILED` from `INFRA_ERROR`, rejects incomplete mandatory gates, enforces max repair retry count, produces `ValidationResult`

**Dependencies:** `07` (candidate), `01` (acceptance tests — read-only), `06` (regression artifact), `11` (sandbox, persistence); **no dependency on `07`'s code at import level**

**Priority:** `core`

---

## Section 09 — Developer Interface

**Biological design principle:** The clinician's console — the immune system produces a full briefing for the human decision-maker, who retains final authority over any intervention.

**Technical duty in plain language:** Provide a React SPA for failure intake, live incident workspace with evidence/hypothesis/experiment browsing, repair-diff review with six-field completeness gate before approval, and local patch/report export.

**Key components to implement:**
- `09.01` Intake form: repository selector, failure-report entry, artifact upload, approved-command configuration, investigation authorization toggle
- `09.02` Incident workspace: state display, evidence browser, timeline with source refs, hypotheses + contradictions panel, experiment results, missing-evidence notices (amber)
- `09.03` Repair review: diff viewer, rationale panel with evidence citations, validation output panel, limitations panel, recovery panel, approval/reject/revise controls — approval button disabled until all six fields present
- `09.04` Delivery adapter: export patch, export review report, optional branch push, optional PR creation (feature-flagged); never executes deploy commands
- Bob integration status banner (disabled = visible amber notice)

**Dependencies:** `11` (control API plugin), all other packages (read-only queries via control API)

**Priority:** `extended`

---

## Section 10 — Verified Knowledge Subsystem

**Biological design principle:** Immunological memory — past encounters accelerate future responses, but memory alone never authorizes an effector response without current antigen confirmation.

**Technical duty in plain language:** Record incident outcomes and prevention artifacts, match incoming failures against stored signatures, and guarantee that retrieved knowledge provides guidance only — it never authorizes a repair.

**Key components to implement:**
- `10.01` Incident recorder: writes `knowledge_records` with symptom, evidence bundle ref, tested hypotheses, successful/rejected repairs, validation ref, human review ref, `status: 'candidate' | 'approved'`, version
- `10.02` Prevention artifact generator: permanent regression test entry, API clarification markdown, operational runbook update, monitoring rule suggestion, preventive change flags for human review
- `10.03` Retrieval engine: failure-signature fingerprinting, component+contract matching, repository-version comparison, applicability conditions, `applicabilityWarning` when version differs
- `10.04` Knowledge governance: candidate → approved promotion (requires human approval record), version snapshots, superseded markers, retention policy; `authorizeRepairFromMemory()` always returns `Denied`

**Dependencies:** `08` (validated repair), `04` (diagnostic results), `11` (persistence)

**Priority:** `extended`

---

## Section 11 — Platform Infrastructure

**Biological design principle:** The organism's fundamental biology — circulatory, skeletal, and metabolic infrastructure that every immune cell depends on.

**Technical duty in plain language:** Provide shared persistence (PostgreSQL pool + typed query functions), the Fastify control-API plugin (JWT auth, per-incident authorization, rate limits), artifact storage with integrity checking, the sandbox process manager (Docker/Podman with hard-coded resource limits), observability helpers, and reliability safeguards.

**Key components to implement:**
- `11.01` Control API plugin: JWT middleware, per-incident authorization check, rate limiting, zod validation, structured error serializer
- `11.02` Persistence layer: pg Pool, typed query functions per table, outage handler (stops worker)
- `11.03` Artifact storage: write with SHA-256, read with integrity check, cleanup by incident, storage quota enforcement
- `11.04` Sandbox manager: Docker/Podman spawner; enforces unprivileged execution, `--read-only` rootfs with tmpfs, no `--network host`, no production secrets, `--cpus` / `--memory` / `--pids-limit` / `--timeout`, teardown on completion
- `11.05` Observability: pino child loggers, gauges for queue depth / worker health / sensor failures / auth denials / stalled incidents
- `11.06` Reliability safeguards: idempotent command wrapper (dedup by command ID), workflow checkpoint writer/reader, artifact-write failure handler (explicit stop), DB outage waiter

**Dependencies:** PostgreSQL, Docker or Podman — no SIS package dependencies

**Priority:** `foundation`

---

## Section 12 — Evaluation Harness

**Biological design principle:** Clinical trials and efficacy studies — the immune system's performance must be measurable and comparable against baselines to prove value.

**Technical duty in plain language:** Provide three runnable challenge scenarios (duplicate-payment, misleading explanation, unsafe repair), a seven-metric measurement engine, a three-arm comparison protocol noting sample-size limits, and a static coverage manifest mapping each challenge category to the implementing nodes.

**Key components to implement:**
- `12.03.01` Duplicate-payment scenario: configure managed app with defective client, activate delayed-response fault, trigger timeout + retry, verify duplicate charge
- `12.03.02` Misleading-explanation scenario: inject plausible-but-wrong hypothesis with fabricated support; assert `Contradicted` status
- `12.03.03` Unsafe-repair scenario: propose timeout-only repair; assert rejection by `ChangeAuthorizer` and `CandidatePlanner`
- `12.04` Measurement tracker: seven timing/count metrics — time-to-diagnosis, time-to-reproduction, time-to-validated-repair, active-human-effort-minutes, manual-intervention-count, unsafe-repair-rejections, appropriate-abstention-count
- `12.05` Comparison protocol: three-arm structure (manual / AI-assisted / Bob-structured); explicit sample-size limitation notice
- `12.06` Coverage manifest: static map of challenge category → implementing nodes; legacy modernization excluded

**Dependencies:** all other sections

**Priority:** `evaluation`
