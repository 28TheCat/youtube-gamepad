// YouTube supplies RGB integers (and sometimes ARGB). Only normalized color
// literals cross the page bridge and reach inline CSS custom properties.
export function playlistColor(value: unknown): string | undefined {
  if (typeof value === 'string' && /^#[\da-f]{6}(?:[\da-f]{2})?$/i.test(value)) return value;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 0xffffffff) return;
  if (value <= 0xffffff) return `#${value.toString(16).padStart(6, '0')}`;
  const argb = value.toString(16).padStart(8, '0');
  return `#${argb.slice(2)}${argb.slice(0, 2)}`;
}
