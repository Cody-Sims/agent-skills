export const counters = { hits: 9 };

export function reset() {
  counters.hits = 0;
  return { name: 'reset' };
}
