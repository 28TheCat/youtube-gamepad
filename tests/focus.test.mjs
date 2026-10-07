import { moduleSource } from '../scripts/test-source.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
test('search activation opens keyboard without clicking the underlying page', () => {
  const s = setup(), input = s.make('search');
  let opened = 0, clicks = 0;
  input.click = () => clicks++;
  s.nodes.push(input);
  s.window.YTGamepad.registerSite({ beforeActivate(el) { assert.equal(el, input); opened++; return true; } });
  s.window.YTGamepad.act('confirm');
  assert.equal(opened, 1); assert.equal(clicks, 0);
});
function setup() {
  const events = {}, winEvents = {}, nodes = [], ring = { style: {} }, help = { style: {} };
  let overlay = null, mutation;
  const created = [];
  const document = {
    body: {}, documentElement: { dataset: {}, append() {}, classList: { contains: () => false } },
    querySelectorAll() { return overlay ? [overlay] : []; },
    addEventListener(name, fn) { events[name] = fn; },
    contains(el) { return nodes.includes(el) || overlay?.contains(el); }
  };
  const rootQuery = document.querySelectorAll;
  document.querySelectorAll = selector => selector === '[role="dialog"]' ? rootQuery() : nodes;
  document.createElement = () => {
    const node = { style: {}, attributes: {}, replaceChildren(...children) { this.children = children; }, setAttribute(name, value) { this.attributes[name] = value; }, getAttribute(name) { return this.attributes[name] ?? null; }, contains: () => false, attachShadow: () => ({ append() {}, set innerHTML(v) { throw new TypeError('TrustedHTML required'); } }) };
    created.push(node); return node;
  };
  const location = { pathname: '/', search: '' };
  const window = { addEventListener(name, fn) { winEvents[name] = fn; }, scrollBy() {}, scrollTo(pos) { context.scrollX = pos.left; context.scrollY = pos.top; } };
  const context = { window, document, location, scrollX: 0, scrollY: 0, innerWidth: 1000, innerHeight: 800, getComputedStyle: () => ({ visibility: 'visible', display: 'block', opacity: '1' }), requestAnimationFrame: fn => fn(), MutationObserver: class { constructor(fn) { mutation = fn; } observe() {} } };
  runInNewContext(['app/route-state.js', 'state-machine.js', 'navigation.js', 'focus.js', 'core.js'].map(file => moduleSource(file)).join('\n'), context);
  // Inject layer policy just as the application coordinator does. The core
  // never reads concrete menu/watch globals itself.
  const registerSite = window.YTGamepad.registerSite;
  window.YTGamepad.registerSite = config => registerSite({
    getPriorityLayer: () => window.YTGamepadMenu?.opened ? { handle: action => window.YTGamepadMenu.handle(action) } : null,
    onDisable: () => window.YTGamepadMenu?.close(),
    ...config
  });
  const make = key => ({ key, isConnected: true, disabled: false, focus() {}, scrollIntoView() {}, click() {}, closest: () => null, getAttribute: () => null, getBoundingClientRect: () => ({ left: 100, top: 100, width: 100, height: 60 }) });
  window.YTGamepad.registerSite({ getKey: el => el.key, getSection: () => 'content', defaultSection: 'content', onAction(action) { if (action === 'back') overlay = null; } });
  return { nodes, make, events, location, window, context, ring: created.find(node => node.id === 'ring'), refresh: () => mutation([{ target: document.body }]), show(value) { overlay = value; }, open(items) { overlay = { ...make('dialog'), querySelectorAll: () => items, contains: el => items.includes(el) }; return overlay; } };
}

