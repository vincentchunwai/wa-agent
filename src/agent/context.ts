import { readFileSync, existsSync } from 'fs';
import type { ModelMessage, UserModelMessage } from 'ai';
import type { AgentConfig } from './types.js';
import type { ToolContext } from '../tools/types.js';
import { listMessages, type MessageRow } from '@ibrahimwithi/wu-cli';
import { getConversation } from '../memory/store.js';
import { getUserProfile } from '../memory/profiles.js';
import { createChildLogger } from '../util/logger.js';

const logger = createChildLogger('context');

/** Media types that support vision */
const IMAGE_TYPES = new Set(['image']);

/** Media types that support file content (PDF, docs) */
const FILE_TYPES = new Set(['document']);

/** Format sender prefix for group chats */
function senderPrefix(msg: MessageRow, chatJid: string): string {
  if (msg.is_from_me) return '';
  if (!chatJid.endsWith('@g.us')) return '';
  const sender = msg.sender_name ?? msg.sender_jid?.split('@')[0] ?? 'Unknown';
  return `[${sender}]: `;
}

/** Format a stored message for LLM context (text-only) */
function formatMessageText(msg: MessageRow, chatJid: string): string {
  const prefix = senderPrefix(msg, chatJid);
  const text = msg.body ?? `[${msg.type}]`;
  return prefix + text;
}

/** Check if a message has a readable image on disk */
function hasReadableImage(msg: MessageRow): boolean {
  return IMAGE_TYPES.has(msg.type) && !!msg.media_path && existsSync(msg.media_path);
}

/** Check if a message has a readable document/file on disk */
function hasReadableFile(msg: MessageRow): boolean {
  return FILE_TYPES.has(msg.type) && !!msg.media_path && existsSync(msg.media_path);
}

/** Build a multimodal UserContent array for a message with an image */
export function buildImageContent(
  msg: MessageRow,
  chatJid: string,
): Array<{ type: 'text'; text: string } | { type: 'image'; image: Buffer; mediaType?: string }> {
  const parts: Array<{ type: 'text'; text: string } | { type: 'image'; image: Buffer; mediaType?: string }> = [];

  // Add text part (caption or type label)
  const prefix = senderPrefix(msg, chatJid);
  const caption = msg.body || '';
  const textContent = prefix + (caption || `[${msg.type}]`);
  parts.push({ type: 'text', text: textContent });

  // Add image part
  try {
    const imageBuffer = readFileSync(msg.media_path!);
    const mediaType = msg.media_mime ?? undefined;
    parts.push({ type: 'image', image: imageBuffer, mediaType });
  } catch (err) {
    logger.warn({ err, msgId: msg.id, path: msg.media_path }, 'Failed to read image file');
  }

  return parts;
}

/** Build a multimodal UserContent array for a message with a document/file */
export function buildFileContent(
  msg: MessageRow,
  chatJid: string,
): Array<{ type: 'text'; text: string } | { type: 'file'; data: Buffer; mediaType: string; filename?: string }> {
  const parts: Array<{ type: 'text'; text: string } | { type: 'file'; data: Buffer; mediaType: string; filename?: string }> = [];

  // Add text part (caption or type label)
  const prefix = senderPrefix(msg, chatJid);
  const caption = msg.body || '';
  const textContent = prefix + (caption || `[${msg.type}]`);
  parts.push({ type: 'text', text: textContent });

  // Add file part
  try {
    const fileBuffer = readFileSync(msg.media_path!);
    const mediaType = msg.media_mime ?? 'application/octet-stream';

    // Try to extract filename from raw Baileys message
    let filename: string | undefined;
    if (msg.raw) {
      try {
        const raw = JSON.parse(msg.raw);
        filename = raw?.message?.documentMessage?.fileName
          ?? raw?.message?.documentWithCaptionMessage?.message?.documentMessage?.fileName;
      } catch { /* ignore parse errors */ }
    }

    parts.push({ type: 'file', data: fileBuffer, mediaType, ...(filename ? { filename } : {}) });
  } catch (err) {
    logger.warn({ err, msgId: msg.id, path: msg.media_path }, 'Failed to read file');
  }

  return parts;
}

/** Check if content is an array (multimodal) */
function isArrayContent(content: unknown): content is Array<unknown> {
  return Array.isArray(content);
}

export function buildContext(config: AgentConfig, ctx: ToolContext): ModelMessage[] {
  const parts: ModelMessage[] = [];

  // 1. Build ONE system message
  let system = config.personality;

  if (config.handoff?.conditions?.length) {
    if (config.handoff.silent) {
      system += `\n\nHand off the conversation when: ${config.handoff.conditions.join('; ')}`;
      system += `\nIMPORTANT: Never reveal that you are an AI, bot, or automated system. Respond as if you are a real person. If you cannot help, simply hand off without explaining why.`;
    } else {
      system += `\n\nEscalate to a human when: ${config.handoff.conditions.join('; ')}`;
    }
  }

  if (config.memory.userProfiles && ctx.senderJid) {
    const profile = getUserProfile(config.name, ctx.senderJid);
    if (profile?.facts) {
      system += `\n\nKnown facts about this user:\n${profile.facts}`;
    }
  }

  const convo = getConversation(config.name, ctx.chatJid);
  if (convo?.summary) {
    system += `\n\nPrevious conversation summary:\n${convo.summary}`;
  }

  parts.push({ role: 'system', content: system });

  // 2. Recent messages from wu-cli's messages table
  const afterTimestamp = convo?.summaryUpToTimestamp ?? undefined;
  const history = listMessages({
    chatJid: ctx.chatJid,
    limit: config.memory.conversationWindow,
    after: afterTimestamp,
  });

  // listMessages returns DESC order, reverse to oldest first
  for (const msg of history.reverse()) {
    const role = msg.is_from_me ? 'assistant' : 'user';

    // Only user messages can have images/files (assistant messages are always text)
    if (role === 'user' && hasReadableImage(msg)) {
      const imageContent = buildImageContent(msg, ctx.chatJid);
      parts.push({ role: 'user', content: imageContent } as UserModelMessage);
      continue;
    }

    if (role === 'user' && hasReadableFile(msg)) {
      const fileContent = buildFileContent(msg, ctx.chatJid);
      parts.push({ role: 'user', content: fileContent } as UserModelMessage);
      continue;
    }

    const content = formatMessageText(msg, ctx.chatJid);

    // Merge consecutive same-role messages to avoid provider rejections
    const last = parts[parts.length - 1];
    if (last && last.role === role && typeof last.content === 'string') {
      (last as { content: string }).content += '\n' + content;
    } else {
      parts.push({ role, content });
    }
  }

  return parts;
}
