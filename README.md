# Retr0Vault

Retr0Vault is a local-first visual inspiration and design-vocabulary archive. The backend supports design-type and collection management, local image ingestion, Chromium website capture, full-text search, live counts, catalogue ordering, safe reference deletion, an external-curator analysis workflow with protected manual edits, and Markdown reference/direction exports. The React frontend is the editorial catalogue over it: the plate gallery, design-type style guides, the reference sheet, accession and the analysis desk, search, collections, and multi-reference compare/direction/export.

## Prerequisites

- Windows 11 or later for website capture ([Playwright system requirements](https://playwright.dev/docs/intro#system-requirements))
- Node.js 22 or later
- npm 10 or later

No Docker, XAMPP/WAMP, external database server, cloud service, or AI API key is required.

## Start Retr0Vault on Windows

From PowerShell in a development working copy's root:

```powershell
npm install
npm run capture:install
npm run db:migrate
npm run seed
npm run dev
```

`npm run dev` runs both processes together:

| | |
| --- | --- |
| Web | `http://localhost:4610` |
| API | `http://127.0.0.1:4611` |

Open the web address; the catalogue is at `/all`. `npm run capture:install` is
needed only for website capture — image upload, search, analysis and exports
work without it. Check the API on its own with:

```powershell
Invoke-RestMethod http://127.0.0.1:4611/api/v1/health
```

Run either half alone with `npm run dev:api` or `npm run dev:web`; the web
server proxies `/api` to the API, so the frontend needs the API running.

The database is created at `data/retr0vault.db`. The API also applies committed migrations during startup, so explicitly running `db:migrate` is safe and repeatable but not required after the first setup.

To keep a source-only checkout such as `D:\Retr0Vault` free of dependencies/build output, clone it to a separate working directory and run these commands there. Keep persistent runtime paths outside both checkouts, for example:

```powershell
git clone D:\Retr0Vault "$env:LOCALAPPDATA\Retr0Vault\workspace"
Set-Location "$env:LOCALAPPDATA\Retr0Vault\workspace"
$env:DATABASE_PATH = "$env:LOCALAPPDATA\Retr0Vault\runtime\retr0vault.db"
$env:STORAGE_ROOT = "$env:LOCALAPPDATA\Retr0Vault\runtime\storage"
$env:ANALYSIS_DATA_DIR = "$env:LOCALAPPDATA\Retr0Vault\runtime\data"
# Then run the install, migrate, seed and dev:api commands above.
```

Use the same environment variables for the API and every CLI command in each new PowerShell session. `seed` is optional representative content: rerunning it refreshes seed-owned records and can replace edits to them. Seed and seed-clear operations are atomic; a slug conflict or in-use design type leaves the entire operation unchanged. Neither command is a restore operation.

## Backend commands

```powershell
npm run dev          # Start API and web together
npm run dev:api      # Start the API in watch mode
npm run capture:install # Install the pinned Playwright Chromium browser
npm run db:migrate   # Apply committed SQLite migrations
npm run db:generate  # Generate migrations after schema changes
npm run seed         # Add representative development design types/collection
npm run seed:clear   # Remove only the development seed records
npm run test:api     # Run the backend test suite
npm run typecheck:api # Type-check shared/backend sources and backend tests
npm run build:api    # Build shared and API packages
npm run storage:orphans # Report old unowned files; does not move/delete them
```

No manual shared-package build is needed after `npm install`. `seed` and `seed:clear` build `@retr0vault/shared` first, including when invoked directly with `--workspace @retr0vault/api`. Direct API workspace `typecheck` builds shared declarations first; `start` builds the API and its shared dependency before running the compiled server. These pre-scripts stop the command if compilation fails.

`build:api` (and the API workspace `build`) already orders shared/API compilation through TypeScript project references. `dev:api`, `test:api`, the root `typecheck:api`, and the analysis/orphan CLIs use shared TypeScript source directly. `db:migrate`, `db:generate`, and `capture:install` do not need shared runtime output. The full root `typecheck` and `build` commands also check/build the frontend.

Environment variables are optional and validated at startup:

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Localhost bind address (`127.0.0.1` or `localhost`) |
| `PORT` | `4611` | API port |
| `LOG_LEVEL` | `info` | Fastify/Pino log level |
| `DATABASE_PATH` | `data/retr0vault.db` | Absolute path, or a path relative to the repository root |
| `STORAGE_ROOT` | `storage` | Absolute path, or a path relative to the repository root, for originals and thumbnails |
| `MAX_UPLOAD_BYTES` | `26214400` | Maximum multipart image size in bytes (25 MiB by default) |
| `ANALYSIS_DATA_DIR` | `data` | Parent directory for local analysis inbox/results; relative to the repository root or absolute |
| `CAPTURE_TIMEOUT_MS` | `45000` | Maximum browser-capture duration, including DNS and launch (1,000–120,000 ms), followed by process cleanup |
| `NODE_ENV` | `development` | Runtime mode |

## Library statistics

`GET /api/v1/stats` returns one consistent database snapshot, with no query parameters:

```json
{
  "totalReferences": 0,
  "pendingReferences": 0,
  "analyzedReferences": 0,
  "unassignedReferences": 0,
  "countsByDesignType": [],
  "countsByCollection": []
}
```

Each group is `{ "id": "uuid", "name": "Name", "slug": "name", "referenceCount": 0 }`, ordered by configured sort order then UUID. Empty groups are included. Totals and group counts include all four statuses; pending/analyzed counters match those exact statuses, not manual/failed. Unassigned means no design type. A reference may belong to multiple collections, so collection counts are not additive. No counts are cached.

## Local access, validation and error safety

- The server binds only to `127.0.0.1` or `localhost`; no LAN/public bind or reverse proxy is supported. Host headers must name `localhost`, `127.0.0.1`, or `[::1]`, blocking arbitrary DNS-rebinding hostnames.
- Browser origins are restricted to HTTP loopback names on frontend port `4610` or the configured API port. Other origins, including `null`, are rejected **before writes**, not merely denied CORS response headers. Cross-site browser requests without Origin are also rejected. Exact-origin CORS supports GET/HEAD/POST/PATCH/DELETE preflights, Content-Type, and exposed Content-Disposition; no credentials or wildcard origins.
- This is a single-user local application, not an authenticated multi-user service. Native local programs can omit Origin. Keep the machine, loopback frontend, runtime directories and their parents trusted; filesystem checks are not a sandbox against another process running as your Windows user. Do not expose the API through port forwarding or a tunnel.
- Ordinary JSON requests are limited to 1 MiB; analysis/export routes allow 2 MiB. Uploads allow one file (25 MiB default), up to 20 fields, 8 KiB per field and 100-byte field names. Truncated fields are rejected. Images are actually decoded, limited to 100 million pixels, and thumbnails are generated before exclusive file writes. Existing files and links are never intentionally overwritten by ingestion.
- Newly supplied metadata source URLs must be HTTP(S), at most 2,048 characters, without credentials, whitespace, control characters or backslashes. They are not fetched. Website capture additionally enforces the public-network rules above. Historical metadata remains readable; unsafe links are not rendered as clickable links in exports.
- Manual analysis JSON is limited to 20 nesting levels and 10,000 values. Protected field names are unique and validated. Strict analysis imports retain their full dimension schema, per-record transactions and protected-edit rules. CLI imports read one regular, non-linked, bounded 2 MiB JSON file at a time and detect duplicates across the whole batch; input files are not consumed or deleted.
- Responses use the shared `{ error: { code, message, statusCode }, requestId }` envelope. Unexpected failures are generic in every environment; expected API failures retain actionable messages. SQLite lock contention has a one-second wait and returns 503 `DATABASE_BUSY` with `Retry-After: 1`. Before retrying a write after a lost connection, check whether it already succeeded.
- HTTP logs retain request IDs, methods, response statuses and timing, but omit raw URLs/query strings, bodies, authorization headers, SQL parameters and exception stacks. Responses default to `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`.

## Database integrity and migrations

SQLite connections enable foreign keys, WAL and full synchronous durability. Existing foreign-key delete/restrict behavior, unique relations, enums, positive image dimensions and ordering constraints remain enforced. Committed migrations are repeatable; never edit a migration already applied to a real library.

The additive `0006_backend_json_guards.sql` migration validates legacy JSON and installs insert/update guards: analysis must be a JSON object or SQL NULL, and protected fields must be a unique array of supported names. It does not rebuild references or alter their rowids, relations or FTS triggers. If the preflight fails, the migration rolls back without repairing or discarding user data. Back up first, inspect the affected JSON with a SQLite tool, repair only the confirmed bad record, and retry. Future table-rebuild migrations must recreate these custom guards as well as the FTS projection/triggers; Drizzle's table snapshot does not model custom triggers.

## Deletion and orphan-file maintenance

Reference deletion commits database cascades first, then removes only that UUID's validated original, thumbnail and recorded capture frames. Database rejection retains all files. Missing files are harmless on repeated cleanup; unsafe paths, linked directories or filesystem failures are left alone and produce a cleanup warning. An HTTP 204 means the database deletion succeeded, even if file cleanup could not finish. API deletion is permanent; recovery requires a backup.

Crashes between file creation and the database transaction, or failed filesystem cleanup, can leave orphans. There is no automatic startup deletion. Stop the API, captures, importers and other storage writers; make a backup; verify that `DATABASE_PATH` and `STORAGE_ROOT` identify the same library. Then:

```powershell
npm run storage:orphans
# Review candidates before explicitly moving them:
npm run storage:orphans -- --quarantine
```

The command requires an existing database and passes SQLite quick/foreign-key checks before touching storage. Only recognized UUID image/frame filenames at least 24 hours old qualify. Files belonging to any live reference ID or referenced database path, recent files, unknown names, nested/unrecognized content and links are retained; linked managed directories abort the scan. Empty directories are not recursively removed.

Quarantine moves eligible files to `STORAGE_ROOT/quarantine/<batch-uuid>/` with their original relative paths intact. It never removes database rows or permanently deletes quarantined content. Review the JSON report's `candidates`, `quarantined`, `skipped` and `quarantineDirectory`. If interrupted, completed moves remain recoverable under quarantine; rerunning scans remaining files. To recover a mistaken move, keep writers stopped and copy the selected file back to its original relative path only after checking that destination is absent. Keep quarantine until a verified backup and manual review make it unnecessary.

## Backup and restore expectations

Git contains code, migrations and documentation—not the library. Back up before upgrades, bulk changes or cleanup, and periodically to a separate local disk. There is no automatic backup/cloud sync requirement.

1. Stop the API and every importer/maintenance process, and wait for them to exit. Use a new backup directory outside the repository and live runtime roots.
2. Copy the configured SQLite database and any remaining `-wal`/`-shm` sidecars together, the entire `STORAGE_ROOT` (including originals, thumbnails, captures and quarantine), and `ANALYSIS_DATA_DIR` inbox/results. Record the runtime path settings and Git commit used. Do not modify/remove WAL files manually: committed data may still be in the [SQLite WAL](https://www.sqlite.org/wal.html).
3. Verify the backup by restoring it into fresh, separate directories with all processes stopped; never mix database/storage from different backups or overwrite the only good copy. Point the three environment variables at the restored paths, run `npm run db:migrate`, then start the API.
4. Compare `/api/v1/stats`, open representative reference metadata, check original/thumbnail/capture files and search terms, and confirm analysis protections. Regenerate pending manifests after restoring to a new path because their absolute image paths can be stale. Do not run `seed` as part of recovery unless deliberately refreshing sample content.

Copying only a live `.db` file is not a valid backup procedure. SQLite has an [online backup API](https://www.sqlite.org/backup.html), but a database-only snapshot would still need coordination with image-file writes; V1 documents and tests the stopped-process backup procedure instead. Store backups with appropriate Windows permissions because source URLs and curator results may be private.

## Backend V1 verification

Run `npm run test`, `npm run typecheck` and `npm run build` after installing Chromium. Tests cover fresh and populated migrations, constraints, CRUD/deletion, real Chromium lifecycle and SSRF boundaries, analysis safety, exports, FTS updates/relevance/pagination, live statistics, browser-origin rejection, upload rollback, orphan quarantine and cold-backup restoration. Frontend tests cover the catalogue, style guides, the reference sheet, accession and the analysis desk, search, collections, selection, compare, direction and exports against a stubbed API. Tests use disposable runtime directories.

Dependency audit at this checkpoint: `npm audit --omit=dev` reports no runtime advisories. The full audit reports four moderate entries in the development-only Drizzle Kit → esbuild-kit → esbuild chain, all stemming from [esbuild's development-server CORS advisory](https://github.com/evanw/esbuild/security/advisories/GHSA-67mh-4wv8-2f99). Retr0Vault does not run that esbuild server or Drizzle Studio. Keep migration generation local/trusted; do not use `npm audit fix --force`, which currently proposes a breaking Drizzle Kit downgrade. Review upstream fixes when upgrading the pinned lockfile.

## Reference image API

Upload one JPEG, PNG, or WebP image as multipart form data. The file field must be named `file`; optional text fields are `title`, `sourceUrl`, and `designTypeId`.

```powershell
curl.exe -X POST http://127.0.0.1:4611/api/v1/references/image `
  -F "file=@C:\path\to\reference.png" `
  -F "title=Reference title"
```

Reference endpoints:

```text
POST   /api/v1/references/image
POST   /api/v1/references/url
GET    /api/v1/references
GET    /api/v1/references/:id
PATCH  /api/v1/references/:id
DELETE /api/v1/references/:id
```

The list endpoint accepts `q`, `designType`, `collection`, `status`, `page`, `limit`, `sort`, and `includeCatalogueIndex` query parameters. Originals are preserved beneath `storage/originals`; generated WebP thumbnails are written beneath `storage/thumbnails`.

### Reference media for the frontend

Use the reference **ID**, not `originalPath` or `thumbnailPath`, to construct image URLs:

```text
GET /api/v1/media/:referenceId/thumbnail
GET /api/v1/media/:referenceId/original
```

With the existing F1 Vite `/api` proxy, use the same-origin image `src` `/api/v1/media/<reference-id>/thumbnail`; use `/original` in a detail view. Direct URLs use the API origin `http://127.0.0.1:4611`; when frontend/API hostnames differ, set the image's `crossOrigin="anonymous"` so the request includes the allowed Origin header. No change to the existing origin restrictions is needed.

Both routes return raw image bytes (not JSON) with `Content-Length` and `X-Content-Type-Options: nosniff`. Thumbnails are `image/webp`; originals are `image/jpeg`, `image/png`, or `image/webp`. For website captures, original means the primary `viewport.png`, not the full-page or other frames. HEAD returns the same headers without an image body.

The ID must be a UUID (case-insensitive); no query parameters or filesystem paths are accepted. Missing references return 404 `REFERENCE_NOT_FOUND`; missing, unreadable or unsafe media returns 404 `MEDIA_NOT_FOUND`. Invalid IDs/query parameters return 400 `VALIDATION_ERROR`. Errors use the existing JSON envelope and `Cache-Control: no-store`. Existing reference response fields and storage layout are unchanged; `storage/` is not exposed as a static directory.

Successful responses use `Cache-Control: private, max-age=0, must-revalidate` and a weak ETag. Browsers can cache bytes and revalidate with `If-None-Match`; a matching validator returns an empty 304 only after the reference and safe file are checked again. Deleted/missing media returns 404 even with a previously valid ETag. Normal image loading handles this automatically; the existing localhost/Origin/CORS policy still applies. Byte-range requests are not supported (GET returns the complete image).

## Website capture API

Install Chromium once with `npm run capture:install`, and rerun it after a Playwright version update. [Playwright](https://playwright.dev/docs/browsers) manages its own browser in the per-user cache; no installed Chrome profile, cloud service, Docker image, or external browser server is required. Ordinary uploads, search, analysis, and exports still work if Chromium has not been installed. The full test suite includes real headless Chromium tests and therefore requires this install step.

```powershell
$captureRequest = @{
  url = 'https://example.com/'
  title = 'Example website' # Optional; defaults to the submitted hostname
  fullPage = $false        # Optional; defaults to false
} | ConvertTo-Json
Invoke-RestMethod 'http://127.0.0.1:4611/api/v1/references/url' `
  -Method Post -ContentType 'application/json' -Body $captureRequest
```

Optional `designTypeId` selects an existing category. Input is strictly validated; callers cannot provide browser flags, executable paths, scripts, storage paths, or a private-network override.

The endpoint waits for the capture and returns HTTP 201 with the normal reference response, `sourceType: "website"`, `analysisStatus: "pending"`, and ordered `frames`. A fresh, sandboxed, headless Chromium process uses a 1440 × 900 viewport, pixel ratio 1, English locale, UTC, light colour scheme, and reduced motion. It waits for DOM readiness, then up to two seconds of network idle. Navigation is limited to 15 seconds; the overall browser deadline defaults to 45 seconds. Dynamic sites, login screens, consent banners, bot protection, and lazy content can affect what is visible; capture does not interact with or bypass them.

Frames are PNG files beneath `storage/captures/<reference-id>/`:

- `viewport.png`: primary top viewport, also used as `originalPath` and to generate the card's WebP thumbnail under `storage/thumbnails`.
- `hero.png`: optional top hero/first section when a visible matching element fits inside the viewport. It is omitted if no suitable region is found.
- `scroll-50.png`, `scroll-80.png`: viewports at approximately 50% and 80% of the scrollable distance. Short pages can produce identical views.
- `fullpage.png`: only when `fullPage` is true; maximum page dimensions are 4096 × 20000 pixels. Oversized pages fail clearly; retry without `fullPage`.

Each frame has its own UUID, `referenceId`, `frameType` (`viewport`, `hero`, `scroll`, or `fullpage`), relative `imagePath`, and zero-based `sortOrder`. Reference detail/list responses include `frames` (empty for ordinary image uploads). Original capture files are not duplicated under `originals`. Analysis manifests include safe absolute paths for the primary image and all frames; comparison manifests include their storage-relative paths.

### Public-network boundary and failures

Capture accepts public HTTP/HTTPS URLs on their standard ports only (80/443). Credentials, unsafe schemes such as `file:`, local hostnames, private/loopback/link-local/metadata addresses, reserved ranges, and mixed public/private DNS answers are rejected. Redirects and page resources use the same policy. A short-lived authenticated loopback proxy connects to the validated numeric IP address, preventing a second DNS lookup from bypassing the address check. It is closed after capture and is not a standalone service to configure.

The browser has no saved user session. Service workers, WebSockets, downloads, non-GET/HEAD requests, and non-proxied WebRTC/QUIC traffic are disabled or blocked. Only one capture runs per backend instance; simultaneous requests receive 429 `CAPTURE_BUSY` (there is no background queue). Network transfer is limited to 100 MiB, captured PNGs to 50 MiB, and requests/connections to 1,000. These restrictions can omit resources from some sites; the screenshot records the resulting visible page.

Errors use the usual structured JSON envelope: 400 for invalid/unsafe targets, 413 for size limits, 502 for DNS/navigation/remote-page failures, 503 if Chromium is unavailable or shutdown cancels capture, and 504 for timeouts. `CAPTURE_BROWSER_UNAVAILABLE` instructs you to run `npm run capture:install`. A failed capture creates no reference with missing images. Files are rolled back if database insertion fails. Deletion cascades frame rows first, then removes only that reference's known files; unrelated files are retained. Chromium and its network proxy are cleaned up after success, failure, timeout, or backend shutdown.

The additive `0005_website_capture.sql` migration creates `reference_frames` without rebuilding references or disturbing search triggers. The HTML page under the backend tests is a deterministic browser fixture only.

## Search and catalogue queries

```powershell
Invoke-RestMethod 'http://127.0.0.1:4611/api/v1/references?q=technical%20mono&sort=relevance&page=1&limit=24&includeCatalogueIndex=true'
```

Search covers titles, Design DNA, design theses, visual tags, design-type names/slugs/descriptions and vocabulary, source URLs, design briefs, image recipes, and text values inside structured analysis. It is local SQLite search; no embedding model, vector database, AI API, or external service is used.

| Parameter | Behaviour |
| --- | --- |
| `q` | Up to 500 characters. All words must match, possibly across different fields. Matching is case-insensitive and ignores Latin accents. Punctuation separates words; FTS operators and SQL syntax are not executed. This is whole-word matching, not arbitrary substring or fuzzy search. Empty/whitespace input lists all references; punctuation-only input matches none. |
| `designType`, `collection` | Exact slugs; combined with each other and the search/status filters. Unknown slugs return an empty result. |
| `status` | `pending`, `analyzed`, `manual`, or `failed` |
| `sort` | `relevance`, `newest`, `oldest`, `title-asc`, or `title-desc`. Defaults to relevance when `q` is nonempty, newest otherwise. Explicit relevance without a query uses newest. Title sorting uses SQLite's `NOCASE` collation. |
| `page`, `limit` | One-based page (default 1, maximum 1,000,000) and page size (default 24, range 1–100). The response includes `page`, `limit`, `total`, and `totalPages`; an out-of-range page is empty but retains the matching total. |
| `includeCatalogueIndex` | Literal `true` or `false` (default false). When true, each list item includes a one-based `catalogueIndex` within the complete filtered/sorted result set, before pagination. Otherwise the property is omitted. |

Relevance gives more weight to titles, Design DNA, and visual tags than long-form text. Ties use stable UUID ordering (relevance also uses newest-first for equally ranked results). Catalogue indexes remain stable for unchanged data/query/sort, not across library edits or different filters. Totals, page items, and their relations are read from one database snapshot. Design-type and collection `referenceCount` values are live totals across all statuses, independent of the current search.

The custom migration `apps/api/drizzle/0004_reference_search.sql` owns the [SQLite FTS5](https://www.sqlite.org/fts5.html) table, a shared source projection, and transactional synchronization triggers. It backfills existing references and refreshes the index when reference text, tags, assignments, or category vocabulary changes, including analysis imports. Reference UUIDs—not implicit database rowids—identify documents. Future migrations that rebuild source tables must preserve these triggers; changes to indexed columns must keep the projection and BM25 weights in `reference-search.ts` aligned.

## External-curator analysis

No AI API or provider SDK is used. Export pending references, inspect their local images with an external curator, review the resulting JSON, then import it:

```powershell
npm run analysis:export-pending
# Read data/analysis-inbox/manifest.json and instructions.md.
# Save one reviewed analysis object per file in data/analysis-results.
npm run analysis:import
```

The manifest includes stable reference IDs, existing design types, original image paths, and JSON Schema generated from the shared Zod schema. Images are not copied. Each result is validated and imported independently; reports identify failures and preserved manual fields. Imports and resets never modify image files.

Manual edits to analysis fields are automatically protected. Use the reference PATCH endpoint's `protectedFields` array to explicitly replace those locks. Only use `npm run analysis:import -- --overwrite-protected` when intentionally replacing protected content; locks remain for future imports.

```text
GET  /api/v1/analysis/pending
POST /api/v1/analysis/import
POST /api/v1/analysis/:referenceId/reset
```

The import endpoint accepts `{ "analyses": [ /* analysis objects */ ], "overwriteProtected": false }`. Reset only sets status to pending and preserves all metadata and protections. Read [the analysis contract and curator guide](docs/analysis-schema.md) for schema details, limits, result reports, and safety rules.

## Markdown exports and comparison manifests

Both endpoints accept JSON and return a UTF-8 Markdown attachment, not a JSON wrapper:

```text
POST /api/v1/export/references
POST /api/v1/export/design-direction
```

Exports are read-only: they do not create files on the server, modify references, clear manual protections, copy images, or persist a direction object. No AI service or new runtime dependency is involved. The downloaded file can be used in an external coding-agent project.

### Reference, category and vocabulary exports

Use an explicit `mode` in the request body:

| Mode | Selection | Markdown content |
| --- | --- | --- |
| `references` | `referenceIds: ["uuid", ...]` | One or more references, in selection order: title, source, analysis status, design type, Design DNA/thesis, typed visual tags, available analysis dimensions, design brief, image recipe, motion/asset briefs. Missing values are marked, not invented. |
| `category-brief` | `designTypeIds: ["uuid", ...]` | Selected category mini-style-guides: summary, deploy-for guidance, risk, principles, anti-patterns, vocabulary, and reusable brief block. Category references are not implicitly exported. |
| `vocabulary` | `referenceIds` and/or `designTypeIds` | Only selected references' tag values and explicitly selected categories' vocabulary. Terms are deduplicated by Unicode NFKC, whitespace, and case; the first spelling/order is retained. A reference's category is not automatically selected. |

Each selection array accepts at most 100 unique UUIDs. Reference/category modes require a nonempty matching array; vocabulary mode requires at least one selection across its two optional arrays. UUID case is normalized. Unknown IDs return a structured 404 for the whole request; invalid/duplicate selections or unknown fields return 400. All selected records and relations are read from one database snapshot.

PowerShell example (replace the UUID with an existing reference ID):

```powershell
$exportRequest = @{
  mode = 'references'
  referenceIds = @('11111111-1111-4111-8111-111111111111')
} | ConvertTo-Json
Invoke-WebRequest 'http://127.0.0.1:4611/api/v1/export/references' `
  -Method Post -ContentType 'application/json' -Body $exportRequest `
  -OutFile '.\retr0vault-references.md'
```

For category briefs use `{ "mode": "category-brief", "designTypeIds": ["uuid"] }`; for vocabulary use `{ "mode": "vocabulary", "referenceIds": ["uuid"], "designTypeIds": ["uuid"] }`.

### Pending combinations and already-authored directions

`POST /api/v1/export/design-direction` supports exactly two modes:

- `pending-combination`: select 2–100 references with `referenceIds`, plus optional `intent` (1–5,000 characters). The first selected reference is the primary starting point, not automatic authority for all dimensions. The Markdown manifest contains comparison instructions, a structured snapshot of the selected sources (including full internal analysis and category context), and the JSON Schema for the authored result. Image paths are relative to configured `STORAGE_ROOT`; downloading the manifest does not bundle images or fetch source URLs.
- `authored`: select 1–100 references with `referenceIds` and provide a completed `direction` object. The endpoint validates and formats the supplied decisions without generating or evaluating them. The first selected reference is primary; subsequent references are supporting sources.

```powershell
$combinationRequest = @{
  mode = 'pending-combination'
  referenceIds = @(
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222'
  )
  intent = 'A restrained editorial portfolio with one expressive image treatment.'
} | ConvertTo-Json
Invoke-WebRequest 'http://127.0.0.1:4611/api/v1/export/design-direction' `
  -Method Post -ContentType 'application/json' -Body $combinationRequest `
  -OutFile '.\retr0vault-pending-combination.md'
```

Ask the external curator to process the manifest, review its JSON result, and submit that result back to the same endpoint:

```powershell
$authoredRequest = Get-Content -LiteralPath '.\reviewed-direction.json' -Raw
Invoke-WebRequest 'http://127.0.0.1:4611/api/v1/export/design-direction' `
  -Method Post -ContentType 'application/json' -Body ([System.Text.Encoding]::UTF8.GetBytes($authoredRequest)) `
  -OutFile '.\retr0vault-direction.md'
```

The result body is `{ "mode": "authored", "referenceIds": [...], "direction": {...} }`. The manifest's embedded schema and shared `authoredDirectionExportRequestSchema` define the complete contract. The direction contains:

- `title`, `designDNA`, `designThesis`, `vocabulary`, and a coherent `designBrief`.
- `dimensions`: text for each of `typography`, `layout`, `colour`, `textureImagery`, `uiTreatment`, and `motion` (including an explicit no-motion decision when appropriate).
- `borrowings`: exactly one `{ "referenceId", "borrow" } entry for every selected reference.
- `authority`: exactly one `{ "dimension", "referenceId", "decision" } entry for each of the six dimensions, using only selected references.
- `conflicts`: `{ "conflict", "resolution" } entries, or an empty array if none were identified; at least one `antiPatterns` entry.
- `imageRecipes`: up to 20 provider-neutral strings containing `[SUBJECT]`, or an empty array if none are needed.

The manifest explicitly requires comparison, conflict resolution, dimension-specific authority, and one coherent direction—not a simple average of the sources. The endpoint checks cross-reference relationships in addition to JSON structure. Source metadata is marked as data, not instructions; curator output still requires human review. This is an export round trip, not the reference-analysis import endpoint or a persisted direction library.

### Download safety and limits

Responses use `Content-Disposition: attachment` with `retr0vault-<export-kind>-<content-hash>.md`. Filenames contain no user title, URL, or path; identical content produces identical filenames. There are no generated timestamps. Text uses LF newlines, source prose is escaped as Markdown text, and copyable briefs/recipes and JSON use fences longer than any embedded backticks. Missing metadata remains explicit.

Requests are capped at 2 MiB and generated files at 8 MiB (413 if exceeded; select fewer items). Downloads use `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`. No database migration is needed for exports.

## Workspace layout

```text
apps/
  api/       Fastify backend
  web/       React catalogue frontend (Vite)
packages/
  shared/    Shared Zod schemas and inferred TypeScript types
data/        Local SQLite and analysis runtime data (ignored)
storage/     Local reference files (ignored)
docs/        Analysis schema and external-curator instructions
```

## Verifying a change

```powershell
npm run typecheck
npm run test
npm run build
```

`npm run test` runs the API suite then the web suite. Website-capture tests need
Chromium, so run `npm run capture:install` first.
