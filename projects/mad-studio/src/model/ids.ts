const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/** Short random id, e.g. "ch_k3v9x0q2". Unique enough for project-local objects. */
export function makeId(prefix: string): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return `${prefix}_${out}`;
}
