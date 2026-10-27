import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importSettingsModel } from './helpers/settings-model.mjs';
const { feedRows, rowGeometry, windowIndexes, adjacentFeedItem, indexFeedRows, createRowHeightCache, rowAtOffset, appendFeedSkeletons } = await importSettingsModel('src/shared/virtual-feed.ts');
const item = id => ({ id, title: id, href: '/watch?v=' + id, channel: '', thumbnail: '' });

test('loading skeletons fill complete rows and retain absolute identities as real items arrive', () => {
  const items = ['a', 'b', 'c', 'd', 'e'].map(item);
  const before = appendFeedSkeletons(items, 3, true);
  assert.equal(before.length % 3, 0);
  assert.equal(before[5].id, 'skeleton:5');
  const after = appendFeedSkeletons([...items, item('f')], 3, true);
  assert.equal(after[6].id, before[6].id, 'the remaining skeleton keeps its absolute slot');
  assert.equal(after[7].id, before[7].id);
  assert.strictEqual(appendFeedSkeletons(items, 3, false), items);
  assert.equal(appendFeedSkeletons([], 3, true).length, 6);
  const mixed = appendFeedSkeletons([...items, item('short:s')], 3, true);
  assert.equal(feedRows(mixed, 3).filter(row => !row.shorts).every(row => row.items.length === 3), true);
});

test('row measurements keep different heights through recycling and page appends', () => {
  const cache = createRowHeightCache();
  let rows = feedRows(['a', 'b', 'short:s', 'c', 'd', 'e'].map(item), 2);
  cache.use('home:wide', rows);
  rows.forEach((row, i) => cache.measure(row, [200, 480, 250, 220][i]));
  let geometry = rowGeometry(rows, 300, 480, 30, row => cache.read(row));
  assert.deepEqual(geometry.heights, [200, 480, 250, 220]);
  assert.deepEqual(geometry.offsets, [0, 230, 740, 1020]);
  // Completing the last row invalidates only that row, not previous pages.
  rows = feedRows(['a', 'b', 'short:s', 'c', 'd', 'e', 'f', 'g'].map(item), 2);
  cache.use('home:wide', rows);
  geometry = rowGeometry(rows, 300, 480, 30, row => cache.read(row));
  assert.deepEqual(geometry.heights, [200, 480, 250, 300, 300]);
  assert.deepEqual(geometry.offsets.slice(0, 4), [0, 230, 740, 1020]);
});

test('height caches isolate layouts and feeds, reuse recent contexts, and prune removed or changed rows', () => {
  const cache = createRowHeightCache(), rows = feedRows(['a', 'b', 'c'].map(item), 1);
  cache.use('home:wide', rows); cache.measure(rows[0], 200); cache.measure(rows[1], 250);
  cache.use('home:narrow', rows);
  assert.equal(cache.read(rows[0]), undefined);
  cache.measure(rows[0], 350);
  cache.use('subscriptions:wide', rows);
  assert.equal(cache.read(rows[0]), undefined);
  cache.use('home:wide', rows);
  assert.equal(cache.read(rows[0]), 200);
  const changed = feedRows([{ ...item('a'), title: 'A longer replacement title' }, item('c')], 1);
  cache.use('home:wide', changed);
  assert.equal(cache.read(changed[0]), undefined);
  cache.use('home:wide', rows);
  assert.equal(cache.read(rows[1]), undefined, 'removed measurements cannot reappear');
});

test('height changes move an anchor only when they precede it, with a subpixel tolerance', () => {
  const cache = createRowHeightCache(), rows = feedRows(['a', 'b', 'c', 'd'].map(item), 1);
  cache.use('home', rows);
  rows.forEach(row => cache.measure(row, 200));
  const geometry = () => rowGeometry(rows, 300, 480, 20, row => cache.read(row));
  const before = geometry(), anchor = rowAtOffset(before.offsets, 450);
  assert.equal(anchor, 2);
  cache.measure(rows[3], 400);
  assert.equal(geometry().offsets[anchor] - before.offsets[anchor], 0);
  cache.measure(rows[0], 250);
  assert.equal(geometry().offsets[anchor] - before.offsets[anchor], 50);
  assert.equal(cache.measure(rows[0], 250.2), false);
  for (const invalid of [0, -5, NaN, Infinity]) assert.equal(cache.measure(rows[0], invalid), false);
});

