# Chess DB MVP Specification

Date: 2026-02-11  
Project: Web-based chess database (ChessBase-like)

## 1) MVP Goal

Ship a web app that lets a player:

1. Import large PGN datasets.
2. Search/filter games quickly.
3. Open any game in a board + notation viewer with comments/variations.
4. Run on-demand engine analysis on current position (single PV).
5. Export selected games as PGN.

This MVP is focused on "database + review workflow", not full preparation automation.

## 2) Product Scope

### In Scope (MVP)

1. Account + private database per user.
2. PGN import (`.pgn`, `.pgn.zst`) with async job tracking.
3. Deduplication during import.
4. Game list with fast filters:
   - Player (White/Black)
   - ECO
   - Event/Site
   - Date range
   - Result
   - Time control
   - Rated/unrated (when present)
5. Sort + pagination.
6. Game viewer:
   - Interactive board
   - Move list
   - Variations
   - PGN comments and NAGs
   - Arrows/highlight annotations stored per user
7. Engine panel:
   - Stockfish analysis for current position
   - Depth/nodes limit settings
   - Best line + eval
8. Export current search result or selected games to PGN.
9. Saved filters ("smart folders").

### Out of Scope (MVP)

1. Full position search index (exact FEN/substructure search).
2. Opening explorer/tree UI.
3. Cloud collaboration/shared studies.
4. Automated full-game annotation pipeline.
5. Repertoire drill/training modes.
6. Mobile-native app.

## 3) User Stories (MVP Acceptance)

1. As a user, I can import a PGN file with at least 1M games and watch progress/errors.
2. As a user, I can filter to games by player + ECO + date and get results quickly.
3. As a user, I can open a game and replay all mainline + variations correctly.
4. As a user, I can run engine analysis on a position and see best move/eval.
5. As a user, I can save a filter and reopen it later.
6. As a user, I can export selected games as a valid PGN file.

## 4) Functional Requirements

### 4.1 Authentication & Tenancy

1. Email/password auth.
2. Each game belongs to exactly one user.
3. No cross-user visibility in MVP.

### 4.2 Import Pipeline

1. Upload endpoint accepts:
   - `application/x-chess-pgn`
   - `.pgn.zst`
2. Import runs asynchronously via queue worker.
3. Status lifecycle: `queued -> running -> completed|failed|partial`.
4. Import report:
   - Total games parsed
   - Inserted
   - Duplicates skipped
   - Parse errors (with line/game offset)
5. Parser supports:
   - Standard 7-tag roster + common extra tags
   - Variations
   - Comments
   - NAGs
6. Fail-soft behavior: malformed game should not abort entire file.

### 4.3 Search & Filtering

1. Text filters are case-insensitive.
2. Filters are combinable with AND semantics.
3. Sorting options: Date desc/asc, White, Black, ECO.
4. Default page size 50; max 200.
5. Search results include:
   - White, Black, Result, Date, Event, ECO, Ply count

### 4.4 Game Viewer

1. Board state must match PGN move-by-move.
2. Supports stepping, autoplay, jump-to-move.
3. Displays SAN notation with nested variations.
4. Displays and edits user notes/arrows (stored separately from original PGN).
5. "Open original PGN" and "copy FEN at move" actions.

### 4.5 Engine Analysis

1. On-demand analysis request takes FEN + limits.
2. Returns:
   - Eval (cp/mate)
   - Best line in UCI + SAN
   - Depth/nodes/time
3. Analysis is cancellable by client.
4. Rate-limited per user to avoid worker starvation.

### 4.6 Export

1. Export by:
   - Selected game IDs
   - Current search query
2. Preserve original tags/moves/comments.
3. Include optional user annotations toggle.

## 5) Non-Functional Requirements

1. Query latency:
   - P50 <= 120 ms
   - P95 <= 500 ms
   - On dataset size up to 10M games per user (indexed fields only)
2. Viewer open time:
   - P95 <= 1.5 s for games <= 200 plies
3. Import throughput target:
   - >= 30k games/minute on a 4 vCPU worker for clean PGN
4. Availability target:
   - 99.5% monthly for MVP
5. Security:
   - OWASP baseline controls, encrypted passwords, signed sessions
6. Observability:
   - Structured logs, import job metrics, API latency dashboards

## 6) Proposed Architecture

### 6.1 Components

1. Frontend: React + TypeScript (Next.js app router).
2. API service: TypeScript (NestJS or Fastify).
3. Worker service: PGN ingest + engine jobs.
4. DB: PostgreSQL 16.
5. Cache/queue: Redis (BullMQ or equivalent).
6. Engine: Stockfish process pool (UCI).
7. Object storage: S3-compatible bucket for uploaded sources/exports.

### 6.2 Data Flow

1. User uploads file -> API stores object -> creates import job.
2. Worker streams file, decompresses if needed, parses games, writes batches.
3. API queries indexed header tables for list/search.
4. Game viewer fetches move tree payload by game ID.
5. Engine request enters queue -> worker returns analysis payload.

## 7) Data Model (Logical)

### 7.1 Core Tables

1. `users`
2. `collections` (optional grouping/folders)
3. `games`
   - `id`, `user_id`, `source_id`, `import_job_id`
   - normalized header fields (white, black, eco, event, site, date, result, time_control)
   - `ply_count`, `starting_fen`, `moves_hash`, `created_at`
4. `game_pgn`
   - original canonical PGN text (compressed)
5. `game_moves`
   - serialized move tree JSONB (mainline + variations + comments + nags)
6. `tags`
7. `game_tags`
8. `saved_filters`
9. `import_jobs`
10. `import_errors`
11. `user_annotations`
12. `engine_requests`
13. `engine_results`

