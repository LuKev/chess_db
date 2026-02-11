# Chess DB Build Backlog and Delivery Plan

Date: 2026-02-11  
Applies to spec: `/Users/kevin/projects/chess_db/docs/mvp_spec.md`

## 1) Planning Assumptions

1. Team: 3 engineers (2 full-stack, 1 backend/infrastructure), part-time product/design support.
2. Sprint length: 2 weeks.
3. Velocity target: 30-36 story points per sprint.
4. Stack baseline: Next.js + TypeScript API + PostgreSQL + Redis queue + worker + Stockfish.
5. First release target: MVP in 4 sprints (8 weeks), then V1/V2/V3 in incremental releases.

## 2) Definition of Done (All Tickets)

1. Feature behind auth and tenant-safe access controls.
2. Unit/integration tests added or updated.
3. Observability hooks added (structured logs + key metrics).
4. Error handling and user-visible failure states implemented.
5. API and schema changes documented.

## 3) MVP Backlog (Prioritized)

Legend:

1. Priority: `P0` critical for MVP, `P1` should-have, `P2` nice-to-have.
2. Size: `S` (1-2 pts), `M` (3-5 pts), `L` (8 pts), `XL` (13 pts).

### Epic A: Platform and Project Setup

| ID | Priority | Size | Task | Dependencies | Acceptance Criteria |
|---|---|---:|---|---|---|
| A-01 | P0 | M | Initialize monorepo structure (`web`, `api`, `worker`) | None | Apps build and run locally with one command. |
| A-02 | P0 | S | Configure CI (lint, test, typecheck) | A-01 | PR pipeline blocks failing checks. |
| A-03 | P0 | M | Docker local stack (Postgres, Redis, MinIO) | A-01 | Local environment reproducible from clean machine. |
| A-04 | P1 | S | Error/reporting baseline (Sentry or equivalent) | A-01 | Unhandled server/client exceptions visible in dashboard. |
| A-05 | P1 | S | App configuration and secrets management | A-01 | Env validation fails fast on missing required keys. |

### Epic B: Auth and Tenancy

| ID | Priority | Size | Task | Dependencies | Acceptance Criteria |
|---|---|---:|---|---|---|
| B-01 | P0 | M | Users table + auth schema migration | A-01 | Migration creates users/session tables successfully. |
| B-02 | P0 | M | Email/password auth (register/login/logout) | B-01 | User can create account and maintain session. |
| B-03 | P0 | M | Middleware for tenant scoping (`user_id`) | B-02 | Cross-user reads/writes blocked by tests. |
| B-04 | P1 | S | Password reset flow | B-02 | Reset token flow works end-to-end. |

### Epic C: Core Data Model

| ID | Priority | Size | Task | Dependencies | Acceptance Criteria |
|---|---|---:|---|---|---|
| C-01 | P0 | L | Create core game schema (`games`, `game_pgn`, `game_moves`, `import_jobs`, `import_errors`) | A-01 | Schema migrates and rollback tested. |
| C-02 | P0 | M | Add indexes from MVP spec | C-01 | Query plan uses intended indexes for major filters. |
| C-03 | P0 | S | Add saved filters schema | C-01 | CRUD operations pass integration tests. |
| C-04 | P1 | S | Add annotation schema (`user_annotations`) | C-01 | Per-user annotations persist and isolate correctly. |
| C-05 | P1 | S | Add provenance fields (`source`, `license`) | C-01 | Imported games retain source/license metadata. |

### Epic D: PGN Import and Dedupe Pipeline