test('row caches bound retained feeds and clear their measurements on disposal', () => {
  const cache = createRowHeightCache(), rows = feedRows([item('a')], 1);
  for (let i = 0; i < 5; i++) { cache.use(`feed:${i}`, rows); cache.measure(rows[0], 200 + i); }
  cache.use('feed:0', rows);
  assert.equal(cache.read(rows[0]), undefined, 'the oldest of five contexts is evicted');
  cache.use('feed:4', rows);
  assert.equal(cache.read(rows[0]), 204);
  cache.clear(); cache.use('feed:4', rows);
  assert.equal(cache.read(rows[0]), undefined);
});

test('indexed navigation preserves the preferred column across short rows and rebuilds for new layouts', () => {
  const items = ['a', 'b', 'c', 'short:s1', 'd', 'e', 'f', 'g'].map(item);
  const navigation = indexFeedRows(feedRows(items, 3));
  assert.deepEqual(navigation.position('c'), { row: 0, column: 2 });
  assert.equal(navigation.adjacent('c', 'down', 2), 'short:s1');
  assert.equal(navigation.adjacent('short:s1', 'down', 2), 'f');
  assert.equal(navigation.adjacent('f', 'down', 2), 'g');
  assert.equal(navigation.adjacent('g', 'up', 2), 'f');
  assert.equal(navigation.adjacent('g', 'right'), undefined);
  assert.equal(navigation.adjacent('missing', 'down'), undefined);
  const resized = indexFeedRows(feedRows(items, 2));
  assert.deepEqual(resized.position('c'), { row: 1, column: 0 });
  assert.equal(resized.adjacent('c', 'down'), 'short:s1');
});

test('windowed rows preserve mixed feed order and logical neighbours at unmounted boundaries', () => {
  const rows = feedRows(['a', 'b', 'short:s1', 'c', 'd', 'short:s2', 'e'].map(item), 2);
  assert.deepEqual(rows.map(row => row.items.map(item => item.id)), [['a', 'b'], ['short:s1', 'short:s2'], ['c', 'd'], ['e']]);
  assert.equal(adjacentFeedItem(rows, 'b', 'down'), 'short:s2');
  assert.equal(adjacentFeedItem(rows, 'short:s2', 'down'), 'd');
  assert.equal(adjacentFeedItem(rows, 'd', 'down'), 'e');
  assert.equal(adjacentFeedItem(rows, 'e', 'left'), undefined);
  assert.equal(adjacentFeedItem(rows, 'a', 'up'), undefined);
});

test('large list windows are bounded while pinning an offscreen selection', () => {
  const rows = feedRows(Array.from({ length: 10000 }, (_, i) => item(String(i))), 4);
  const { offsets, total } = rowGeometry(rows, 250, 450, 30);
  const indexes = windowIndexes(offsets, 100000, 800, 0);
  assert.ok(indexes.length < 15);
  assert.equal(indexes[0], 0);
  assert.ok(indexes.some(index => offsets[index] >= 100000));
  assert.equal(total, 2500 * 280 - 30);
  assert.deepEqual(windowIndexes([], 0, 800), []);
});

test('Shorts cycle in both directions while ordinary rows keep their boundaries', () => {
  const rows = feedRows(['a', 'b', 'short:s1', 'short:s2', 'short:s3', 'c'].map(item), 2);
  assert.equal(adjacentFeedItem(rows, 'short:s3', 'right'), 'short:s1');
  assert.equal(adjacentFeedItem(rows, 'short:s1', 'left'), 'short:s3');
  assert.equal(adjacentFeedItem(rows, 'short:s1', 'right'), 'short:s2');
  assert.equal(adjacentFeedItem(rows, 'short:s3', 'down'), 'c');
  assert.equal(adjacentFeedItem(rows, 'b', 'right'), undefined);
  assert.equal(adjacentFeedItem(feedRows([item('short:only')], 2), 'short:only', 'right'), 'short:only');
});

test('Shorts wait for a full video row across responsive layouts', () => {
  const items = ['a', 'short:s1', 'short:s2', 'b', 'c', 'd', 'e'].map(item);
  const ids = columns => feedRows(items, columns).map(row => row.items.map(item => item.id));
  assert.deepEqual(ids(3), [['a', 'b', 'c'], ['short:s1', 'short:s2'], ['d', 'e']]);
  assert.deepEqual(ids(2), [['a', 'b'], ['short:s1', 'short:s2'], ['c', 'd'], ['e']]);
  assert.deepEqual(feedRows([item('a'), item('short:s1')], 3).map(row => row.items.map(item => item.id)), [['a'], ['short:s1']]);
  assert.equal(feedRows([item('short:s1'), item('a')], 3)[0].shorts, true);
});
