import { moduleSource } from '../scripts/test-source.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const source = moduleSource('background.js');
function setup(state = 'maximized') {
  const session = {}, settings = { enabled: true, theater: true }, calls = [], listeners = {};
  const window = { state };
  const chrome = {
    runtime: { async openOptionsPage() { calls.push({ options: true }); }, onMessage: { addListener(fn) { listeners.message = fn; } } },
    storage: {
      session: { async get(key) { return { [key]: session[key] }; }, async set(values) { Object.assign(session, structuredClone(values)); } },
      local: { async get() { return settings; } },
      onChanged: { addListener(fn) { listeners.settings = fn; } }
    },
    windows: { async get() { return { ...window }; }, async update(id, values) { calls.push({ id, ...values }); Object.assign(window, values); }, onRemoved: { addListener(fn) { listeners.windowRemoved = fn; } } },
    tabs: { onRemoved: { addListener(fn) { listeners.tabRemoved = fn; } } }
  };
  const restart = () => runInNewContext(source, { chrome, console });
  restart();
  const sender = { frameId: 0, url: 'https://www.youtube.com/watch?v=test', tab: { id: 3, windowId: 7, active: true } };
  return { window, calls, settings, listeners, restart, async escape(origin = sender) {
    return new Promise(resolve => {
      if (!listeners.message({ type: 'ytg-exit-fullscreen' }, origin, resolve)) resolve(undefined);
    });
  }, async connect(connected, origin = sender) {
    return new Promise(resolve => {
      const handled = listeners.message({ type: 'ytg-controller-connection', connected }, origin, resolve);
      if (!handled) resolve(undefined);
    });
  } };
}
test('window fullscreen survives document reload and worker restart; disconnect restores maximized', async () => {
  const s = setup();
  assert.equal((await s.connect(true)).ok, true);
  assert.equal(s.window.state, 'fullscreen');
  s.restart();
  await s.connect(true); // Next document after search, video, or B return.
  assert.equal(s.calls.length, 1);
  await s.connect(false);
  assert.equal(s.window.state, 'maximized');
});
test('preexisting F11 fullscreen remains untouched on disconnect', async () => {
  const s = setup('fullscreen'); await s.connect(true); await s.connect(false);
  assert.equal(s.window.state, 'fullscreen'); assert.equal(s.calls.length, 0);
});
test('manual exit is respected and disabling fullscreen restores only extension-owned windows', async () => {
  const s = setup('normal'); await s.connect(true);
  s.window.state = 'maximized'; await s.connect(false);
  assert.equal(s.window.state, 'maximized');
  await s.connect(true); s.settings.theater = false;
  s.listeners.settings({ theater: { newValue: false } }, 'local');
  await s.connect(true); // Wait for the queued settings change.
  assert.equal(s.window.state, 'maximized');
});
test('background ignores messages from other origins and inactive tabs', async () => {
  const s = setup();
  await s.connect(true, { frameId: 0, url: 'https://example.com/', tab: { id: 3, windowId: 7, active: true } });
  await s.connect(true, { frameId: 0, url: 'https://www.youtube.com/', tab: { id: 3, windowId: 7, active: false } });
  assert.equal(s.calls.length, 0);
});

test('layout and automatic window fullscreen can be configured independently', async () => {
  const s = setup();
  s.settings.theater = false; s.settings.autoFullscreen = true;
  await s.connect(true);
  assert.equal(s.window.state, 'fullscreen');
  s.settings.theater = true; s.settings.autoFullscreen = false;
  s.listeners.settings({ autoFullscreen: { newValue: false } }, 'local');
  await s.connect(true);
  assert.equal(s.window.state, 'maximized');
});

