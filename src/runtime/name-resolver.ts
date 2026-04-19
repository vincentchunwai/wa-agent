import { searchChats, searchContacts, AUTH_DIR } from '@ibrahimwithi/wu-cli';
import type { ChatRow, ContactRow } from '@ibrahimwithi/wu-cli';
import type { AgentConfig } from '../agent/types.js';
import { readFileSync } from 'fs';
import { join } from 'path';
import { createChildLogger } from '../util/logger.js';

const logger = createChildLogger('name-resolver');

export interface ResolutionResult {
  resolved: number;
  unresolved: string[];
}

function isJid(value: string): boolean {
  return value.includes('@');
}

function isPhoneJid(value: string): boolean {
  return value.endsWith('@s.whatsapp.net');
}

function isLidJid(value: string): boolean {
  return value.endsWith('@lid');
}

function isGroupJid(value: string): boolean {
  return value.endsWith('@g.us');
}

/** Detect bare phone number: digits only, optionally prefixed with + */
function isPhoneNumber(value: string): boolean {
  return /^\+?\d{7,20}$/.test(value);
}

/** Extract phone number from various formats */
function extractPhone(value: string): string | null {
  if (isPhoneJid(value)) {
    return value.replace('@s.whatsapp.net', '');
  }
  if (isPhoneNumber(value)) {
    return value.replace(/^\+/, '');
  }
  return null;
}

/** Look up the LID for a phone number via Baileys' auth mapping files */
function resolvePhoneToLid(phone: string): string | null {
  try {
    const mappingPath = join(AUTH_DIR, `lid-mapping-${phone}.json`);
    const lid = JSON.parse(readFileSync(mappingPath, 'utf-8'));
    if (typeof lid === 'string' && lid.length > 0) {
      return `${lid}@lid`;
    }
  } catch {
    // File doesn't exist or isn't valid JSON — no mapping available
  }
  return null;
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

/** Try to resolve a match value to a LID JID if it's a phone number or @s.whatsapp.net JID */
function tryResolvePhone(match: string): string | null {
  const phone = extractPhone(match);
  if (!phone) return null;

  const lid = resolvePhoneToLid(phone);
  if (lid) {
    logger.info({ phone, lid }, 'Resolved phone to LID');
  }
  return lid;
}

export function resolveRoutingNames(configs: AgentConfig[]): ResolutionResult {
  let resolved = 0;
  const unresolved: string[] = [];

  for (const config of configs) {
    // Resolve routing rules
    for (const rule of config.routing) {
      if (rule.type === 'keyword' || rule.type === 'default' || rule.type === 'mention') continue;

      // Already a @lid or @g.us JID — no resolution needed
      if (isLidJid(rule.match) || isGroupJid(rule.match)) continue;

      // Try phone-to-LID resolution first (@s.whatsapp.net JIDs or bare phone numbers)
      const phoneLid = tryResolvePhone(rule.match);
      if (phoneLid) {
        rule.originalMatch = rule.originalMatch ?? rule.match;
        rule.match = phoneLid;
        resolved++;
        logger.info({ original: rule.originalMatch, jid: phoneLid, agent: config.name }, 'Resolved routing phone');
        continue;
      }

      // Skip if it looks like a JID we don't handle (shouldn't happen, but safe)
      if (isJid(rule.match)) continue;

      // Fall through to name resolution
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
    if (config.handoff?.escalateTo && config.handoff.escalateTo !== 'self') {
      const target = config.handoff.escalateTo;
      if (!isLidJid(target) && !isGroupJid(target)) {
        // Try phone resolution
        const phoneLid = tryResolvePhone(target);
        if (phoneLid) {
          (config.handoff as any)._originalEscalateTo = (config.handoff as any)._originalEscalateTo ?? target;
          config.handoff.escalateTo = phoneLid;
          resolved++;
          logger.info({ original: target, jid: phoneLid, agent: config.name }, 'Resolved handoff phone');
        } else if (!isJid(target)) {
          // Name resolution
          const jid = resolveGroupName(target) ?? resolveContactName(target);
          if (jid) {
            (config.handoff as any)._originalEscalateTo = (config.handoff as any)._originalEscalateTo ?? target;
            config.handoff.escalateTo = jid;
            resolved++;
            logger.info({ name: target, jid, agent: config.name }, 'Resolved handoff escalateTo');
          } else {
            unresolved.push(target);
            logger.error({ name: target, agent: config.name }, 'Could not resolve handoff escalateTo');
          }
        }
      }
    }

    // Resolve trigger targets
    if (config.triggers) {
      for (const trigger of config.triggers) {
        if (isLidJid(trigger.target) || isGroupJid(trigger.target)) continue;

        // Try phone resolution
        const phoneLid = tryResolvePhone(trigger.target);
        if (phoneLid) {
          trigger.target = phoneLid;
          resolved++;
          logger.info({ original: trigger.target, jid: phoneLid, agent: config.name }, 'Resolved trigger phone');
          continue;
        }

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
