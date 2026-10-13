import { moduleSource } from '../scripts/test-source.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const window = {};
runInNewContext(moduleSource('src/navigation/navigation.ts'), { window });
const { choose } = window.YTGamepadNavigation;
const item = (section, left, top, width = 100, height = 60) => ({ section, rect: { left, top, width, height } });
const sections = {
  content: { layout: 'grid', exits: { left: ['sidebar'], up: ['header'] } },
  sidebar: { axis: 'vertical', exits: { right: ['content'] } },
  header: { axis: 'horizontal', exits: { down: ['content'] } }
};
test('explicit region exits remain usable after scrolling moves their destination behind the source', () => {
  const sidebar = item('sidebar', 0, 600), card = item('content', 200, 100);
  const category = item('categories', 200, 50), search = item('header', 200, 0);
  const rules = { ...sections, content: { layout: 'grid', exits: { up: ['categories', 'header'] } } };
  assert.equal(choose(sidebar, [sidebar, card], 'right', rules), card);
  // An offscreen first row can sit above a pinned category bar.
  card.rect.top = -100;
  assert.equal(choose(card, [card, category, search], 'up', rules), category);
  assert.equal(choose(card, [card, search], 'up', rules), search);
});
test('region exits prefer substantial overlap over a barely intersecting diagonal', () => {
  const from = item('sidebar', 0, 100, 80, 100);
  const diagonal = item('content', 100, 199, 100, 100);
  const aligned = item('content', 180, 100, 100, 100);
  assert.equal(choose(from, [from, diagonal, aligned], 'right', sections), aligned);
});
test('edge distance does not penalize a wide aligned target for its distant center', () => {
  const from = item('sidebar', 0, 100, 80, 60);
  const wide = item('content', 100, 100, 600, 60);
  const narrow = item('content', 200, 100, 100, 60);
  assert.equal(choose(from, [from, narrow, wide], 'right', sections), wide);
});
test('right selects same row instead of a nearer diagonal card', () => {
  const a = item('content', 200, 100), right = item('content', 500, 100), diagonal = item('content', 310, 170);
  assert.equal(choose(a, [a, right, diagonal], 'right', sections), right);
});
test('last card does not wrap right into the next row', () => {
  const a = item('content', 200, 100), nextRow = item('content', 310, 170);
  assert.equal(choose(a, [a, nextRow], 'right', sections), null);
});
test('content stays in its section until its left boundary', () => {
  const a = item('content', 400, 100), left = item('content', 200, 100), sidebar = item('sidebar', 0, 100);
  assert.equal(choose(a, [a, left, sidebar], 'left', sections), left);
  assert.equal(choose(left, [a, left, sidebar], 'left', sections), sidebar);
});
test('sidebar right exits to content while up moves within sidebar', () => {
  const a = item('sidebar', 0, 200), up = item('sidebar', 0, 100), card = item('content', 200, 200);
  assert.equal(choose(a, [a, up, card], 'up', sections), up);
  assert.equal(choose(a, [a, up, card], 'right', sections), card);
});
test('top row can exit to header', () => {
  const card = item('content', 200, 200), header = item('header', 200, 0);
  assert.equal(choose(card, [card, header], 'up', sections), header);
});
test('TV header moves down into categories without moving sideways into a different row', () => {
  const search = item('header', 200, 0, 600, 48), chip = item('header', 200, 72, 100, 40);
  const sidebar = item('sidebar', 0, 0, 80, 52), card = item('content', 200, 160);
  const rules = { ...sections, header: { layout: 'grid', exits: { left: ['sidebar'], down: ['content'] } } };
  assert.equal(choose(search, [search, chip, sidebar, card], 'left', rules), sidebar);
  assert.equal(choose(search, [search, chip, sidebar, card], 'right', rules), null);
  assert.equal(choose(search, [search, chip, sidebar, card], 'down', rules), chip);
  assert.equal(choose(chip, [search, chip, sidebar, card], 'down', rules), card);
});
test('overlay cannot escape to background content', () => {
  const button = item('overlay', 100, 100), background = item('content', 100, 0);
  assert.equal(choose(button, [button, background], 'up', { overlay: {} }), null);
});
test('down moves to the adjacent row before a farther aligned column', () => {
  const card = item('content', 200, 100), below = item('content', 200, 300), diagonal = item('content', 310, 170);
  assert.equal(choose(card, [card, below, diagonal], 'down', sections), diagonal);
});

