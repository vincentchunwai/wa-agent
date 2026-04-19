import { PiiType } from './types.js';

const generators: Record<PiiType, (seq: number) => string> = {
  [PiiType.Email]: (seq) => `user_${seq}@example.com`,
  [PiiType.Phone]: (seq) => `+1-555-000-${String(seq).padStart(4, '0')}`,
  [PiiType.CreditCard]: (seq) => `****-****-****-${String(seq).padStart(4, '0')}`,
  [PiiType.SSN]: (seq) => `***-**-${String(seq).padStart(4, '0')}`,
  [PiiType.IpAddress]: (seq) => {
    const octet = seq % 256;
    const group = Math.floor(seq / 256) % 256;
    return `10.0.${group}.${octet || 1}`;
  },
};

export function generateFake(type: PiiType, seq: number): string {
  return generators[type](seq);
}
