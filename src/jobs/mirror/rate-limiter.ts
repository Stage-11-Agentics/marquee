export interface MirrorClock {
  now(): number;
  sleep(milliseconds: number): Promise<void>;
}

export const MIRROR_REQUESTS_PER_SECOND = 4;
const MIRROR_REQUEST_INTERVAL_MS = 1_000 / MIRROR_REQUESTS_PER_SECOND;

/**
 * A conservative one-token bucket. A capacity of one gives an observable
 * 250ms spacing between requests, so the limit holds even under a sliding
 * one-second window (and leaves room for the inbound pull on Airtable's
 * shared Team throttle).
 */
export class MirrorTokenBucket {
  private tokens = 1;
  private lastRefillAt: number;

  constructor(
    private readonly clock: MirrorClock = {
      now: () => Date.now(),
      sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    },
    private readonly capacity = 1,
    private readonly refillPerSecond = MIRROR_REQUESTS_PER_SECOND,
  ) {
    this.lastRefillAt = clock.now();
  }

  async take(): Promise<void> {
    while (true) {
      const now = this.clock.now();
      const elapsed = Math.max(0, now - this.lastRefillAt);
      this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerSecond / 1_000);
      this.lastRefillAt = now;
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      const waitFor = Math.max(1, Math.ceil((1 - this.tokens) * 1_000 / this.refillPerSecond));
      await this.clock.sleep(waitFor);
    }
  }
}

export const MIRROR_MIN_REQUEST_INTERVAL_MS = MIRROR_REQUEST_INTERVAL_MS;
