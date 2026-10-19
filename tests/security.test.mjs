import { moduleSource } from '../scripts/test-source.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const read = file => moduleSource(file);

function bridge(overrides = {}) {
  const events = {}, messages = [], writes = [], runtime = [];
  let reads = 0, now = 1000;
  const stored = { enabled: false, theater: true, deadzone: Infinity, repeatDelay: 1, repeatInterval: '200', secret: 'never publish', ...overrides };
  const window = { addEventListener(name, fn) { events[name] = fn; }, postMessage(message, origin) { messages.push({ message, origin }); } };
  const chrome = {
    storage: {
      local: { get(_defaults, callback) { reads++; callback(stored); }, set(values) { writes.push(values); } },
      onChanged: { addListener() {} }
    },
    runtime: { id: 'test-extension', onMessage: { addListener(fn) { events.extension = fn; } }, async sendMessage(message) { runtime.push(message); } }
  };
  runInNewContext(read('src/app/content.ts'), {
    window, chrome, console, Date: { now: () => now }, location: { origin: 'https://www.youtube.com' },
    document: { hidden: false, addEventListener() {} }, navigator: { getGamepads: () => [] }, setInterval() {}
  });
  return { messages, writes, runtime, events, get reads() { return reads; }, advance() { now += 1000; },
    receive(data, source = window, origin = 'https://www.youtube.com') { events.message({ data, source, origin }); }
  };
}

test('page bridge publishes only allowed settings with validated values', () => {
  const s = bridge();
  assert.deepEqual(JSON.parse(JSON.stringify(s.messages[0])), {
    origin: 'https://www.youtube.com', message: { source: 'yt-gamepad-settings',
      values: { enabled: false, theater: true, playbackLayout: 'page', rightHandMode: false, deadzone: .35, repeatDelay: 150, repeatInterval: 140,
        gridLayout: 'adaptive', gridAutoSwitch: true, gridSwitchWidth: 640, gridSingleCover: 40, gridDoubleCover: 50,
        gridColumns0: 1, gridColumns600: 2, gridColumns900: 3, gridColumns1200: 4,
        shortcutLayouts: { watch: {}, browse: {} },
        bindings: { confirm: 0, back: 1, playPause: 2, search: 3, seekBack: 4, seekForward: 5, volumeDown: 6, volumeUp: 7, help: 9, keyboardSymbols: 10, keyboardCandidates: 11 } } }
  });
});

test('shortcut bridge drops unknown buttons, unsupported keys and arbitrary layout data', () => {
  const s = bridge({ shortcutLayouts: { watch: { X: 'm', unknown: 'c', A: 'Delete', B: { key: 'Enter' } }, browse: { Select: ' ' }, secret: 'never publish' } });
  assert.deepEqual(JSON.parse(JSON.stringify(s.messages[0].message.values.shortcutLayouts)), { watch: { X: 'm' }, browse: { Select: ' ' } });
});

test('forged page messages cannot persist settings or trigger extension operations', () => {
  const s = bridge();
  s.receive({ source: 'yt-gamepad-save', values: { theater: false, deadzone: .7 } });
  s.receive({ source: 'ytg-controller-connection', connected: true });
  s.receive({ source: 'yt-gamepad-settings', values: { enabled: true } });
  assert.equal(s.writes.length, 0);
  assert.equal(s.runtime.length, 0);
  assert.equal(s.reads, 1);
});

test('ready resends are origin filtered and limited even for same-page spoofing', () => {
  const s = bridge(), data = { source: 'yt-gamepad-ready' };
  s.receive(data, {}, 'https://www.youtube.com');
  s.receive(data, undefined, 'https://example.com');
  assert.equal(s.reads, 1);
  for (let i = 0; i < 100; i++) s.receive(data);
  assert.equal(s.reads, 2);
  s.advance(); s.receive(data);
  assert.equal(s.reads, 3);
});

test('settings entry forwards only a fixed request, with origin and rate limits', () => {
  const s = bridge(), data = { source: 'yt-gamepad-open-settings', url: 'https://example.com', values: { enabled: true } };
  s.receive(data, {}, 'https://www.youtube.com');
  s.receive(data, undefined, 'https://example.com');
  assert.equal(s.runtime.length, 0);
  for (let i = 0; i < 100; i++) s.receive(data);
  assert.deepEqual(JSON.parse(JSON.stringify(s.runtime)), [{ type: 'ytg-open-settings' }]);
  assert.equal(s.writes.length, 0);
  s.advance(); s.receive(data);
  assert.equal(s.runtime.length, 2);
});

