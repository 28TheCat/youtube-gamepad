import { moduleSource } from '../scripts/test-source.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const read = file => moduleSource(file);

function bridge() {
  const events = {}, messages = [], writes = [], runtime = [];
  let reads = 0, now = 1000;
  const stored = { enabled: false, theater: true, deadzone: Infinity, repeatDelay: 1, repeatInterval: '200', secret: 'never publish' };
  const window = { addEventListener(name, fn) { events[name] = fn; }, postMessage(message, origin) { messages.push({ message, origin }); } };
  const chrome = {
    storage: {
      local: { get(_defaults, callback) { reads++; callback(stored); }, set(values) { writes.push(values); } },
      onChanged: { addListener() {} }
    },
    runtime: { id: 'test-extension', onMessage: { addListener(fn) { events.extension = fn; } }, async sendMessage(message) { runtime.push(message); } }
  };
  runInNewContext(read('content.js'), {
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
      values: { enabled: false, theater: true, deadzone: .35, repeatDelay: 150, repeatInterval: 140 } }
  });
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

test('connection status responds only to this extension', () => {
  const s = bridge(), replies = [];
  s.events.extension({ type: 'ytg-connection-status' }, { id: 'other' }, value => replies.push(value));
  assert.equal(replies.length, 0);
  s.events.extension({ type: 'ytg-connection-status' }, { id: 'test-extension' }, value => replies.push(value));
  assert.equal(replies[0].connected, false);
});

function pinyin(raw) {
  const window = {}, writes = [];
  runInNewContext(read('pinyin-data.js') + '\n' + read('pinyin.js'), {
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
