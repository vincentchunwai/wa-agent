import { createChildLogger } from '../util/logger.js';

const logger = createChildLogger('rate-limit');

export class RateLimiter {
  private timestamps = new Map<string, number[]>();
  private windowMs: number;
  private static EVICT_INTERVAL = 10 * 60 * 1000; // 10 minutes
  private lastEvict = Date.now();

  constructor(windowMs: number = 5 * 60 * 1000) {
    this.windowMs = windowMs;
  }

  private key(agentName: string, chatJid: string): string {
    return `${agentName}:${chatJid}`;
  }

  /** Check if a request is allowed for a specific agent. Returns true if under limit. */
  check(agentName: string, chatJid: string, maxPerWindow: number): boolean {
    this.maybeEvict();
    const now = Date.now();
    const k = this.key(agentName, chatJid);
    let times = this.timestamps.get(k);

    if (!times) {
      times = [];
      this.timestamps.set(k, times);
    }

    // Remove timestamps outside the window
    const cutoff = now - this.windowMs;
    while (times.length > 0 && times[0] <= cutoff) {
      times.shift();
    }

    if (times.length >= maxPerWindow) {
      logger.debug({ agentName, chatJid, maxPerWindow, current: times.length }, 'Rate limit hit');
      return false;
    }

    times.push(now);
    return true;
  }

  /** Evict empty or fully-expired entries to prevent unbounded growth */
  private maybeEvict(): void {
    const now = Date.now();
    if (now - this.lastEvict < RateLimiter.EVICT_INTERVAL) return;
    this.lastEvict = now;

    const cutoff = now - this.windowMs;
    for (const [key, times] of this.timestamps) {
      // Remove expired timestamps
      while (times.length > 0 && times[0] <= cutoff) {
        times.shift();
      }
      // Delete entry if no timestamps remain
      if (times.length === 0) {
        this.timestamps.delete(key);
      }
    }
  }
}
