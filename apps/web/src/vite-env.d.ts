/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Overrides the default same-origin `/api/v1` base path. */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
