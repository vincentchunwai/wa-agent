import { type PiiType } from './types.js';
import { generateFake } from './faker.js';

export class PiiMap {
  private realToFake = new Map<string, string>();
  private fakeToReal = new Map<string, string>();
  private seq = 0;

  getOrCreateFake(realValue: string, type: PiiType): string {
    const existing = this.realToFake.get(realValue);
    if (existing) return existing;

    this.seq++;
    const fake = generateFake(type, this.seq);
    this.realToFake.set(realValue, fake);
    this.fakeToReal.set(fake, realValue);
    return fake;
  }

  getReal(fakeValue: string): string | undefined {
    return this.fakeToReal.get(fakeValue);
  }

  /** All fake→real entries for bulk de-anonymization */
  entries(): Iterable<[fake: string, real: string]> {
    return this.fakeToReal.entries();
  }
}

/** Module-level store keyed by chatJid */
const store = new Map<string, PiiMap>();

export function getOrCreatePiiMap(chatJid: string): PiiMap {
  let map = store.get(chatJid);
  if (!map) {
    map = new PiiMap();
    store.set(chatJid, map);
  }
  return map;
}

/** Exposed for testing */
export function clearAllPiiMaps(): void {
  store.clear();
}
