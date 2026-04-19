import type { ModelMessage } from 'ai';
import { detectPii } from './detector.js';
import { getOrCreatePiiMap } from './pii-map.js';

/**
 * Anonymize text parts within a multimodal content array.
 */
function anonymizeContentParts(
  parts: Array<{ type: string; text?: string; [key: string]: unknown }>,
  map: ReturnType<typeof getOrCreatePiiMap>,
): Array<{ type: string; text?: string; [key: string]: unknown }> {
  let changed = false;
  const result = parts.map((part) => {
    if (part.type !== 'text' || typeof part.text !== 'string') return part;

    let text = part.text;
    const matches = detectPii(text);
    for (let i = matches.length - 1; i >= 0; i--) {
      const m = matches[i];
      const fake = map.getOrCreateFake(m.value, m.type);
      text = text.slice(0, m.start) + fake + text.slice(m.end);
    }
    if (text === part.text) return part;
    changed = true;
    return { ...part, text };
  });
  return changed ? result : parts;
}

/**
 * Replace PII in every message's text content with deterministic fakes.
 * Handles both string content and multimodal content arrays.
 * Returns a new array (original is not mutated).
 */
export function anonymizeMessages(messages: ModelMessage[], chatJid: string): ModelMessage[] {
  const map = getOrCreatePiiMap(chatJid);

  return messages.map((msg) => {
    // Handle multimodal content arrays (e.g. user messages with images)
    if (Array.isArray(msg.content)) {
      const newContent = anonymizeContentParts(msg.content as any, map);
      if (newContent === msg.content) return msg;
      return { ...msg, content: newContent } as typeof msg;
    }

    // Handle string content
    if (typeof msg.content !== 'string') return msg;

    let text = msg.content;
    const matches = detectPii(text);

    // Replace in reverse order so indices stay valid
    for (let i = matches.length - 1; i >= 0; i--) {
      const m = matches[i];
      const fake = map.getOrCreateFake(m.value, m.type);
      text = text.slice(0, m.start) + fake + text.slice(m.end);
    }

    if (text === msg.content) return msg; // no changes
    return { ...msg, content: text } as typeof msg;
  });
}

/**
 * Replace any fake placeholders in `text` back with the real PII values.
 */
export function deanonymizeText(text: string, chatJid: string): string {
  const map = getOrCreatePiiMap(chatJid);
  let result = text;
  for (const [fake, real] of map.entries()) {
    result = result.replaceAll(fake, real);
  }
  return result;
}
