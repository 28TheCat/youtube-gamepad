import type { TimelineSnapshot } from '../../types/ports';

/** Shared by immediate seeks and held-button previews. */
export let YTGamepadSeeking = {
  step(distance: number, initial = 10) {
    return distance <= 30 ? initial : Math.max(initial, distance <= 60 ? 15 : distance <= 300 ? 30 : 60);
  },
  target(timeline: TimelineSnapshot, seconds: number): number | null {
    const { start, end, canSeek, ranges } = timeline;
    if (!canSeek || !Number.isFinite(seconds) || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
    const value = Math.min(end, Math.max(start, seconds));
    if (!ranges.length) return value;
    const valid = ranges.filter(range => Number.isFinite(range.start) && Number.isFinite(range.end) && range.end > range.start)
      .map(range => ({ start: Math.max(start, range.start), end: Math.min(end, range.end) }))
      .filter(range => range.end > range.start);
    if (!valid.length) return null;
    if (valid.some(range => value >= range.start && value <= range.end)) return value;
    return valid.flatMap(range => [range.start, range.end]).reduce((best, edge) => Math.abs(edge - value) < Math.abs(best - value) ? edge : best);
  }
};
