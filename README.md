# Retr0Vault

Retr0Vault is a local-first visual inspiration and design-vocabulary archive. The current backend supports design-type and collection management, local image ingestion, full-text search, live counts, catalogue ordering, safe reference deletion, and an external-curator analysis workflow with protected manual edits.

## Prerequisites

- Windows 10 or later
- Node.js 22 or later
- npm 10 or later

No Docker, XAMPP/WAMP, external database server, cloud service, or AI API key is required.

## Start the backend on Windows

From PowerShell in the repository root:

```powershell
npm install
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
GET    /api/v1/references
GET    /api/v1/references/:id
PATCH  /api/v1/references/:id
DELETE /api/v1/references/:id
```

The list endpoint accepts `q`, `designType`, `collection`, `status`, `page`, `limit`, `sort`, and `includeCatalogueIndex` query parameters. Originals are preserved beneath `storage/originals`; generated WebP thumbnails are written beneath `storage/thumbnails`.

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