test('vertical grid navigation keeps the column within the adjacent row', () => {
  const from = item('content', 400, 100), left = item('content', 200, 300), next = item('content', 400, 300), farther = item('content', 400, 500);
  assert.equal(choose(from, [from, left, next, farther], 'down', sections), next);
  assert.equal(choose(next, [from, left, next, farther], 'up', sections), from);
});

test('row alignment keeps full rows below pinned bars and avoids unnecessary movement', () => {
  const a = item('content', 200, 600, 200, 200), taller = item('content', 450, 600, 200, 240);
  assert.equal(window.YTGamepadNavigation.rowScroll(a, [a, taller], { top: 144, bottom: 784 }), 456);
  a.rect.top = taller.rect.top = 144;
  assert.equal(window.YTGamepadNavigation.rowScroll(a, [a, taller], { top: 144, bottom: 784 }), 0);
  a.rect.top = taller.rect.top = 80;
  assert.equal(window.YTGamepadNavigation.rowScroll(a, [a, taller], { top: 144, bottom: 784 }), -64);
});

test('oversized row aligns to the safe top and does not keep scrolling', () => {
  const card = item('content', 200, 144, 200, 900);
  assert.equal(window.YTGamepadNavigation.rowScroll(card, [card], { top: 144, bottom: 784 }), 0);
});

const rowRules = { ...sections, content: { ...sections.content, retainRowFocus: true } };
const video = (key, left, top) => ({ ...item('content', left, top), key });
test('vertical navigation follows the current column instead of the previous selection in that row', () => {
  const focus = window.YTGamepadNavigation.createRowFocus();
  const a = video('a', 200, 100), b = video('b', 400, 100);
  const c = video('c', 200, 300), d = video('d', 400, 300), cards = [a, b, c, d];
  assert.equal(choose(b, cards, 'down', rowRules, focus), d);
  assert.equal(choose(d, cards, 'left', rowRules, focus), c);
  assert.equal(choose(c, cards, 'up', rowRules, focus), a);
  assert.equal(choose(a, cards, 'down', rowRules, focus), c);
  assert.equal(choose(a, cards, 'right', rowRules, focus), b);
  assert.equal(choose(b, cards, 'down', rowRules, focus), d);
});

test('a short row does not erase the preferred column when entering an unvisited row', () => {
  const focus = window.YTGamepadNavigation.createRowFocus();
  const top = [0, 1, 2].map(i => video('top' + i, 200 + i * 200, 100));
  const short = video('short', 200, 300);
  const bottom = [0, 1, 2].map(i => video('bottom' + i, 200 + i * 200, 500));
  const cards = [...top, short, ...bottom];
  assert.equal(choose(top[2], cards, 'down', rowRules, focus), short);
  assert.equal(choose(short, cards, 'down', rowRules, focus), bottom[2]);
});

test('DOM replacement and removed cards preserve vertical column navigation', () => {
  const focus = window.YTGamepadNavigation.createRowFocus();
  const a = video('a', 200, 100), b = video('b', 400, 100);
  const c = video('c', 200, 300), d = video('d', 400, 300);
  choose(b, [a, b, c, d], 'down', rowRules, focus);
  choose(d, [a, b, c, d], 'left', rowRules, focus);
  choose(c, [a, b, c, d], 'up', rowRules, focus);
  const replacement = video('c', 200, 300);
  assert.equal(choose(a, [a, b, replacement, d], 'down', rowRules, focus), replacement);
  choose(a, [a, b, replacement, d], 'right', rowRules, focus);
  assert.equal(choose(b, [a, b, replacement, d], 'down', rowRules, focus), d);
  assert.equal(choose(b, [a, b, d], 'down', rowRules, focus), d);
  focus.reset();
  assert.equal(choose(b, [a, b, replacement, d], 'down', rowRules, focus), d);
});

test('explicit horizontal rows tolerate different card heights and vertical positions', () => {
  const a = video('a', 200, 100), b = video('b', 400, 140), c = video('c', 200, 300);
  a.row = b.row = {}; c.row = {};
  assert.equal(choose(a, [a, b, c], 'right', rowRules), b);
  assert.equal(choose(a, [a, b, c], 'down', rowRules), c);
  assert.equal(choose(b, [a, b, c], 'right', rowRules), null);
});