test('settings entry opens options only for an active top-level YouTube tab', async () => {
  const s = setup();
  const message = { type: 'ytg-open-settings', url: 'https://example.com/' };
  const sender = { frameId: 0, url: 'https://www.youtube.com/watch?v=test', tab: { active: true } };
  assert.equal(s.listeners.message(message, { ...sender, frameId: 1 }, () => {}), undefined);
  assert.equal(s.listeners.message(message, { ...sender, url: 'https://example.com/' }, () => {}), undefined);
  assert.equal(s.listeners.message(message, { ...sender, tab: { active: false } }, () => {}), undefined);
  assert.equal(s.calls.length, 0);
  await new Promise(resolve => s.listeners.message(message, sender, resolve));
  assert.deepEqual(s.calls, [{ options: true }]);
});
test('new document does not interpret an initial empty gamepad snapshot as disconnect', async () => {
  const sent = [], events = {}; let pads = [], tick;
  const window = { addEventListener(name, fn) { events[name] = fn; }, postMessage() {} };
  const chrome = { runtime: { onMessage: { addListener() {} }, async sendMessage(message) { sent.push(message); return { ok: true }; } }, storage: { local: { get(defaults, callback) { callback(defaults); } }, onChanged: { addListener(fn) { events.settings = fn; } } } };
  runInNewContext(moduleSource('content.js'), {
    window, chrome, console, location: { origin: 'https://www.youtube.com' }, navigator: { getGamepads: () => pads },
    document: { hidden: false, addEventListener(name, fn) { events[name] = fn; } }, setInterval(fn) { tick = fn; }
  });
  tick(); assert.equal(sent.length, 0);
  pads = [{ connected: true, mapping: 'standard' }]; tick(); tick();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(sent.length, 1); assert.equal(sent[0].connected, true);
  pads = []; tick(); assert.equal(sent[1].connected, false);
  await new Promise(resolve => setImmediate(resolve));
  pads = [{ connected: true, mapping: 'standard' }]; tick();
  await new Promise(resolve => setImmediate(resolve));
  events.settings({ autoFullscreen: { newValue: true } }, 'local');
  assert.equal(sent.length, 4);
  assert.equal(sent[3].connected, true);
});

test('synthetic Escape cannot request fullscreen exit or report a false disconnect', () => {
  const sent = [], events = {}, pad = { connected: true, mapping: 'standard', axes: [.8, 0], buttons: [] };
  let tick, frame;
  const window = { addEventListener(name, fn) { events[name] = fn; }, postMessage() {} };
  const chrome = { runtime: { onMessage: { addListener() {} }, async sendMessage(message) { sent.push(message); return { ok: true }; } }, storage: { local: { get(defaults, callback) { callback(defaults); } }, onChanged: { addListener() {} } } };
  runInNewContext(moduleSource('content.js'), {
    window, chrome, console, location: { origin: 'https://www.youtube.com' }, navigator: { getGamepads: () => [pad] },
    document: { hidden: false, hasFocus: () => true, addEventListener() {} }, setInterval(fn) { tick = fn; }, requestAnimationFrame(fn) { frame = fn; }
  });
  events['yt-gamepad-escape-request']({ detail: { key: 'Escape', isTrusted: false } });
  assert.equal(sent.length, 1);
  events['yt-gamepad-escape-request']({ detail: { key: 'Escape', isTrusted: true }, preventDefault() {} });
  tick(); tick();
  assert.equal(sent.length, 2);
  assert.equal(sent[1].type, 'ytg-exit-fullscreen');
  assert.equal(sent[0].connected, true);
});

test('Escape restores the original window and stays dismissed through reload and worker restart', async () => {
  for (const original of ['normal', 'maximized']) {
    const s = setup(original);
    await s.connect(true);
    assert.equal((await s.escape()).exited, true);
    assert.equal(s.window.state, original);
    s.restart();
    await s.connect(true); await s.connect(true);
    assert.equal(s.window.state, original);
    await s.connect(false); await s.connect(true);
    assert.equal(s.window.state, 'fullscreen');
  }
});