test('toolbar inline settings request accepts only this extension and never writes supplied values', () => {
  const s = bridge(), replies = [];
  const request = { type: 'ytg-open-inline-settings', values: { enabled: true }, key: 'secret' };
  s.events.extension(request, { id: 'another-extension' }, result => replies.push(result));
  assert.equal(replies.length, 0);
  s.events.extension(request, { id: 'test-extension' }, result => replies.push(result));
  assert.equal(replies[0].ok, true);
  assert.equal(s.messages.at(-1).message.source, 'yt-gamepad-show-settings');
  assert.equal(s.writes.length, 0);
  s.receive({ source: 'yt-gamepad-clear-inline-diagnostics' });
  assert.equal(s.runtime.length, 0);
});

test('diagnostic bridge bounds untrusted telemetry and never accepts storage keys or export commands', () => {
  const s = bridge();
  const data = { source: 'yt-gamepad-diagnostic', key: 'enabled', entry: {
    module: 'site', operation: 'readPlayback', reason: 'failure', stack: '',
    state: { enabled: true, route: 'watch', secret: 'private' }, url: 'https://example.com/'
  } };
  s.receive(data, {}, 'https://www.youtube.com');
  s.receive(data, undefined, 'https://example.com');
  assert.equal(s.runtime.length, 0);
  s.receive({ ...data, entry: { ...data.entry, stack: 'x'.repeat(1025) } });
  assert.equal(s.runtime.length, 0);
  s.receive(data);
  assert.equal(s.runtime[0].type, 'ytg-diagnostic');
  assert.equal(s.runtime[0].entry.state.enabled, true);
  assert.equal(s.runtime[0].entry.state.secret, undefined); assert.equal(s.runtime[0].entry.url, undefined);
  for (let i = 0; i < 150; i++) s.receive(data);
  assert.ok(s.runtime.length <= 100); assert.equal(s.writes.length, 0);
});

test('connection status responds only to this extension', () => {
  const s = bridge(), replies = [];
  s.events.extension({ type: 'ytg-connection-status' }, { id: 'other' }, value => replies.push(value));
  assert.equal(replies.length, 0);
  s.events.extension({ type: 'ytg-connection-status' }, { id: 'test-extension' }, value => replies.push(value));
  assert.equal(replies[0].connected, false);
});

function pinyin(raw) {
  const window = {}, writes = [];
  runInNewContext(read('src/search/pinyin-data.ts') + '\n' + read('src/search/pinyin.ts'), {
    window, localStorage: { getItem() { return raw; }, setItem(key, value) { writes.push({ key, value }); } }
  });
  return { ime: window.YTGamepadPinyin, writes };
}

test('pinyin rankings reject invalid scores and dictionary keys, keeping valid hints', () => {
  const s = pinyin('{"ni:妮":2,"hao:好":"99","wo:我":101,"shi:是":-1,"de:的":1.5,"unknown:字":5,"__proto__":99}');
  assert.equal(s.ime.lookup('ni')[0].text, '妮');
  s.ime.learn({ key: 'ni', text: '你' });
  assert.deepEqual(JSON.parse(s.writes[0].value), { 'ni:妮': 2, 'ni:你': 1 });
  s.ime.learn({ key: '__proto__', text: 'bad' });
  s.ime.learn({ key: 'ni', text: 'not in dictionary' });
  assert.equal(s.writes.length, 1);
});

test('malformed or oversized rankings fall back to defaults without blocking learning', () => {
  for (const raw of ['{', '[]', 'null', ' '.repeat(131073)]) {
    const s = pinyin(raw);
    assert.equal(s.ime.lookup('ni')[0].text, '你');
    s.ime.learn({ key: 'ni', text: '你' });
    assert.deepEqual(JSON.parse(s.writes[0].value), { 'ni:你': 1 });
  }
});


test('right-hand preset crosses the settings bridge only as a boolean', () => {
  assert.equal(bridge({ rightHandMode: true }).messages[0].message.values.rightHandMode, true);
  assert.equal(bridge({ rightHandMode: 'true' }).messages[0].message.values.rightHandMode, false);
});
