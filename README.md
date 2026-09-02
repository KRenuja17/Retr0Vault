# Retr0Vault

Retr0Vault is a local-first visual inspiration and design-vocabulary archive. The current backend supports design-type and collection management, local image ingestion, Chromium website capture, full-text search, live counts, catalogue ordering, safe reference deletion, an external-curator analysis workflow with protected manual edits, and Markdown reference/direction exports.

## Prerequisites

- Windows 11 or later for website capture ([Playwright system requirements](https://playwright.dev/docs/intro#system-requirements))
- Node.js 22 or later
- npm 10 or later

No Docker, XAMPP/WAMP, external database server, cloud service, or AI API key is required.

## Start the backend on Windows

From PowerShell in the repository root:

```powershell
npm install
npm run capture:install
npm run db:migrate
npm run seed
npm run dev:api
```

The API listens on `http://127.0.0.1:4611`. Check it with:

```powershell
Invoke-RestMethod http://127.0.0.1:4611/api/v1/health
```

The database is created at `data/retr0vault.db`. The API also applies committed migrations during startup, so explicitly running `db:migrate` is safe and repeatable but not required after the first setup.

## Backend commands

```powershell
npm run dev:api      # Start the API in watch mode
npm run capture:install # Install the pinned Playwright Chromium browser
npm run db:migrate   # Apply committed SQLite migrations
npm run db:generate  # Generate migrations after schema changes
npm run seed         # Add representative development design types/collection
npm run seed:clear   # Remove only the development seed records
npm run test         # Run the backend test suite
npm run typecheck    # Type-check all TypeScript sources and tests
npm run build        # Build shared and API packages
```

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

The additive `0005_website_capture.sql` migration creates `reference_frames` without rebuilding references or disturbing search triggers. No frontend implementation is included; the HTML page under the backend tests is a deterministic browser fixture only.

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
  web/       Empty frontend workspace placeholder
packages/
  shared/    Shared Zod schemas and inferred TypeScript types
data/        Local SQLite and analysis runtime data (ignored)
storage/     Local reference files (ignored)
docs/        Analysis schema and external-curator instructions
```

Frontend implementation intentionally begins only after backend phases B1-B8 are complete.