test('Escape outside fullscreen falls back and rejects inactive or foreign senders', async () => {
  const s = setup();
  assert.equal((await s.escape()).exited, false);
  await s.connect(true);
  assert.equal((await s.escape({ frameId: 0, url: 'https://www.youtube.com/', tab: { id: 3, windowId: 7, active: false } })).exited, false);
  assert.equal(await s.escape({ frameId: 0, url: 'https://example.com/', tab: { id: 3, windowId: 7, active: true } }), undefined);
  assert.equal(s.window.state, 'fullscreen');
});

function connectionBridge() {
  const sent = [], events = {}, warnings = [];
  let tick, result = { ok: true }, pads = [{ connected: true, mapping: 'standard' }];
  const document = { hidden: false, addEventListener(name, fn) { events[name] = fn; } };
  const chrome = {
    runtime: { onMessage: { addListener() {} }, async sendMessage(message) {
      sent.push(message);
      if (result instanceof Error) throw result;
      return result;
    } },
    storage: { local: { get(defaults, callback) { callback(defaults); } }, onChanged: { addListener(fn) { events.settings = fn; } } }
  };
  // Start with an empty snapshot so each test controls the first request.
  const initialPads = pads; pads = [];
  runInNewContext(moduleSource('content.js'), {
    window: { addEventListener(name, fn) { events[name] = fn; }, postMessage() {} }, chrome,
    console: { warn(...args) { warnings.push(args); } }, document,
    navigator: { getGamepads: () => pads }, location: { origin: 'https://www.youtube.com' },
    setInterval(fn) { tick = fn; }
  });
  pads = initialPads;
  return { sent, events, document, warnings, tick: () => tick(),
    setResult(value) { result = value; }, disconnect() { pads = []; },
    flush: () => new Promise(resolve => setImmediate(resolve)) };
}

test('bridge retries failed fullscreen requests and stops polling messages after acknowledgement', async () => {
  for (const failure of [{ ok: false, error: 'Window update failed' }, new Error('Worker unavailable'), undefined, { ok: true, retry: true }]) {
    const s = connectionBridge();
    s.setResult(failure); s.tick(); await s.flush();
    s.setResult({ ok: true }); s.tick(); await s.flush();
    assert.equal(s.sent.length, 2);
    s.tick(); await s.flush();
    assert.equal(s.sent.length, 2);
  }
});

test('forced settings refresh failures also retry an already acknowledged connection', async () => {
  const s = connectionBridge(); s.tick(); await s.flush();
  s.setResult({ ok: false, error: 'Temporary failure' });
  s.events.settings({ autoFullscreen: { newValue: true } }, 'local'); await s.flush();
  s.setResult({ ok: true }); s.tick(); await s.flush();
  assert.equal(s.sent.length, 3);
});

test('returning from settings rechecks fullscreen even when connection has not changed', async () => {
  const s = connectionBridge(); s.tick(); await s.flush();
  s.document.hidden = true;
  s.events.settings({ autoFullscreen: { newValue: true } }, 'local');
  assert.equal(s.sent.length, 1);
  s.document.hidden = false; s.events.focus(); await s.flush();
  assert.equal(s.sent.length, 2);
});

test('disconnect still gets reported if the connection acknowledgement was lost', async () => {
  const s = connectionBridge(); s.setResult(undefined); s.tick(); await s.flush();
  s.disconnect(); s.tick(); await s.flush();
  assert.equal(s.sent[1].connected, false);
});

test('background marks an inactive connection for retry and applies it after activation', async () => {
  const s = setup();
  const sender = { frameId: 0, url: 'https://www.youtube.com/', tab: { id: 3, windowId: 7, active: false } };
  assert.equal((await s.connect(true, sender)).retry, true);
  assert.equal(s.calls.length, 0);
  assert.equal((await s.connect(true, { ...sender, tab: { ...sender.tab, active: true } })).retry, false);
  assert.equal(s.window.state, 'fullscreen');
});

