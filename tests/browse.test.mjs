import { moduleSource } from '../scripts/test-source.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

test('returning from native sidebar closes only a transient open drawer', () => {
  const window = {};
  let clicks = 0, opened = true, persistent = false;
  const drawer = { get persistent() { return persistent; }, hasAttribute: name => name === 'opened' ? opened : name === 'persistent' && persistent };
  const document = { querySelector: selector => selector === 'tp-yt-app-drawer#guide' ? drawer : { click() { clicks++; opened = false; } } };
  runInNewContext(moduleSource('sites/youtube.js'), { window, document });
  const config = window.YTGamepadSite.createNavigationConfig({});
  const sidebar = { closest: selector => selector.includes('ytd-guide-renderer') ? {} : null };
  const card = { closest: selector => selector.includes('ytd-rich-item-renderer') ? {} : null };
  config.onSelectionChange(sidebar, document);
  config.onSelectionChange(card, document);
  assert.equal(clicks, 1);
  opened = true; persistent = true;
  config.onSelectionChange(sidebar, document);
  config.onSelectionChange(card, document);
  assert.equal(clicks, 1, 'persistent sidebar retains its native expanded state');
  persistent = false; opened = false;
  config.onSelectionChange(sidebar, document);
  config.onSelectionChange(card, document);
  assert.equal(clicks, 1, 'collapsed sidebar is not accidentally opened');
});

test('shoulders activate adjacent categories, skip hidden chips, and stop at either end', () => {
  const window = {}, clicks = [], scrolls = [];
  const location = { pathname: '/' };
  let active = 1;
  const chips = Array.from({ length: 4 }, (_, index) => ({
    isConnected: true, parentElement: null,
    closest: () => index === 2 ? {} : null,
    hasAttribute: () => false,
    getAttribute: name => name === 'selected' && active === index ? 'true' : null,
    querySelector: () => null,
    getBoundingClientRect: () => ({ width: 80, height: 40, left: index * 1000 }),
    scrollIntoView() { scrolls.push(index); },
    click() { clicks.push(index); active = index; }
  }));
  const document = { querySelectorAll: () => chips };
  runInNewContext(moduleSource('sites/youtube.js'), {
    window, document, location, getComputedStyle: () => ({ display: 'block', visibility: 'visible' })
  });
  const config = window.YTGamepadSite.createNavigationConfig({});
  const press = action => config.onAction(action, { scope: document });
  assert.equal(press('seekForward'), 'handled');
  assert.deepEqual(clicks, [3], 'offscreen category can be activated and hidden category is skipped');
  assert.deepEqual(scrolls, [3]);
  assert.equal(press('seekForward'), 'blocked');
  assert.equal(press('seekBack'), 'handled');
  assert.equal(press('seekBack'), 'handled');
  assert.equal(press('seekBack'), 'blocked');
  assert.deepEqual(clicks, [3, 1, 0]);
  assert.equal(config.onAction('seekForward', { scope: {} }), 'blocked', 'dialog owns input');
  active = -1;
  assert.equal(press('seekForward'), 'blocked', 'missing active category does not guess');
  document.querySelectorAll = () => [];
  assert.equal(press('seekBack'), 'blocked', 'no category bar consumes the shortcut');
  const video = { duration: 100, currentTime: 50 };
  document.querySelector = () => video;
  location.pathname = '/watch';
  assert.equal(press('seekForward'), 'handled');
  assert.equal(video.currentTime, 60, 'watch shoulders still seek');
});

test('category focus ring follows the visible chip face and its smaller corners', () => {
  const window = {};
  runInNewContext(moduleSource('sites/youtube.js'), { window });
  const config = window.YTGamepadSite.createNavigationConfig({});
  const face = {};
  const chip = { matches: () => true, querySelector: selector => selector === '.ytChipShapeChip' ? face : null };
  assert.equal(config.getSelectionTarget(chip), face);
  assert.equal(config.getSelectionRadius(chip), 'var(--ytg-chip-radius, 8px)');
  chip.querySelector = () => null;
  assert.equal(config.getSelectionTarget(chip), chip);
});

test('TV account entry forwards to the native account target and rejects unavailable targets', () => {
  const window = {};
  let native = null, clicks = 0;
  const document = { querySelector: () => native };
  runInNewContext(moduleSource('sites/youtube.js'), { window, document });
  const site = window.YTGamepadSite;
  assert.equal(site.readBrowseAccount(), null);
  assert.equal(site.openBrowseAccount(), false);
  native = { id: 'avatar-btn', isConnected: true, getAttribute: () => null, click() { clicks++; } };
  assert.equal(site.readBrowseAccount().label, '账号');
  assert.equal(site.openBrowseAccount(), true); assert.equal(clicks, 1);
  native.disabled = true;
  assert.equal(site.openBrowseAccount(), false); assert.equal(clicks, 1);
  native.disabled = false; native.id = '';
  assert.equal(site.readBrowseAccount().label, '登录');
});