| ID | Priority | Size | Task | Dependencies | Acceptance Criteria |
|---|---|---:|---|---|---|
| D-01 | P0 | M | Upload API and object storage integration | A-03, B-03 | Upload returns import job ID and stored object key. |
| D-02 | P0 | L | Queue worker scaffold + job lifecycle state machine | D-01 | Job transitions `queued/running/completed/failed/partial`. |
| D-03 | P0 | XL | PGN parser integration (variations/comments/NAGs) | D-02, C-01 | Parses representative corpus with fail-soft behavior. |
| D-04 | P0 | M | `.pgn.zst` streaming decompression path | D-02 | Large compressed file imports without full-memory load. |
| D-05 | P0 | M | Dedupe hash and duplicate skip logic | D-03 | Duplicate rules match spec; counters exposed in report. |
| D-06 | P1 | M | Import error reporting API/detail endpoint | D-02 | UI can show error sample lines and counts. |
| D-07 | P1 | M | Import throughput benchmark harness | D-03 | Baseline report generated with games/min metric. |

### Epic E: Search and Game List UX

| ID | Priority | Size | Task | Dependencies | Acceptance Criteria |
|---|---|---:|---|---|---|
| E-01 | P0 | M | `GET /api/games` with filter/sort/pagination | B-03, C-02 | All MVP filters work with AND semantics. |
| E-02 | P0 | M | Database home page table + server-side pagination | E-01 | User can browse and sort large result sets. |
| E-03 | P0 | S | Filter controls (player, ECO, date, result, time control) | E-02 | Filter UI maps correctly to API parameters. |
| E-04 | P1 | S | Saved filter CRUD UI and API wiring | C-03, E-02 | User can save and reapply smart filters. |
| E-05 | P1 | S | Empty/loading/error states for list page | E-02 | Failure states are actionable and non-blocking. |

### Epic F: Game Viewer and Annotation

| ID | Priority | Size | Task | Dependencies | Acceptance Criteria |
|---|---|---:|---|---|---|
| F-01 | P0 | M | `GET /api/games/:id` payload contract | C-01, B-03 | Returns headers + move tree + metadata. |
| F-02 | P0 | L | Board + SAN notation tree renderer | F-01 | Mainline and nested variations replay correctly. |
| F-03 | P0 | S | Viewer controls (step, jump, autoplay, copy FEN) | F-02 | Controls sync board and notation cursor. |
| F-04 | P1 | M | Per-user comments/arrows/highlights persistence | C-04, F-02 | Annotation edits persist and reload correctly. |
| F-05 | P1 | S | Original PGN panel/download action | F-01 | User can inspect raw PGN for current game. |

### Epic G: Engine Analysis

| ID | Priority | Size | Task | Dependencies | Acceptance Criteria |
|---|---|---:|---|---|---|
| G-01 | P0 | M | Stockfish worker pool + lifecycle management | A-03, D-02 | Worker can process queued analysis jobs safely. |
| G-02 | P0 | M | `POST /api/analysis` and `GET /api/analysis/:id` | G-01, B-03 | Request/poll workflow returns eval + PV + depth data. |
| G-03 | P0 | S | Cancel analysis request | G-02 | In-flight job cancellation works from viewer. |
| G-04 | P1 | S | Per-user analysis rate limiting | G-02 | Abuse does not starve queue for other users. |
| G-05 | P1 | S | Engine UI pane integration | F-02, G-02 | Viewer shows analysis updates in near real-time. |

### Epic H: Export

| ID | Priority | Size | Task | Dependencies | Acceptance Criteria |
|---|---|---:|---|---|---|
| H-01 | P0 | M | Export job model and object storage output | A-03, C-01 | Export produces downloadable artifact. |
| H-02 | P0 | M | Export by selected IDs | H-01, E-02 | Selected rows export valid PGN. |
| H-03 | P0 | M | Export by current filter query | H-01, E-01 | Query export matches visible filtered set. |
| H-04 | P1 | S | Optional include-user-annotations toggle | H-02, F-04 | Export includes/excludes notes per setting. |

### Epic I: Security, Observability, and QA Hardening