test('browse chrome returns to the original card from either peripheral region', () => {
  const s = setup();
  runInNewContext(moduleSource('navigation.js'), s.context);
  const card = { ...s.make('original'), region: 'content' };
  const other = { ...s.make('nearer'), region: 'content', getBoundingClientRect: () => ({ left: 220, top: 100, width: 100, height: 60 }) };
  const sidebar = { ...s.make('sidebar'), region: 'sidebar', getBoundingClientRect: () => ({ left: 0, top: 100, width: 80, height: 60 }) };
  const header = { ...s.make('search'), region: 'header', getBoundingClientRect: () => ({ left: 100, top: 0, width: 100, height: 60 }) };
  s.nodes.push(card, other, sidebar, header);
  s.window.YTGamepad.registerSite({
    getKey: el => el?.key, getSection: el => el?.region, defaultSection: 'content', rememberRegionReturn: () => true,
    sections: { content: { layout: 'grid', exits: { left: ['sidebar'], up: ['header'] } }, sidebar: { axis: 'vertical', exits: { right: ['content'] } }, header: { exits: { down: ['content'] } } }
  });
  s.window.YTGamepad.focus(card);
  s.window.YTGamepad.act('left'); assert.equal(s.window.YTGamepad.current, sidebar);
  s.window.YTGamepad.act('right'); assert.equal(s.window.YTGamepad.current, card);
  s.window.YTGamepad.act('up'); assert.equal(s.window.YTGamepad.current, header);
  s.window.YTGamepad.act('down'); assert.equal(s.window.YTGamepad.current, card);
  s.window.YTGamepad.focus(sidebar);
  s.window.YTGamepad.act('back'); assert.equal(s.window.YTGamepad.current, card);
  s.window.YTGamepad.focus(header);
  s.window.YTGamepad.act('back'); assert.equal(s.window.YTGamepad.current, card);
  s.window.YTGamepad.focus(other);
  s.location.pathname = '/feed/subscriptions'; s.events['yt-navigate-finish']();
  assert.equal(s.window.YTGamepad.current, card);
  s.location.pathname = '/'; s.events['yt-navigate-finish']();
  assert.equal(s.window.YTGamepad.current, other, 'returning to a route must preserve its remembered card');
});

test('a closed menu returning pass cannot swallow page or playback actions', () => {
  const s = setup(), card = s.make('video');
  let clicks = 0, playback = 0, menuCalls = 0;
  card.click = () => clicks++;
  s.nodes.push(card);
  s.window.YTGamepadMenu = { opened: false, handle() { menuCalls++; return 'pass'; } };
  assert.equal(s.window.YTGamepad.act('confirm'), 'handled');
  assert.equal(clicks, 1);
  s.window.YTGamepad.registerSite({ handleRegion: () => 'pass', handleBase() { playback++; return 'handled'; } });
  assert.equal(s.window.YTGamepad.act('playPause'), 'handled');
  assert.equal(playback, 1); assert.equal(menuCalls, 0);
});

test('an open menu cannot leak input even if its handler returns pass', () => {
  const s = setup(); let underlying = 0;
  s.window.YTGamepadMenu = { opened: true, handle: () => 'pass' };
  s.window.YTGamepad.registerSite({ handleBase() { underlying++; return 'handled'; } });
  assert.equal(s.window.YTGamepad.act('confirm'), 'blocked');
  assert.equal(s.window.YTGamepad.act('playPause'), 'blocked');
  assert.equal(underlying, 0);
});

test('disabled and navigating input stop before consulting any layer', () => {
  const s = setup();
  let calls = 0;
  s.window.YTGamepadMenu = { opened: true, close() {}, handle() { calls++; return 'handled'; } };
  s.window.YTGamepad.configure({ enabled: false });
  assert.equal(s.window.YTGamepad.act('search'), 'blocked');
  assert.equal(calls, 0);
  s.window.YTGamepad.configure({ enabled: true });
  s.events['yt-navigate-start']();
  for (const action of ['confirm', 'back']) assert.equal(s.window.YTGamepad.act(action), 'blocked');
  assert.equal(calls, 0);
  s.events['yt-navigate-cancel']();
  assert.equal(s.window.YTGamepad.act('confirm'), 'handled');
  assert.equal(calls, 1);
});

test('an empty native layer blocks confirm and every media or menu shortcut', () => {
  const s = setup();
  let underlying = 0;
  s.window.YTGamepad.registerSite({ interceptAction() { underlying++; return true; }, onAction() { underlying++; } });
  s.window.YTGamepadMenu = { opened: false, handle() { underlying++; return 'handled'; } };
  s.open([]);
  for (const action of ['confirm', 'playPause', 'seekBack', 'seekForward', 'volumeUp', 'volumeDown', 'search', 'help']) {
    assert.equal(s.window.YTGamepad.act(action), 'blocked', action);
  }
  assert.equal(underlying, 0);
});

