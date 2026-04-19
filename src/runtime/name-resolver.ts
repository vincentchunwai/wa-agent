import { searchChats, searchContacts } from '@ibrahimwithi/wu-cli';
import type { ChatRow, ContactRow } from '@ibrahimwithi/wu-cli';
import type { AgentConfig } from '../agent/types.js';
import { createChildLogger } from '../util/logger.js';

const logger = createChildLogger('name-resolver');

export interface ResolutionResult {
  resolved: number;
  unresolved: string[];
}

function isJid(value: string): boolean {
  return value.includes('@');
}

function resolveGroupName(name: string): string | null {
  const results = searchChats(name);
  const groups = results.filter((c: ChatRow) => c.type === 'group');

  if (groups.length === 0) return null;

  // Prefer exact name match (case-insensitive)
  const exact = groups.find((c: ChatRow) => c.name?.toLowerCase() === name.toLowerCase());
  if (exact) return exact.jid;

  // Fall back to most recently active
  const sorted = [...groups].sort((a, b) => (b.last_message_at ?? 0) - (a.last_message_at ?? 0));
  if (sorted.length > 1) {
    logger.warn({ name, matches: sorted.length }, 'Ambiguous group name, using most recent');
  }
  return sorted[0].jid;
}

function resolveContactName(name: string): string | null {
  const results = searchContacts(name);

  if (results.length === 0) return null;

  // Prefer exact saved_name match
  const exactSaved = results.find((c: ContactRow) => c.saved_name?.toLowerCase() === name.toLowerCase());
  if (exactSaved) return exactSaved.jid;

  // Then exact push_name match
  const exactPush = results.find((c: ContactRow) => c.push_name?.toLowerCase() === name.toLowerCase());
  if (exactPush) return exactPush.jid;

  // Fall back to first result
  if (results.length > 1) {
    logger.warn({ name, matches: results.length }, 'Ambiguous contact name, using best match');
  }
  return results[0].jid;
}

export function resolveRoutingNames(configs: AgentConfig[]): ResolutionResult {
  let resolved = 0;
  const unresolved: string[] = [];

  for (const config of configs) {
    // Resolve routing rules
    for (const rule of config.routing) {
      if (isJid(rule.match) || rule.type === 'keyword' || rule.type === 'default') continue;

      const name = rule.match;
      let jid: string | null = null;

      if (rule.type === 'group') {
        jid = resolveGroupName(name);
      } else if (rule.type === 'jid') {
        jid = resolveContactName(name);
      }

      if (jid) {
        rule.originalMatch = rule.originalMatch ?? rule.match;
        rule.match = jid;
        resolved++;
        logger.info({ name, jid, agent: config.name }, 'Resolved routing name');
      } else {
        // On retry, use originalMatch for re-resolution
        unresolved.push(rule.originalMatch ?? name);
        logger.error({ name, agent: config.name }, 'Could not resolve routing name');
      }
    }

    // Resolve handoff.escalateTo
    if (config.handoff?.escalateTo && !isJid(config.handoff.escalateTo) && config.handoff.escalateTo !== 'self') {
      const name = config.handoff.escalateTo;
      // Try group first, then contact
      const jid = resolveGroupName(name) ?? resolveContactName(name);
      if (jid) {
        (config.handoff as any)._originalEscalateTo = (config.handoff as any)._originalEscalateTo ?? config.handoff.escalateTo;
        config.handoff.escalateTo = jid;
        resolved++;
        logger.info({ name, jid, agent: config.name }, 'Resolved handoff escalateTo');
      } else {
        unresolved.push(name);
        logger.error({ name, agent: config.name }, 'Could not resolve handoff escalateTo');
      }
    }

    // Resolve trigger targets
    if (config.triggers) {
      for (const trigger of config.triggers) {
        if (isJid(trigger.target)) continue;

        const name = trigger.target;
        const jid = resolveGroupName(name) ?? resolveContactName(name);
        if (jid) {
          trigger.target = jid;
          resolved++;
          logger.info({ name, jid, agent: config.name }, 'Resolved trigger target');
        } else {
          unresolved.push(name);
          logger.error({ name, agent: config.name }, 'Could not resolve trigger target');
        }
      }
    }
  }

  logger.info({ resolved, unresolved: unresolved.length }, 'Name resolution complete');
  return { resolved, unresolved };
}
