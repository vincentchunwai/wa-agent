import { PiiType, type PiiMatch } from './types.js';

const patterns: { type: PiiType; regex: RegExp }[] = [
  // Email: standard addr
  { type: PiiType.Email, regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g },
  // Credit card: 13-19 digits with optional dashes/spaces (must start with 3-6)
  { type: PiiType.CreditCard, regex: /\b[3-6]\d{3}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{1,7}\b/g },
  // SSN: 3-2-4 digit pattern
  { type: PiiType.SSN, regex: /\b\d{3}-\d{2}-\d{4}\b/g },
  // Phone: international / US formats
  { type: PiiType.Phone, regex: /(?:\+\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{4}\b/g },
  // IPv4
  { type: PiiType.IpAddress, regex: /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g },
];

export function detectPii(text: string): PiiMatch[] {
  const matches: PiiMatch[] = [];
  for (const { type, regex } of patterns) {
    // Reset lastIndex for each call
    regex.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(text)) !== null) {
      // SSN pattern overlaps with phone — skip if already covered by a higher-priority match
      const overlap = matches.some(
        existing => m!.index >= existing.start && m!.index < existing.end,
      );
      if (!overlap) {
        matches.push({ type, value: m[0], start: m.index, end: m.index + m[0].length });
      }
    }
  }
  return matches.sort((a, b) => a.start - b.start);
}