test('a site panel owns input even when it has no action to execute', () => {
  const s = setup();
  let base = 0, layers = 0;
  s.window.YTGamepad.registerSite({
    getInputLayer: () => 'description',
    handleLayer() { layers++; return 'blocked'; },
    handleRegion() { base++; return 'handled'; },
    onAction() { base++; }
  });
  assert.equal(s.window.YTGamepad.act('confirm'), 'blocked');
  assert.equal(s.window.YTGamepad.act('playPause'), 'blocked');
  assert.equal(layers, 2); assert.equal(base, 0);
});

test('only pass from a region reaches basic actions; blocked stops dispatch', () => {
  const s = setup();
  let base = 0, outcome = 'blocked';
  s.window.YTGamepad.registerSite({ handleRegion: () => outcome, handleBase() { base++; return 'handled'; } });
  assert.equal(s.window.YTGamepad.act('playPause'), 'blocked');
  assert.equal(base, 0);
  outcome = undefined;
  assert.equal(s.window.YTGamepad.act('playPause'), 'blocked');
  assert.equal(base, 0);
  outcome = 'pass';
  assert.equal(s.window.YTGamepad.act('playPause'), 'handled');
  assert.equal(base, 1);
});

test('search owner consumes editing shortcuts above both native and site panels', () => {
  const s = setup(), received = [];
  let underlying = 0;
  s.window.YTGamepadMenu = { opened: true, handle(action) { received.push(action); return 'handled'; } };
  s.window.YTGamepad.registerSite({ getInputLayer: () => 'description', handleLayer() { underlying++; }, onAction() { underlying++; } });
  s.open([]);
  for (const action of ['playPause', 'seekBack', 'seekForward', 'search', 'help']) assert.equal(s.window.YTGamepad.act(action), 'handled');
  assert.deepEqual(received, ['playPause', 'seekBack', 'seekForward', 'search', 'help']);
  assert.equal(underlying, 0);
});

test('fallback help blocks confirm instead of pausing playback', () => {
  const s = setup(); let calls = 0;
  s.window.YTGamepad.registerSite({ handleBase() { calls++; return 'handled'; } });
  assert.equal(s.window.YTGamepad.act('help'), 'handled');
  assert.equal(s.window.YTGamepad.act('confirm'), 'blocked');
  assert.equal(calls, 0);
  assert.equal(s.window.YTGamepad.act('back'), 'handled');
  assert.equal(s.window.YTGamepad.act('confirm'), 'handled');
  assert.equal(calls, 1);
});
test('opening dialog moves focus inside and closing restores outside selection', () => {
  const s = setup(), card = s.make('video'), button = s.make('close'); s.nodes.push(card);
  s.window.YTGamepad.act('confirm'); assert.equal(s.window.YTGamepad.current, card);
  s.open([button]); s.refresh(); assert.equal(s.window.YTGamepad.current, button);
  s.window.YTGamepad.act('back'); s.refresh(); assert.equal(s.window.YTGamepad.current, card);
});

test('native dialog actions take priority over playback shortcuts', () => {
  const s = setup(), card = s.make('video'), button = s.make('settings');
  s.nodes.push(card);
  let intercepted = 0, closed = 0;
  s.window.YTGamepad.registerSite({
    interceptAction() { intercepted++; return true; },
    onAction(action) { if (action === 'back') closed++; }
  });
  s.open([button]); s.refresh();
  s.window.YTGamepad.act('confirm');
  s.window.YTGamepad.act('back');
  assert.equal(intercepted, 0);
  assert.equal(closed, 1);
});

test('a fading-in dialog owns B before it becomes opaque', () => {
  const s = setup(), button = s.make('close');
  let intercepted = 0, returned = 0;
  s.context.getComputedStyle = el => ({ visibility: 'visible', display: 'block', opacity: el.key === 'dialog' ? '0' : '1' });
  s.window.YTGamepad.registerSite({ interceptAction() { intercepted++; return true; }, onAction(action) { if (action === 'back') returned++; } });
  s.open([button]); s.window.YTGamepad.act('back');
  assert.equal(intercepted, 0);
  assert.equal(returned, 1);
});

