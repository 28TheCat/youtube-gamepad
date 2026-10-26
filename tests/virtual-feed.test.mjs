import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importSettingsModel } from './helpers/settings-model.mjs';
const { feedRows, rowGeometry, windowIndexes, adjacentFeedItem, indexFeedRows } = await importSettingsModel('src/shared/virtual-feed.ts');
const item = id => ({ id, title: id, href: '/watch?v=' + id, channel: '', thumbnail: '' });

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