| ID | Priority | Size | Task | Dependencies | Acceptance Criteria |
|---|---|---:|---|---|---|
| I-01 | P0 | M | Upload validation (type, extension, size) | D-01 | Invalid uploads rejected with clear errors. |
| I-02 | P0 | M | API authorization audit sweep | B-03, E-01, F-01 | Access-control test suite passes for all endpoints. |
| I-03 | P0 | M | Integration tests for import/search/export flows | D-03, E-01, H-03 | Critical flow tests pass in CI. |
| I-04 | P1 | M | Performance test suite (10M headers benchmark) | C-02, E-01 | P50/P95 thresholds measured and tracked. |
| I-05 | P1 | S | Dashboards/alerts (queue depth, job fail rate, API latency) | D-02, G-02 | Alerts configured for key SLO violations. |

## 4) MVP Sprint Plan (Execution Sequence)

### Sprint 1 (Foundation)

1. A-01, A-02, A-03, B-01, B-02, B-03, C-01, C-02.
2. Exit criteria:
   - User can log in.
   - Core schema deployed.
   - Local and CI environments stable.

### Sprint 2 (Import + List)

1. D-01, D-02, D-03, D-04, D-05, E-01, E-02, E-03.
2. Exit criteria:
   - User can upload PGN and see imported games in list.
   - Dedupe and status reporting functional.

### Sprint 3 (Viewer + Engine + Saved Filters)

1. F-01, F-02, F-03, G-01, G-02, G-03, E-04.
2. Exit criteria:
   - User can open game and analyze current position.
   - Saved filter basic workflow complete.

### Sprint 4 (Export + Hardening + Beta)

1. H-01, H-02, H-03, I-01, I-02, I-03, I-04, I-05.
2. Stretch: F-04, H-04, G-04.
3. Exit criteria:
   - End-to-end flow stable (`import -> search -> view -> analyze -> export`).
   - Performance and security baseline met.
   - Beta candidate deployed.

## 5) MVP Milestones and Deliverables

1. M1 (end Sprint 1): runnable authenticated skeleton.
2. M2 (end Sprint 2): ingest + searchable game database.
3. M3 (end Sprint 3): playable viewer with engine support.
4. M4 (end Sprint 4): export + QA-hardened beta.

## 6) V1 / V2 / V3 Expansion Plan

This section describes both backlog scope and the technical changes required beyond MVP.

## V1 (Opening and Position Intelligence)

Product scope:

1. Opening explorer/tree (move popularity, score percentages).
2. Position search (exact FEN + piece/material filter mode).
3. Expanded tagging/folder organization.
4. Saved searches with shareable links (private by default).

Required implementation details:

1. Data model:
   - Add `position_index` table (or external search index) keyed by normalized FEN and game/move references.
   - Add opening line aggregates (`opening_stats`) materialized per ECO and move prefix.
2. Ingestion:
   - Extend worker to emit per-ply position records (configurable sampling strategy to control size).
   - Batch aggregation jobs for explorer statistics.
3. Query/API:
   - New endpoints: `GET /api/search/position`, `GET /api/openings/tree`.
   - Cache hot explorer queries in Redis.
4. Frontend:
   - Explorer panel with move tree and win-rate/popularity data.
   - Position search builder with board editor + material constraints.
5. Infrastructure:
   - Storage increase (position index can be several multiples of raw game headers).
   - Scheduled aggregation jobs and index maintenance.

Suggested V1 epics:

1. V1-E1 Position index pipeline.
2. V1-E2 Opening explorer aggregation service.
3. V1-E3 Position search API + UI.
4. V1-E4 Tagging/folder UX refresh.

## V2 (Preparation Automation and Training Core)

Product scope:

1. Automated game annotation (blunders, missed tactics, critical moments).
2. Repertoire builder (white/black lines, model games).
3. Drill mode (spaced repetition on repertoire positions).
4. Player/opening prep reports.

Required implementation details:

1. Data model:
   - Add `repertoires`, `repertoire_lines`, `drill_items`, `report_snapshots`, `auto_annotations`.
   - Add engine cache table for repeated analysis reuse.
