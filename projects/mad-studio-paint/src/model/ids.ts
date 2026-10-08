let counter = 0;

/** Short, unique-enough ids for layers and documents. */
export function uid(prefix = 'l'): string {
  counter = (counter + 1) % 0x10000;
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