test('nested dialogs restore the selected parent item and then the page focus', () => {
  const s = setup(), card = s.make('video'), first = s.make('first'), selected = s.make('quality'), option = s.make('1080p');
  s.nodes.push(card);
  s.window.YTGamepad.act('confirm');
  const parent = s.open([first, selected]); s.refresh();
  s.window.YTGamepad.focus(selected);
  s.open([option]); s.refresh();
  assert.equal(s.window.YTGamepad.current, option);
  s.show(parent); s.refresh();
  assert.equal(s.window.YTGamepad.current, selected);
  s.show(null); s.refresh();
  assert.equal(s.window.YTGamepad.current, card);
});
test('SPA return waits for saved video and restores its scroll position', () => {
  const s = setup(), card = s.make('video'); s.nodes.push(card); s.context.scrollY = 450;
  s.window.YTGamepad.act('confirm'); s.events['yt-navigate-start']();
  s.location.pathname = '/watch'; s.nodes.length = 0; s.events['yt-navigate-finish']();
  s.location.pathname = '/'; s.events['yt-navigate-finish'](); assert.equal(s.window.YTGamepad.current, null);
  const returned = s.make('video'); s.nodes.push(returned); s.context.scrollY = 0; s.refresh();
  assert.equal(s.window.YTGamepad.current, returned); assert.equal(s.context.scrollY, 450);
});

test('navigation scroll and focus changes cannot overwrite the saved home grid', () => {
  const s = setup(), card = s.make('original'); s.nodes.push(card);
  s.context.scrollY = 450; s.window.YTGamepad.focus(card);
  s.events['yt-navigate-start']();
  s.context.scrollY = 0;
  s.window.YTGamepad.refresh();
  s.location.pathname = '/watch'; s.nodes.length = 0; s.events['yt-navigate-finish']();
  s.location.pathname = '/'; s.events['yt-navigate-finish']();
  const replacement = s.make('original'); s.nodes.push(s.make('other'), replacement);
  s.window.YTGamepad.refresh();
  assert.equal(s.window.YTGamepad.current, replacement);
  assert.equal(s.context.scrollY, 450);
  s.context.scrollY = 120; s.window.YTGamepad.refresh();
  assert.equal(s.context.scrollY, 120, 'restoration ends and subsequent scrolling is respected');
});

test('return waits for category and page height before restoring the original card', () => {
  const s = setup(), card = s.make('original'); s.nodes.push(card);
  let ready = false, category = 'Music';
  s.window.YTGamepad.registerSite({
    getKey: el => el?.key, getSection: () => 'content',
    captureBrowseState: () => ({ category }),
    restoreBrowseState(saved) { category = saved.category; return ready; }
  });
  s.context.scrollY = 800; s.window.YTGamepad.focus(card);
  s.events['yt-navigate-start'](); s.location.pathname = '/watch';
  s.nodes.length = 0; s.events['yt-navigate-finish']();
  category = 'All'; s.location.pathname = '/'; s.context.scrollY = 0;
  s.events['yt-navigate-finish']();
  const returned = s.make('original'); s.nodes.push(returned);
  s.window.YTGamepad.refresh();
  assert.equal(category, 'Music'); assert.equal(s.window.YTGamepad.current, null);
  ready = true;
  s.context.document.scrollingElement = { scrollHeight: 900, scrollWidth: 1000 };
  s.window.YTGamepad.refresh(); assert.equal(s.window.YTGamepad.restoring, true);
  s.context.document.scrollingElement.scrollHeight = 1800;
  s.window.YTGamepad.refresh();
  assert.equal(s.window.YTGamepad.current, returned); assert.equal(s.context.scrollY, 800);
  assert.equal(s.window.YTGamepad.restoring, false);
});

test('a removed return target falls back to its original surviving neighbor after the deadline', () => {
  const s = setup(), cards = ['a', 'b', 'c'].map(s.make); s.nodes.push(...cards);
  s.window.YTGamepad.focus(cards[1]); s.events['yt-navigate-start']();
  s.location.pathname = '/watch'; s.nodes.length = 0; s.events['yt-navigate-finish']();
  s.location.pathname = '/'; s.events['yt-navigate-finish']();
  const neighbor = s.make('c'); s.nodes.push(s.make('new'), neighbor, s.make('a'));
  s.context.Date = { now: () => Date.now() + 6000 };
  s.window.YTGamepad.refresh();
  assert.equal(s.window.YTGamepad.current, neighbor);
  assert.equal(s.window.YTGamepad.restoring, false);
});
test('YouTube adapter deduplicates targets inside one video card', () => {
  let adapter;
  const adapterWindow = {};
  runInNewContext(moduleSource('sites/youtube.js'), { window: adapterWindow, document: { documentElement: { classList: { contains: () => false } } }, location: { pathname: '/' } });
  adapter = adapterWindow.YTGamepadSite.createNavigationConfig({ mode: 'browse' });
  const card = {}, thumbnail = { closest: () => card }, title = { closest: () => card }, other = { closest: () => ({}) };
  const result = adapter.filterCandidates([thumbnail, title, other]);
  assert.equal(result.length, 2); assert.equal(result[0], thumbnail); assert.equal(result[1], other);
});