2. Services:
   - Long-running analysis pipelines with priority queue separation from interactive requests.
   - Report generation service (PDF/HTML export option).
3. Engine/compute:
   - Multi-PV and deeper analysis settings for offline jobs.
   - Cost controls: per-user quotas and background job budgets.
4. Frontend:
   - Repertoire editor UI tied to board and explorer.
   - Drill session UI with scheduling logic and performance tracking.
   - Report viewer/download screen.
5. ML/heuristics (optional in V2):
   - Heuristic critical-position detection based on eval swings and novelty.

Suggested V2 epics:

1. V2-E1 Offline annotation pipeline.
2. V2-E2 Repertoire data model + editor.
3. V2-E3 Drill engine and scheduler.
4. V2-E4 Prep report generation and exports.

## V3 (Collaboration and Publishing)

Product scope:

1. Shared studies/workspaces.
2. Team collaboration (comments, permissions, activity feed).
3. Public/private publishing links for games/reports.
4. Advanced training workflows (coach/student spaces).

Required implementation details:

1. Data model:
   - Add org/team model, role-based access control, shared collections, invitations.
   - Add collaboration entities (`threads`, `comments`, `events`).
2. Security:
   - Fine-grained authorization layer (resource-level ACL checks).
   - Audit logs for sharing and permission changes.
3. Realtime:
   - WebSocket or event-stream infrastructure for live collaboration updates.
4. Sync/versioning:
   - Version history for annotations/studies (optimistic concurrency or event-sourced log).
5. Publishing:
   - Signed share links with expiration/access rules.
   - Read-only public board embed endpoints.

Suggested V3 epics:

1. V3-E1 Multi-user tenancy and RBAC.
2. V3-E2 Live collaboration infrastructure.
3. V3-E3 Publishing/share links and embeds.
4. V3-E4 Team/coach workflows.

### Indicative Post-MVP Release Plan

1. V1 target: 2-3 sprints after MVP.
   - Sprint A: position indexing pipeline and backfill tools.
   - Sprint B: opening explorer API/UI and cached aggregates.
   - Sprint C (optional): advanced search UX polish and scaling hardening.
2. V2 target: 3-4 sprints after V1.
   - Sprint A: offline annotation queue and engine cache.
   - Sprint B: repertoire model/editor.
   - Sprint C: drill scheduler and session UI.
   - Sprint D (optional): prep-report generation and export hardening.
3. V3 target: 3-4 sprints after V2.
   - Sprint A: organizations, RBAC, invitations.
   - Sprint B: shared studies/comments + live events.
   - Sprint C: publishing links and embed endpoints.
   - Sprint D (optional): coach/student workflow refinements.

## 7) Cross-Version Architecture Decisions to Make Early

1. Keep move data model stable and extensible now (avoid re-migrating viewer payloads later).
2. Introduce source/provenance and license fields from day one.
3. Separate interactive engine queue from background analysis queue early.
4. Add feature flags now to stage V1/V2/V3 safely.
5. Use idempotent ingest and backfill patterns so new indexes can be generated from existing games.

## 8) Risks and Mitigations

1. Risk: Import throughput below target on large corpora.  
   Mitigation: streaming parser, batched inserts, profile copy-vs-insert path, benchmark each sprint.
2. Risk: Position index size explosion in V1.  
   Mitigation: configurable depth sampling, compressed encoding, partitioned tables.
3. Risk: Engine compute cost spikes in V2.  
   Mitigation: quotas, caching, separated queues, deferred analysis schedules.
4. Risk: Licensing mistakes with bundled datasets.  
   Mitigation: keep provenance metadata + source allowlist; bundle only explicitly redistributable sources.

## 9) Immediate Next Actions

1. Convert all `P0` tickets into issue tracker items with owners.
2. Create architecture decision records for:
   - PGN parser library choice
   - Storage format for move tree
   - Queue framework and job retry policy
3. Run a 1-week spike on import throughput using real Lichess monthly slices.
