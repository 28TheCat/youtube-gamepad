import type { BrowseItem } from './browse-data';

export interface FeedRow { id: string; items: readonly BrowseItem[]; shorts: boolean }
export function feedRows(items: readonly BrowseItem[], columns: number): FeedRow[] {
  columns = Math.max(1, Math.floor(columns));
  const rows: FeedRow[] = [], shorts = items.filter(item => item.id.startsWith('short:'));
  let pending: BrowseItem[] = [], addedShorts = false, shortsPending = false;
  const flush = () => {
    if (pending.length) rows.push({ id: pending[0].id, items: pending, shorts: false });
    pending = [];
  };
  const addShorts = () => {
    rows.push({ id: 'shorts-shelf', items: shorts, shorts: true });
    addedShorts = true; shortsPending = false;
  };
  for (const item of items) {
    if (item.id.startsWith('short:')) {
      if (!addedShorts) {
        if (pending.length) shortsPending = true;
        else addShorts();
      }
    } else {
      pending.push(item);
      if (pending.length === columns) { flush(); if (shortsPending) addShorts(); }
    }
  }
  flush(); if (shortsPending) addShorts(); return rows;
}
export function rowGeometry(rows: readonly FeedRow[], normalHeight: number, shortsHeight: number, gap: number) {
  let total = 0;
  const offsets = rows.map(row => {
    const offset = total; total += (row.shorts ? shortsHeight : normalHeight) + gap; return offset;
  });
  return { offsets, total: Math.max(0, total - (rows.length ? gap : 0)) };
}
export function windowIndexes(offsets: readonly number[], top: number, height: number, pinned = -1): number[] {
  if (!offsets.length) return [];
  const start = Math.max(0, top - height), end = top + height * 2;
  let low = 0, high = offsets.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (offsets[mid] < start) low = mid + 1; else high = mid;
  }
  const indexes = new Set<number>();
  for (let i = Math.max(0, low - 1); i < offsets.length && offsets[i] <= end; i++) indexes.add(i);
  if (pinned >= 0 && pinned < offsets.length) indexes.add(pinned);
  return [...indexes].sort((a, b) => a - b);
}
export function indexFeedRows(rows: readonly FeedRow[]) {
  const positions = new Map<string, { row: number; column: number }>();
  rows.forEach((row, rowIndex) => row.items.forEach((item, column) => positions.set(item.id, { row: rowIndex, column })));
  return {
    position: (id: string) => positions.get(id),
    adjacent(id: string, direction: string, preferredColumn?: number): string | undefined {
      const position = positions.get(id);
      if (!position) return;
      const row = rows[position.row], column = position.column;
      if (direction === 'left' || direction === 'right') {
        const next = column + (direction === 'left' ? -1 : 1);
        return row.items[row.shorts ? (next + row.items.length) % row.items.length : next]?.id;
      }
      if (direction !== 'up' && direction !== 'down') return;
      const next = rows[position.row + (direction === 'up' ? -1 : 1)];
      return next?.items[Math.min(preferredColumn ?? column, next.items.length - 1)]?.id;
    }
  };
}
export function adjacentFeedItem(rows: readonly FeedRow[], id: string, direction: string): string | undefined {
  return indexFeedRows(rows).adjacent(id, direction);
}
