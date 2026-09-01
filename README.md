# Retr0Vault

Retr0Vault is a local-first visual inspiration and design-vocabulary archive. The current backend supports design-type and collection management plus local image ingestion, metadata, tags, filtering, and safe reference deletion.

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

The list endpoint accepts `designType`, `collection`, `status`, `page`, `limit`, and `sort` query parameters. Originals are preserved beneath `storage/originals`; generated WebP thumbnails are written beneath `storage/thumbnails`.

## Workspace layout

```text
apps/
  api/       Fastify backend
  web/       Empty frontend workspace placeholder
packages/
  shared/    Shared Zod schemas and inferred TypeScript types
data/        Local SQLite and analysis runtime data (ignored)
storage/     Local reference files (ignored)
docs/        Project documentation added by later phases
```

Frontend implementation intentionally begins only after backend phases B1-B8 are complete.
