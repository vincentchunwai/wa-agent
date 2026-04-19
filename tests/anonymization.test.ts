import { describe, it, expect, beforeEach } from 'vitest';
import { PiiType } from '../src/anonymization/types.js';
import { detectPii } from '../src/anonymization/detector.js';
import { generateFake } from '../src/anonymization/faker.js';
import { PiiMap, clearAllPiiMaps } from '../src/anonymization/pii-map.js';
import { anonymizeMessages, deanonymizeText } from '../src/anonymization/anonymizer.js';
import type { ModelMessage } from 'ai';

beforeEach(() => {
  clearAllPiiMaps();
});

// ---------------------------------------------------------------------------
// detector
// ---------------------------------------------------------------------------
describe('detectPii', () => {
  it('detects emails', () => {
    const matches = detectPii('Contact john.doe@example.com for info');
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ type: PiiType.Email, value: 'john.doe@example.com' });
  });

  it('detects phone numbers', () => {
    const matches = detectPii('Call me at +1-555-123-4567');
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ type: PiiType.Phone, value: '+1-555-123-4567' });
  });

  it('detects credit card numbers', () => {
    const matches = detectPii('My card is 4111-1111-1111-1111');
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ type: PiiType.CreditCard, value: '4111-1111-1111-1111' });
  });

  it('detects SSNs', () => {
    const matches = detectPii('SSN: 123-45-6789');
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ type: PiiType.SSN, value: '123-45-6789' });
  });

  it('detects IP addresses', () => {
    const matches = detectPii('Server at 192.168.1.1 is down');
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ type: PiiType.IpAddress, value: '192.168.1.1' });
  });

  it('detects multiple PII types in one string', () => {
    const text = 'Email me at alice@test.org, my IP is 10.20.30.40';
    const matches = detectPii(text);
    expect(matches.length).toBeGreaterThanOrEqual(2);
    const types = matches.map(m => m.type);
    expect(types).toContain(PiiType.Email);
    expect(types).toContain(PiiType.IpAddress);
  });

  it('returns empty array for clean text', () => {
    expect(detectPii('Hello, how are you?')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// faker
// ---------------------------------------------------------------------------
describe('generateFake', () => {
  it('generates email fakes', () => {
    expect(generateFake(PiiType.Email, 1)).toBe('user_1@example.com');
    expect(generateFake(PiiType.Email, 42)).toBe('user_42@example.com');
  });

  it('generates phone fakes with zero-padded seq', () => {
    expect(generateFake(PiiType.Phone, 1)).toBe('+1-555-000-0001');
  });

  it('generates credit card fakes', () => {
    expect(generateFake(PiiType.CreditCard, 3)).toBe('****-****-****-0003');
  });

  it('generates SSN fakes', () => {
    expect(generateFake(PiiType.SSN, 7)).toBe('***-**-0007');
  });

  it('generates IP fakes', () => {
    expect(generateFake(PiiType.IpAddress, 1)).toBe('10.0.0.1');
    expect(generateFake(PiiType.IpAddress, 256)).toBe('10.0.1.1');
  });
});

// ---------------------------------------------------------------------------
// PiiMap
// ---------------------------------------------------------------------------
describe('PiiMap', () => {
  it('returns consistent fake for same real value', () => {
    const map = new PiiMap();
    const fake1 = map.getOrCreateFake('alice@real.com', PiiType.Email);
    const fake2 = map.getOrCreateFake('alice@real.com', PiiType.Email);
    expect(fake1).toBe(fake2);
  });

  it('returns different fakes for different real values', () => {
    const map = new PiiMap();
    const f1 = map.getOrCreateFake('a@b.com', PiiType.Email);
    const f2 = map.getOrCreateFake('c@d.com', PiiType.Email);
    expect(f1).not.toBe(f2);
  });

  it('reverse-lookups fake → real', () => {
    const map = new PiiMap();
    const fake = map.getOrCreateFake('secret@mail.com', PiiType.Email);
    expect(map.getReal(fake)).toBe('secret@mail.com');
  });

  it('returns undefined for unknown fake', () => {
    const map = new PiiMap();
    expect(map.getReal('nonexistent')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// anonymizer (end-to-end)
// ---------------------------------------------------------------------------
describe('anonymizeMessages / deanonymizeText', () => {
  const chatJid = 'test-chat@s.whatsapp.net';

  it('replaces PII in message content with fakes', () => {
    const messages: ModelMessage[] = [
      { role: 'user', content: 'My email is bob@corp.com and IP is 172.16.0.5' },
    ];
    const anon = anonymizeMessages(messages, chatJid);
    expect(anon[0].content).not.toContain('bob@corp.com');
    expect(anon[0].content).not.toContain('172.16.0.5');
    expect(anon[0].content).toContain('@example.com');
    expect(anon[0].content).toContain('10.0.');
  });

  it('does not mutate original messages', () => {
    const messages: ModelMessage[] = [
      { role: 'user', content: 'Email: x@y.com' },
    ];
    const original = messages[0].content;
    anonymizeMessages(messages, chatJid);
    expect(messages[0].content).toBe(original);
  });

  it('passes through messages with no PII unchanged', () => {
    const messages: ModelMessage[] = [
      { role: 'system', content: 'You are helpful.' },
    ];
    const anon = anonymizeMessages(messages, chatJid);
    expect(anon[0]).toBe(messages[0]); // same reference
  });

  it('deanonymizes text back to real values', () => {
    const messages: ModelMessage[] = [
      { role: 'user', content: 'Contact me at alice@test.org' },
    ];
    const anon = anonymizeMessages(messages, chatJid);
    // Simulate LLM echoing the fake email
    const fakeEmail = (anon[0].content as string).match(/\S+@example\.com/)![0];
    const llmResponse = `Sure, I'll email ${fakeEmail} right away.`;
    const restored = deanonymizeText(llmResponse, chatJid);
    expect(restored).toContain('alice@test.org');
    expect(restored).not.toContain('@example.com');
  });

  it('handles multiple PII values across multiple messages', () => {
    const messages: ModelMessage[] = [
      { role: 'user', content: 'My email is a@b.com' },
      { role: 'assistant', content: 'Got it.' },
      { role: 'user', content: 'Also cc 4111-1111-1111-1111' },
    ];
    const anon = anonymizeMessages(messages, chatJid);
    expect(anon[0].content).toContain('@example.com');
    expect(anon[1].content).toBe('Got it.');
    expect(anon[2].content).toContain('****-****-****-');
  });

  it('is consistent across calls for the same chatJid', () => {
    const m1: ModelMessage[] = [{ role: 'user', content: 'Email: z@z.com' }];
    const m2: ModelMessage[] = [{ role: 'user', content: 'Again z@z.com' }];
    const a1 = anonymizeMessages(m1, chatJid);
    const a2 = anonymizeMessages(m2, chatJid);
    // Same fake for same real value
    const fake1 = (a1[0].content as string).match(/\S+@example\.com/)![0];
    const fake2 = (a2[0].content as string).match(/\S+@example\.com/)![0];
    expect(fake1).toBe(fake2);
  });

  it('isolates PII maps between different chatJids', () => {
    const jid1 = 'chat1@s.whatsapp.net';
    const jid2 = 'chat2@s.whatsapp.net';
    const msgs: ModelMessage[] = [{ role: 'user', content: 'Email: same@addr.com' }];
    anonymizeMessages(msgs, jid1);
    anonymizeMessages(msgs, jid2);
    // De-anonymizing in jid1 context should not affect jid2
    const text = deanonymizeText('user_1@example.com', jid1);
    expect(text).toBe('same@addr.com');
  });
});
