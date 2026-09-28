/*
 * Slows down password guessing. Each account name and each client address has
 * a budget of failed sign-ins; once spent, sign-in is refused for a while,
 * twice as long after each further failure (up to fifteen minutes). A success
 * clears the account's record. Kept in memory: a restart forgives.
 */

const FREE_FAILURES = 5;
const WINDOW_MS = 15 * 60 * 1_000;
const FIRST_LOCK_MS = 30 * 1_000;
const LONGEST_LOCK_MS = 15 * 60 * 1_000;

interface Record {
  failures: number;
  firstAt: number;
  lockedUntil: number;
}

export class LoginThrottle {
  readonly #records = new Map<string, Record>();
  readonly #now: () => number;

  public constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  /** Seconds until sign-in may be tried again, or 0 when it may be tried now. */
  public retryAfter(keys: readonly string[]): number {
    const now = this.#now();
    const until = Math.max(0, ...keys.map((key) => this.#current(key, now)?.lockedUntil ?? 0));
    return until > now ? Math.ceil((until - now) / 1_000) : 0;
  }

  /** Records a failure; returns how many tries are left before a lock (0 when locked). */
  public fail(keys: readonly string[]): number {
    const now = this.#now();
    let left = FREE_FAILURES;
    for (const key of keys) {
      const record = this.#current(key, now) ?? { failures: 0, firstAt: now, lockedUntil: 0 };
      record.failures += 1;
      const over = record.failures - FREE_FAILURES;
      if (over >= 0) record.lockedUntil = now + Math.min(LONGEST_LOCK_MS, FIRST_LOCK_MS * 2 ** over);
      this.#records.set(key, record);
      left = Math.min(left, Math.max(0, FREE_FAILURES - record.failures));
    }
    return left;
  }

  public succeed(keys: readonly string[]): void {
    for (const key of keys) this.#records.delete(key);
  }

  #current(key: string, now: number): Record | undefined {
    const record = this.#records.get(key);
    if (record === undefined) return undefined;
    if (now - record.firstAt > WINDOW_MS && record.lockedUntil <= now) {
      this.#records.delete(key);
      return undefined;
    }
    return record;
  }
}