test('sidebar confirmation and route change retain focus for the next direction', () => {
  const s = setup(), sidebar = s.make('you'), card = s.make('history');
  sidebar.section = 'sidebar'; card.section = 'content';
  s.nodes.push(sidebar, card);
  s.window.YTGamepad.registerSite({ getKey: el => el.key, getSection: el => el?.section, defaultSection: 'sidebar' });
  s.window.YTGamepad.act('confirm');
  s.location.pathname = '/feed/you';
  const replacement = s.make('you'); replacement.section = 'sidebar';
  s.nodes[0] = replacement;
  s.events['yt-navigate-finish']();
  assert.equal(s.window.YTGamepad.current, replacement);
  s.window.YTGamepadNavigation.choose = function (from, items, direction) {
    assert.equal(from.el, replacement); assert.equal(direction, 'right');
    return items.find(item => item.el === card);
  };
  s.window.YTGamepad.navigate('right');
  assert.equal(s.window.YTGamepad.current, card);
});

test('grid moves by rows, aligns the whole row and stays still at the end', () => {
  const s = setup();
  runInNewContext(moduleSource('navigation.js'), s.context);
  const makeCard = (key, left, top, height = 200) => {
    const card = s.make(key);
    card.getBoundingClientRect = () => ({ left, top: top - s.context.scrollY, width: 200, height });
    card.scrollIntoView = () => { throw new Error('Grid must use row alignment'); };
    return card;
  };
  const first = makeCard('first', 200, 144), next = makeCard('next', 200, 650), taller = makeCard('taller', 450, 650, 240);
  s.nodes.push(first, next, taller);
  let scrolls = 0;
  const scrollTo = s.window.scrollTo;
  s.window.scrollTo = pos => { scrolls++; assert.equal(pos.behavior, 'instant'); scrollTo(pos); };
  s.window.scrollBy = () => { throw new Error('No half-screen scrolling'); };
  s.window.YTGamepad.registerSite({ getSection: () => 'content', defaultSection: 'content', sections: { content: { layout: 'grid' } }, getViewport: () => ({ top: 144, bottom: 784 }) });
  s.window.YTGamepad.act('confirm');
  assert.equal(scrolls, 0);
  s.window.YTGamepad.navigate('down');
  assert.equal(s.window.YTGamepad.current, next);
  assert.equal(s.context.scrollY, 506);
  assert.equal(s.ring.style.transition, 'none', 'a scrolled selection must not glide through the category bar');
  s.window.YTGamepad.navigate('right');
  assert.equal(s.window.YTGamepad.current, taller);
  assert.equal(s.ring.style.transition, '', 'same-row moves retain the short focus animation');
  s.refresh();
  assert.equal(s.ring.style.transition, 'none', 'layout recovery must follow the card immediately');
  assert.equal(scrolls, 1);
  s.window.YTGamepad.navigate('down');
  assert.equal(s.window.YTGamepad.current, taller);
  assert.equal(scrolls, 1);
  s.window.YTGamepad.navigate('up');
  assert.equal(s.window.YTGamepad.current, first);
  assert.equal(s.context.scrollY, 0);
});

