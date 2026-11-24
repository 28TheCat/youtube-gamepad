export type DisplayDensity = 'standard' | 'tv';
export function normalizeDisplayDensity(value: unknown): DisplayDensity {
  return value === 'tv' ? 'tv' : 'standard';
}
export function applyDisplayDensity(value: unknown): void {
  document.documentElement.setAttribute('data-ytg-density', normalizeDisplayDensity(value));
}
