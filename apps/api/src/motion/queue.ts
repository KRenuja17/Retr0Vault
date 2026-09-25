import type { FastifyBaseLogger } from "fastify";

import type { DatabaseConnection } from "../database/connection.js";
import {
  completeClip,
  failClip,
  markClipProcessing,
  queueEntry,
  recoverQueue,
} from "../services/motion.js";
import type { MotionStorage } from "../storage/motion-storage.js";
import { killRunningTools, ToolError, UnsupportedMediaError, type MotionTools } from "./ffmpeg.js";
import { processClip, type ProcessClipInput, type ProcessedClip } from "./pipeline.js";

/*
 * One clip at a time, in the API process. Upload returns as soon as the file is
 * on disk; this queue turns it into playable media and evidence. A clip left
 * `processing` by a crash or shutdown goes back to `queued` on the next start.
 */

export type ClipProcessor = (input: ProcessClipInput) => Promise<ProcessedClip>;

export interface MotionQueueOptions {
  readonly connection: DatabaseConnection;
  readonly storage: MotionStorage;
  readonly tools: MotionTools | undefined;
  readonly timeoutMs: number;
  readonly logger: FastifyBaseLogger;
  /** Replaceable for tests. */
  readonly processor?: ClipProcessor;
}

function safeMessage(error: unknown): string {
  if (error instanceof UnsupportedMediaError) return error.message;
  if (error instanceof ToolError) {
    return error.kind === "timeout" ? "Processing timed out; try a shorter or smaller recording" :
      error.kind === "aborted" ? "Processing was interrupted; retry the clip" : "The recording could not be processed";
  }
  if (error instanceof Error && error.message === "Media processing timed out") return "Processing timed out; try a shorter or smaller recording";
  return "The recording could not be processed";
}

export class MotionQueue {
  readonly #options: MotionQueueOptions;
  readonly #processor: ClipProcessor;
  readonly #pending: string[] = [];
  readonly #controller = new AbortController();
  #running: Promise<void> | undefined;
  #closed = false;
  #retry: NodeJS.Timeout | undefined;
  #idleWaiters: Array<() => void> = [];

  public constructor(options: MotionQueueOptions) {
    this.#options = options;
    this.#processor = options.processor ?? processClip;
  }

  public get available(): boolean {
    return this.#options.tools !== undefined || this.#options.processor !== undefined;
  }

  /**
   * Requeues interrupted work and starts processing. Never blocks startup: if the
   * database is busy (another process holds the write lock) it retries shortly.
   */
  public start(): void {
    if (this.#closed) return;
    try {
      for (const clipId of recoverQueue(this.#options.connection)) this.enqueue(clipId);
    } catch (error) {
      this.#options.logger.warn({ err: error }, "Motion queue recovery deferred; retrying");
      this.#retry = setTimeout(() => this.start(), 2_000);
      this.#retry.unref();
    }
  }

  public enqueue(clipId: string): void {
    if (this.#closed || this.#pending.includes(clipId)) return;
    this.#pending.push(clipId);
    this.#running ??= this.#drain().finally(() => {
      this.#running = undefined;
      for (const resolve of this.#idleWaiters.splice(0)) resolve();
    });
  }

  /** Resolves when nothing is queued or running (used by tests and shutdown). */
  public async idle(): Promise<void> {
    if (this.#running === undefined) return;
    await new Promise<void>((resolve) => this.#idleWaiters.push(resolve));
  }

  public async close(): Promise<void> {
    this.#closed = true;
    clearTimeout(this.#retry);
    this.#pending.splice(0);
    this.#controller.abort();
    killRunningTools();
    await this.#running?.catch(() => undefined);
  }

  async #drain(): Promise<void> {
    while (!this.#closed) {
      const clipId = this.#pending.shift();
      if (clipId === undefined) return;
      await this.#process(clipId);
    }
  }

  async #process(clipId: string): Promise<void> {
    const { connection, storage, logger } = this.#options;
    const entry = queueEntry(connection, clipId);
    if (entry === undefined || !markClipProcessing(connection, clipId)) return;
    const tools = this.#options.tools;
    if (tools === undefined && this.#options.processor === undefined) {
      failClip(connection, clipId, "ffmpeg/ffprobe are unavailable; install them and retry the clip");
      return;
    }
    try {
      const result = await this.#processor({
        tools: tools ?? { ffmpeg: "", ffprobe: "" },
        storage,
        referenceId: entry.referenceId,
        clipId,
        label: entry.label,
        posterMs: entry.posterMs,
        timeoutMs: this.#options.timeoutMs,
        signal: this.#controller.signal,
      });
      if (this.#closed) return;
      const stored = completeClip(connection, clipId, result);
      if (stored) {
        await storage.removeFile(entry.referenceId, clipId, "source.bin").catch(() => undefined);
      } else {
        // The clip was deleted while it was being processed.
        await storage.removeClip(entry.referenceId, clipId);
      }
    } catch (error) {
      if (this.#closed) return; // Left `processing`; recovered as queued on the next start.
      logger.warn({ err: error, clipId }, "Motion clip processing failed");
      await storage.clearGenerated(entry.referenceId, clipId).catch(() => undefined);
      try {
        failClip(connection, clipId, safeMessage(error));
      } catch {
        // The clip may have been deleted meanwhile; nothing left to record.
      }
    }
  }
}

declare module "fastify" {
  interface FastifyInstance {
    /** The motion processing queue; exposed so tests and tooling can await idle. */
    motionQueue: MotionQueue;
  }
}
