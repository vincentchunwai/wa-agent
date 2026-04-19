import type { ParsedMessage } from '@ibrahimwithi/wu-cli';
import type { MiddlewareFn } from './pipeline.js';
import type { AgentConfig } from '../agent/types.js';
import { getHandoffState, getHandedOffChats, setHandoffState } from '../memory/store.js';
import { createChildLogger } from '../util/logger.js';

const logger = createChildLogger('handoff-check');

const DEFAULT_RESOLVE_KEYWORDS = ['/done', '/resolve'];

function isResolveKeyword(body: string, config: AgentConfig): boolean {
  const keywords = config.handoff?.resolveKeywords ?? DEFAULT_RESOLVE_KEYWORDS;
  const normalized = body.trim().toLowerCase();
  return keywords.some(kw => normalized === kw.toLowerCase());
}

/** Skip messages from chats that have been handed off to a human.
 *  Resolve keywords (/done, /resolve) clear the handoff state. */
export function createHandoffCheckMiddleware(getAgentConfigs: () => AgentConfig[]): MiddlewareFn {
  return (msg: ParsedMessage): boolean => {
    const configs = getAgentConfigs();
    const body = msg.body ?? '';

    for (const config of configs) {
      // Case 1: This chat is handed off — check for in-chat resolve keyword
      if (getHandoffState(config.name, msg.chatJid)) {
        if (body && isResolveKeyword(body, config)) {
          setHandoffState(config.name, msg.chatJid, false);
          logger.info(
            { agent: config.name, chatJid: msg.chatJid, sender: msg.senderJid },
            'Handoff resolved via keyword (in-chat)',
          );
          return false; // consume the command
        }
        // Handed off but no keyword — block as before
        return false;
      }

      // Case 2: Remote resolve — operator sends keyword from their own DM with the bot
      const escalateTo = config.handoff?.escalateTo;
      if (
        escalateTo &&
        body &&
        isResolveKeyword(body, config) &&
        (msg.chatJid === escalateTo || msg.senderJid === escalateTo)
      ) {
        const handedOffChats = getHandedOffChats(config.name);
        if (handedOffChats.length > 0) {
          for (const chatJid of handedOffChats) {
            setHandoffState(config.name, chatJid, false);
          }
          logger.info(
            { agent: config.name, chats: handedOffChats, operator: msg.senderJid },
            'Handoff resolved via keyword (remote)',
          );
          return false; // consume the command
        }
      }
    }

    return true;
  };
}
