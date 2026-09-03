import { useCallback, useRef, useState } from "react";

import { ApiError } from "@/lib/api/client";
import { saveMarkdown, type DownloadedFile } from "@/lib/api/exports";

export type ExportStatus =
  | { readonly kind: "idle" }
  | { readonly kind: "working"; readonly label: string }
  | { readonly kind: "done"; readonly label: string; readonly filename: string }
  | { readonly kind: "failed"; readonly label: string; readonly message: string };

export interface MarkdownExport {
  readonly status: ExportStatus;
  readonly busy: boolean;
  /** Runs one export and hands the finished document to the browser. */
  readonly run: (
    label: string,
    request: () => Promise<DownloadedFile>,
  ) => Promise<void>;
  readonly reset: () => void;
}

function describe(error: unknown): string {
  if (error instanceof ApiError) {
    return error.isOffline
      ? "Retr0Vault could not reach the local API on 127.0.0.1:4611. Start it with npm run dev:api."
      : error.message;
  }
  return error instanceof Error ? error.message : "The export could not be generated.";
}

/**
 * One export at a time, with its outcome printed in the sheet rather than in a
 * toast. The backend owns the document; this only reports which one was asked
 * for, and what came back.
 */
export function useMarkdownExport(): MarkdownExport {
  const [status, setStatus] = useState<ExportStatus>({ kind: "idle" });
  const running = useRef(false);

  const run = useCallback(
    async (label: string, request: () => Promise<DownloadedFile>) => {
      if (running.current) {
        return;
      }
      running.current = true;
      setStatus({ kind: "working", label });
      try {
        const file = await request();
        saveMarkdown(file);
        setStatus({ kind: "done", label, filename: file.filename });
      } catch (error) {
        setStatus({ kind: "failed", label, message: describe(error) });
      } finally {
        running.current = false;
      }
    },
    [],
  );

  const reset = useCallback(() => setStatus({ kind: "idle" }), []);

  return { status, busy: status.kind === "working", run, reset };
}