test('page input preserves row focus and the preferred column without scrolling visible cards', () => {
  const s = setup();
  const card = (key, left, top) => ({ ...s.make(key), getBoundingClientRect: () => ({ left, top, width: 100, height: 60 }) });
  const a = card('a', 200, 144), b = card('b', 400, 144), c = card('c', 600, 144);
  const short = card('short', 200, 300);
  const d = card('d', 200, 450), e = card('e', 400, 450), f = card('f', 600, 450);
  s.nodes.push(a, b, c, short, d, e, f);
  s.window.scrollTo = () => { throw new Error('Visible rows must not scroll'); };
  s.window.YTGamepad.registerSite({ getSection: () => 'content', getKey: el => el.key,
    sections: { content: { layout: 'grid', retainRowFocus: true } },
    getViewport: () => ({ top: 144, bottom: 784 }) });
  s.window.YTGamepad.focus(c);
  s.window.YTGamepad.navigate('down'); assert.equal(s.window.YTGamepad.current, short);
  s.window.YTGamepad.navigate('down'); assert.equal(s.window.YTGamepad.current, f);
  s.window.YTGamepad.navigate('left'); assert.equal(s.window.YTGamepad.current, e);
  s.window.YTGamepad.navigate('up'); assert.equal(s.window.YTGamepad.current, short);
  s.window.YTGamepad.navigate('up'); assert.equal(s.window.YTGamepad.current, c);
  s.window.YTGamepad.navigate('down');
  s.window.YTGamepad.navigate('down'); assert.equal(s.window.YTGamepad.current, e);
  s.window.YTGamepad.resetContentFocus();
  assert.equal(s.window.YTGamepad.current, a);
  s.window.YTGamepad.navigate('down');
  s.window.YTGamepad.navigate('down'); assert.equal(s.window.YTGamepad.current, d);
});

test('selection visibility follows the injected policy and keeps native dialogs visible', () => {
  const s = setup(), card = s.make('video'), button = s.make('settings');
  let hidden = false;
  s.nodes.push(card);
  s.window.YTGamepad.registerSite({ shouldShowSelection: ({ scope }) => scope !== s.context.document || !hidden });
  s.window.YTGamepad.act('confirm'); assert.equal(s.ring.style.display, 'block');
  hidden = true; s.refresh(); assert.equal(s.ring.style.display, 'none');
  s.open([button]); s.refresh(); assert.equal(s.ring.style.display, 'block');
  s.show(null); s.refresh(); assert.equal(s.ring.style.display, 'none');
  hidden = false; s.refresh(); assert.equal(s.ring.style.display, 'block');
});

test('core works with an unnamed input owner without reading concrete application modules', () => {
  const s = setup(), received = [];
  for (const name of ['YTGamepadMenu', 'YTGamepadWatch', 'YTGamepadSite']) {
    Object.defineProperty(s.window, name, { get() { throw new Error('core crossed module boundary: ' + name); } });
  }
  let active = true;
  s.window.YTGamepad.registerSite({
    getPriorityLayer: () => active ? { handle(action) { received.push(action); return 'handled'; } } : null,
    isFocusOwned: () => active,
    onDisable() { active = false; }
  });
  assert.equal(s.window.YTGamepad.act('confirm'), 'handled');
  assert.deepEqual(received, ['confirm']);
  s.refresh();
  s.window.YTGamepad.configure({ enabled: false });
  assert.equal(s.window.YTGamepad.act('confirm'), 'blocked');
  assert.equal(active, false);
});


test('native sliders require A and B ends adjustment before dismissing their dialog', () => {
  const s = setup(), slider = s.make('volume');
  let value = 40, backs = 0, clicks = 0;
  slider.click = () => clicks++;
  s.open([slider]);
  s.window.YTGamepad.registerSite({
    getKey: el => el.key, isSlider: el => el === slider,
    adjustSlider(_el, direction) { value += direction * 5; },
    onAction(action) { if (action === 'back') backs++; }
  });
  s.window.YTGamepad.refresh();
  s.window.YTGamepad.act('right'); assert.equal(value, 40);
  s.window.YTGamepad.act('confirm');
  s.window.YTGamepad.act('right'); assert.equal(value, 45);
  assert.equal(s.window.YTGamepad.act('down'), 'blocked');
  s.window.YTGamepad.act('confirm');
  s.window.YTGamepad.act('left'); assert.equal(value, 45);
  s.window.YTGamepad.act('confirm');
  s.window.YTGamepad.act('left'); assert.equal(value, 40);
  s.window.YTGamepad.act('back'); assert.equal(backs, 0);
  s.window.YTGamepad.act('back'); assert.equal(backs, 1);
  assert.equal(clicks, 0);
});