### 7.2 Indexes

1. `games(user_id, date desc)`
2. `games(user_id, white_norm)`
3. `games(user_id, black_norm)`
4. `games(user_id, eco)`
5. `games(user_id, result)`
6. `games(user_id, time_control)`
7. `games(user_id, event_norm)`
8. `games(user_id, moves_hash)` unique-ish for dedupe

## 8) API Surface (Draft)

1. `POST /api/imports` -> create import job (multipart upload metadata)
2. `GET /api/imports/:id` -> status/progress/report
3. `GET /api/games` -> filtered list
4. `GET /api/games/:id` -> headers + move tree + metadata
5. `GET /api/games/:id/pgn` -> raw PGN
6. `POST /api/filters` / `GET /api/filters`
7. `POST /api/analysis` -> enqueue engine request
8. `GET /api/analysis/:id` -> poll analysis result
9. `POST /api/exports` -> create export by query or IDs
10. `GET /api/exports/:id` -> download URL

## 9) Import & Dedupe Rules

1. Normalize player names for indexing:
   - trim, collapse spaces, lower for `_norm` columns
2. `moves_hash`:
   - SHA-256 over starting FEN + SAN mainline sequence + result
3. Duplicate definition (MVP):
   - same `user_id` + same `moves_hash` + same game date (if present)
4. Keep first-seen record, increment duplicate counter.
5. Store parser warnings but continue.

## 10) UI Screens (MVP)

1. Login/Register
2. Database Home:
   - left filters panel
   - center game table
   - top actions (import/export/save filter)
3. Import Jobs page:
   - queue state + error drill-down
4. Game Viewer page:
   - board
   - notation tree
   - metadata pane
   - engine pane

## 11) Security & Compliance Baseline

1. Password hashing: Argon2id.
2. Session: HTTP-only secure cookies, CSRF protection.
3. Upload validation:
   - content-type and extension checks
   - size limits (configurable)
4. Per-user data isolation in all queries.
5. Audit log for imports/exports.

## 12) Testing Strategy

1. Unit:
   - PGN parser edge cases (variations/comments/NAGs)
   - dedupe hash logic
2. Integration:
   - import job end-to-end
   - filtered query correctness
   - export round-trip validity
3. E2E:
   - upload -> search -> open game -> analyze -> export
4. Load:
   - 10M game header benchmark
   - concurrent engine requests with rate limit behavior

## 13) Delivery Plan

1. Sprint 1:
   - auth, schema, import jobs, basic game list
2. Sprint 2:
   - filters/saved filters, game viewer
3. Sprint 3:
   - engine analysis, export, hardening + tests
4. Beta milestone:
   - production deploy with seeded dataset and performance validation

## 14) Large Game Sources We Can Include

This section separates what is safe to bundle from what should remain user-import only.

### 14.1 Recommended Default Source: Lichess Open Database

Why:

1. Massive scale.
2. Explicit redistribution permission.
3. Machine-friendly monthly files (`.pgn.zst`) and torrents.

Current snapshot details (as listed on 2026-02-11):

1. Standard rated pool: `7,507,487,928` games.
2. January 2026 standard file: `94,604,722` games (`30.7 GB` compressed).
3. Exports are explicitly CC0 (commercial use + redistribution allowed).

Implementation recommendation:

1. Seed MVP with a curated subset (for example, one month by rating/time-control filters), not the full corpus.
2. Keep full historical import as optional background ingestion pipeline.

### 14.2 Also Usable: Lichess Broadcast Games

1. ~`992,275` broadcast games listed.
2. License shown as CC BY-SA 4.0 (attribution + share-alike obligations).
3. Good source for high-quality OTB coverage.

### 14.3 User-Import Only (Do Not Bundle by Default)

1. TWIC:
   - Archive is large (site references 4M+ games), but indexed pages include "free for personal use only" and "All material © The Week in Chess".
   - Treat as user-provided import unless explicit permission is obtained.
2. Chess.com PubAPI:
   - Excellent for pulling public games by player/month.
   - API docs emphasize per-endpoint refresh windows and rate limits; no clear blanket open-data redistribution license in the API docs.
   - Use for account-linked imports, not pre-bundled global dataset.
3. FICS Games Database:
   - Very large corpus (site stats show hundreds of millions of games and downloads by year/type).
   - Public pages reviewed do not state a clear redistribution license.
   - Treat as user import or seek written permission before bundling.
4. Commercial chess databases (e.g., ChessBase Big/Mega):
   - Large, high quality, but paid/proprietary.
   - Not suitable for bundling in an open MVP without licensing agreements.

## 15) Dataset Decision for MVP

1. Bundle: Lichess CC0 game subset (primary seed).
2. Optional bundle: Lichess Broadcast subset with required attribution.
3. Bring-your-own imports: user PGN, TWIC zip, Chess.com account exports/API pulls.
4. Keep clear provenance metadata per game (`source`, `license`, `imported_by`, `import_date`).

## 16) References (Checked 2026-02-11)

1. Lichess open database (counts, monthly files, CC0 statement):  
   https://database.lichess.org/
2. Lichess broadcast database (count + CC BY-SA statement):  
   https://database.lichess.org/#broadcast
3. Chess.com Published Data API docs (rate limits/refresh windows, per-player archive model):  
   https://www.chess.com/news/view/published-data-api
4. FICS games database stats/downloads pages:  
   https://www.ficsgames.org/  
   https://www.ficsgames.org/download.html
5. TWIC pages (site blocks automated fetch with HTTP 406 in this environment; rights language observed via search index snippets):  
   https://theweekinchess.com/  
   https://theweekinchess.com/twic
6. ChessBase commercial database example:  
   https://shop.chessbase.com/en/products/database2026
