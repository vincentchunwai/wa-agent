import type { RefCountMap } from '../agent/types.js';
import { createChildLogger } from '../util/logger.js';

const logger = createChildLogger('chat-queue');

export class ChatQueue {
  private queues = new Map<string, Promise<void>>();

  enqueue(chatJid: string, fn: () => Promise<void>): void {
    const prev = this.queues.get(chatJid) ?? Promise.resolve();
    const next = prev.then(fn, fn).catch((err) => {
      logger.error({ err, chatJid }, 'Unhandled error in chat queue task');
    });
    this.queues.set(chatJid, next);
    next.finally(() => {
      if (this.queues.get(chatJid) === next) {
        this.queues.delete(chatJid);
      }
    });
  }

  async drainForAgent(activeChats: RefCountMap): Promise<void> {
    const pending = activeChats.activeKeys()
      .map(jid => this.queues.get(jid))
      .filter((p): p is Promise<void> => p !== undefined);
    await Promise.allSettled(pending);
  }

  async drainAll(): Promise<void> {
    await Promise.allSettled([...this.queues.values()]);
  }
}
