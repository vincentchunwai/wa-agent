import { createChildLogger } from '../util/logger.js';

const logger = createChildLogger('cooldown');

export class CooldownTracker {
  private lastResponseTime = new Map<string, number>();
  private static EVICT_INTERVAL = 10 * 60 * 1000; // 10 minutes
  private lastEvict = Date.now();

  private key(agentName: string, chatJid: string): string {
    return `${agentName}:${chatJid}`;
  }

  /** Check if a chat is in cooldown for a specific agent. Returns true if OK to proceed. */
  check(agentName: string, chatJid: string, cooldownMs: number): boolean {
    this.maybeEvict(cooldownMs);
    const now = Date.now();
    const k = this.key(agentName, chatJid);
    const lastTime = this.lastResponseTime.get(k);
    if (lastTime && now - lastTime < cooldownMs) {
      logger.debug({ agentName, chatJid, cooldownMs, elapsed: now - lastTime }, 'Cooldown active');
      return false;
    }
    return true;
  }

  /** Record that an agent responded to a chat */
  recordResponse(agentName: string, chatJid: string): void {
    this.lastResponseTime.set(this.key(agentName, chatJid), Date.now());
  }

  /** Evict entries older than the max cooldown to prevent unbounded growth */
  private maybeEvict(cooldownMs: number): void {
    const now = Date.now();
    if (now - this.lastEvict < CooldownTracker.EVICT_INTERVAL) return;
    this.lastEvict = now;

    // Evict anything older than 2x the cooldown (guaranteed stale)
    const threshold = now - cooldownMs * 2;
    for (const [key, time] of this.lastResponseTime) {
      if (time < threshold) {
        this.lastResponseTime.delete(key);
      }
    }
  }
}
