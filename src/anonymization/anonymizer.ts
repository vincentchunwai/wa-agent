import type { ModelMessage } from 'ai';
import { detectPii } from './detector.js';
import { getOrCreatePiiMap } from './pii-map.js';

/**
 * Replace PII in every message's text content with deterministic fakes.
 * Returns a new array (original is not mutated).
 */
export function anonymizeMessages(messages: ModelMessage[], chatJid: string): ModelMessage[] {
  const map = getOrCreatePiiMap(chatJid);

  return messages.map((msg) => {
    // Only process messages with string content
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
    return { ...msg, content: text };
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
