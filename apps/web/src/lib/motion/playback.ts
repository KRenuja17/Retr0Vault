/*
 * Motion plates play on hover or focus, and never more than two at once: a grid
 * of decoding videos would cost more than it shows. Starting a third plate
 * pauses the one that started first.
 */

export const MAX_PLAYING = 2;

export interface Playable {
  pause(): void;
}

export class PlaybackCoordinator {
  readonly #playing: Playable[] = [];
  readonly #limit: number;

  public constructor(limit = MAX_PLAYING) {
    this.#limit = limit;
  }

  /** Registers `player` as playing, pausing the oldest players beyond the limit. */
  public start(player: Playable): void {
    this.stop(player);
    this.#playing.push(player);
    while (this.#playing.length > this.#limit) {
      this.#playing.shift()?.pause();
    }
  }

  public stop(player: Playable): void {
    const index = this.#playing.indexOf(player);
    if (index >= 0) this.#playing.splice(index, 1);
  }

  public get playing(): readonly Playable[] {
    return this.#playing;
  }
}

/** The one coordinator shared by every plate on the page. */
export const playback = new PlaybackCoordinator();

/**
 * `play()` returns a promise in browsers, rejects when autoplay is refused and
 * is missing in test environments; none of those are errors worth surfacing.
 */
export function safePlay(video: HTMLVideoElement): void {
  try {
    const result = video.play() as Promise<void> | undefined;
    if (result !== undefined && typeof result.catch === "function") result.catch(() => undefined);
  } catch {
    // Not implemented (jsdom) or refused; the poster stays in place.
  }
}
