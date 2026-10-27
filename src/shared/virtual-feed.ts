import type { BrowseItem } from './browse-data';

export interface FeedRow { id: string; items: readonly BrowseItem[]; shorts: boolean }
export function appendFeedSkeletons(items: readonly BrowseItem[], columns: number, loading: boolean): readonly BrowseItem[] {
  if (!loading) return items;
  const normalCount = items.filter(item => !item.id.startsWith('short:')).length;
  const count = columns * 2 + (columns - normalCount % columns) % columns;
  return [...items, ...Array.from({ length: count }, (_, index) => ({
    id: `skeleton:${items.length + index}`, title: '', channel: '', href: '', thumbnail: ''
  }))];
}
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
// Measurements belong to the row's contents and layout, not its array index.
// Keep a few recent feeds for back navigation; discarded rows cannot accumulate.
export function createRowHeightCache() {
  type Measurement = { signature: string; height: number };
  const contexts = new Map<string, Map<string, Measurement>>();
  const signatures = new WeakMap<FeedRow, string>();
  let current = new Map<string, Measurement>();
  let currentContext = '', currentRows: readonly FeedRow[] | undefined;
  function signature(row: FeedRow) {
    let value = signatures.get(row);
    if (value === undefined) {
      value = JSON.stringify([row.shorts, row.items.map(item => [item.id, item.title, item.channel,
        !!item.channelAvatar, item.channelBadge, item.isPlaylist, item.viewCount, item.publishedTime])]);
      signatures.set(row, value);
    }
    return value;
  }
  return {
    signature,
    use(context: string, rows: readonly FeedRow[]) {
      if (context === currentContext && rows === currentRows) return;
      currentContext = context; currentRows = rows;
      current = contexts.get(context) || new Map();
      contexts.delete(context); contexts.set(context, current);
      if (contexts.size > 4) contexts.delete(contexts.keys().next().value!);
      const valid = new Map(rows.map(row => [row.id, signature(row)]));
      for (const [id, value] of current) if (valid.get(id) !== value.signature) current.delete(id);
    },
    read(row: FeedRow) {
      const value = current.get(row.id);
      return value?.signature === signature(row) ? value.height : undefined;
    },
    measure(row: FeedRow, height: number) {
      if (!Number.isFinite(height) || height <= 0) return false;
      const previous = current.get(row.id), key = signature(row);
      if (previous?.signature === key && Math.abs(previous.height - height) <= .5) return false;
      current.delete(row.id); current.set(row.id, { signature: key, height });
      if (current.size > 5000) current.delete(current.keys().next().value!);
      return true;
    },
    clear() { contexts.clear(); current.clear(); currentRows = undefined; currentContext = ''; }
  };
}
export function rowGeometry(rows: readonly FeedRow[], normalHeight: number, shortsHeight: number, gap: number,
  measuredHeight?: (row: FeedRow) => number | undefined) {
  let total = 0;
  const heights = rows.map(row => measuredHeight?.(row) ?? (row.shorts ? shortsHeight : normalHeight));
  const offsets = heights.map(height => {
    const offset = total; total += height + gap; return offset;
  });
  return { offsets, heights, total: Math.max(0, total - (rows.length ? gap : 0)) };
}
export function rowAtOffset(offsets: readonly number[], top: number) {
  let low = 0, high = offsets.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (offsets[mid] <= top) low = mid + 1; else high = mid;
  }
  return Math.max(0, low - 1);
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
