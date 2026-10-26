import { moduleSource } from '../scripts/test-source.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';

test('browse return restores an API category by identity and waits for its list', () => {
  const window = {}; let selected = 'Music', clicks = 0, feed = ['/watch?v=original'];
  const chips = ['All', 'Music'].map(label => ({
    isConnected: true, textContent: label, closest: () => null,
    getBoundingClientRect: () => ({ width: 80 }),
    getAttribute: name => name === 'selected' && label === selected ? '' : null,
    querySelector: selector => selector === 'button,[role="button"]' ? {
      getAttribute: () => null, click() { clicks++; selected = label; }
    } : null
  }));
  const document = { documentElement: { classList: { contains: () => false } }, getElementById: () => null, querySelector: () => null,
    querySelectorAll: selector => selector === '[data-ytg-category]' ? chips :
    feed.map(href => ({ closest: () => null, getAttribute: () => href })) };
  runInNewContext(moduleSource('src/sites/youtube.ts'), { window, document, location: { pathname: '/' }, getComputedStyle: () => ({ visibility: 'visible' }) });
  const config = window.YTGamepadSite.createNavigationConfig({}), saved = config.captureBrowseState();
  assert.equal(saved.category, 'Music');
  assert.equal(config.restoreBrowseState(saved, {}), true, 'retained API category/list is reused');
  selected = 'All'; feed = ['/watch?v=other']; chips.reverse();
  const attempt = {};
  assert.equal(config.restoreBrowseState(saved, attempt), false); assert.equal(clicks, 1);
  assert.equal(config.restoreBrowseState(saved, attempt), false, 'selected chip can precede asynchronous feed data');
  assert.equal(clicks, 1, 'category activation happens once');
  feed = ['/watch?v=original'];
  assert.equal(config.restoreBrowseState(saved, attempt), true);
  chips.length = 0;
  assert.equal(config.restoreBrowseState(saved, {}), false, 'wait for chips to be rebuilt');
});

test('Vue category restoration ignores hidden native chips and waits for API loading', () => {
  const window = {}; let selected = 'Music', loading = false, feed = ['old'];
  const chips = ['All', 'Music'].map(label => ({ isConnected: true, textContent: label, closest: () => null,
    getBoundingClientRect: () => ({ width: 80 }),
    getAttribute: name => name === 'selected' && selected === label ? '' : null,
    querySelector: selector => selector === 'button,[role="button"]' ? { getAttribute: () => null,
      click() { selected = label; loading = true; } } : null }));
  const document = { documentElement: { classList: { contains: () => true } }, querySelector: () => null,
    getElementById: () => ({ dataset: { feedLoading: String(loading) } }),
    querySelectorAll: selector => {
      assert.ok(!selector.includes('yt-chip-cloud-chip-renderer'), 'restoration must not scan native category nodes');
      return selector === '[data-ytg-category]' ? chips : feed.map(href => ({ closest: () => null, getAttribute: () => href }));
    } };
  runInNewContext(moduleSource('src/sites/youtube.ts'), { window, document, location: { pathname: '/' },
    getComputedStyle: () => ({ visibility: 'visible' }) });
  const config = window.YTGamepadSite.createNavigationConfig({});
  const saved = config.captureBrowseState(); assert.equal(saved.category, 'Music');
  selected = 'All'; const attempt = {};
  assert.equal(config.restoreBrowseState(saved, attempt), false);
  feed = ['new']; assert.equal(config.restoreBrowseState(saved, attempt), false);
  loading = false; assert.equal(config.restoreBrowseState(saved, attempt), true);
});

test('returning from native sidebar closes only a transient open drawer', () => {
  const window = {};
  let clicks = 0, opened = true, persistent = false;
  const drawer = { get persistent() { return persistent; }, hasAttribute: name => name === 'opened' ? opened : name === 'persistent' && persistent };
  const document = { querySelector: selector => selector === 'tp-yt-app-drawer#guide' ? drawer : { click() { clicks++; opened = false; } } };
  runInNewContext(moduleSource('src/sites/youtube.ts'), { window, document });
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
  runInNewContext(moduleSource('src/sites/youtube.ts'), {
    window, document, location, getComputedStyle: () => ({ display: 'block', visibility: 'visible' })
  });
  const config = window.YTGamepadSite.createNavigationConfig({ perform: action => window.YTGamepadSite.perform(action) });
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

test('shoulders activate modern chip buttons outside the page manager', () => {
  const window = {}, clicks = [], scrolls = [];
  let active = 0;
  const buttons = Array.from({ length: 3 }, (_, index) => ({
    disabled: false, getAttribute: () => null,
    click() { clicks.push(index); active = index; }
  }));
  const chips = buttons.map((button, index) => ({
    isConnected: true, parentElement: null, closest: () => null,
    hasAttribute: () => false, getAttribute: () => null,
    getBoundingClientRect: () => ({ width: 80, height: 40 }),
    querySelector(selector) {
      if (selector === 'button,[role="button"]') return button;
      return selector.includes('.ytChipShapeActive') && index === active ? button : null;
    },
    scrollIntoView() { scrolls.push(index); },
    click() { assert.fail('host clicks do not reach the inner button handler'); }
  }));
  const document = {
    querySelectorAll: selector => selector === '[data-ytg-category]' ? chips : []
  };
  runInNewContext(moduleSource('src/sites/youtube.ts'), {
    window, document, location: { pathname: '/' },
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' })
  });
  const config = window.YTGamepadSite.createNavigationConfig({});
  const press = action => config.onAction(action, { scope: document });
  assert.equal(press('seekForward'), 'handled');
  assert.equal(press('seekForward'), 'handled');
  assert.equal(press('seekForward'), 'blocked');
  assert.equal(press('seekBack'), 'handled');
  assert.deepEqual(clicks, [1, 2, 1]);
  assert.deepEqual(scrolls, [1, 2, 1]);
  buttons[0].disabled = true;
  assert.equal(press('seekBack'), 'blocked');
  assert.deepEqual(clicks, [1, 2, 1], 'disabled category is not activated');
});

test('category selection target resolves the visible chip face and falls back to its wrapper', () => {
  const window = {};
  runInNewContext(moduleSource('src/sites/youtube.ts'), { window });
  const config = window.YTGamepadSite.createNavigationConfig({});
  const face = {};
  const chip = { matches: () => true, querySelector: selector => selector === '.ytChipShapeChip' ? face : null };
  assert.equal(config.getSelectionTarget(chip), face);
  assert.equal(config.getSelectionRadius(chip), 'var(--ytg-chip-radius, 8px)');
  chip.querySelector = () => null;
  assert.equal(config.getSelectionTarget(chip), chip);
});
