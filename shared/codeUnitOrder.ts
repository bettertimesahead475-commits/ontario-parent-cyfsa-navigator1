/**
 * Comparator for deterministic string ordering by UTF-16 code unit: exactly the order of Array.prototype.sort()
 * with no compare function, made explicit. Used where a stable, locale-independent order matters (canonical
 * fingerprints, stable key order, timestamp-prefixed object names). String.localeCompare is deliberately NOT used
 * for these: its order depends on the runtime's locale data, which would change fingerprints between environments.
 */
export function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
