import { moduleSource } from '../scripts/test-source.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

function setup() {
  const listeners = {}, windowListeners = {}, actions = [], exits = [], pad = { index: 0, connected: true, mapping: 'standard', axes: [0, 0], buttons: Array.from({ length: 16 }, () => ({ pressed: false })) };
  const node = () => ({ style: {}, attributes: {}, replaceChildren(...children) { this.children = children; }, setAttribute(name, value) { this.attributes[name] = value; }, getAttribute(name) { return this.attributes[name] ?? null; }, contains: () => false, attachShadow: () => ({ append() {} }) });
  const document = {
    body: {}, hidden: false, hasFocus: () => true, documentElement: { append() {}, dataset: {}, classList: { toggle() {} } }, createElement: node,
    querySelectorAll: () => [], addEventListener(name, fn) { listeners[name] = fn; }
  };
  let frame;
  const window = { addEventListener(name, fn, capture) { windowListeners[name] = fn; if (name === 'keydown') assert.equal(capture, true); }, dispatchEvent(event) {
    windowListeners[event.type]?.(event);
    if (event.type === 'yt-gamepad-exit') { exits.push(event.detail.reason); window.YTGamepad.configure({ enabled: false }); }
    if (event.type === 'yt-gamepad-resume') window.YTGamepad.configure({ enabled: true });
  } };
  const context = {
    window, document, location: { pathname: '/watch', search: '' },
    navigator: { getGamepads: () => [pad] }, requestAnimationFrame(fn) { frame = fn; },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    MutationObserver: class { observe() {} }
  };
  for (const file of ['app/route-state.js', 'state-machine.js', 'gamepad.js', 'core.js']) runInNewContext(moduleSource(file), context);
  window.YTGamepad.registerSite({
    ownsKeyboardEvent: event => ['yt-gamepad-menu', 'ytg-watch'].includes(event.target?.id),
    handleBase(action) { actions.push(action); return 'handled'; }
  });
  const send = (values = {}) => {
    let prevented = 0, stopped = 0;
    windowListeners.keydown({ key: 'Escape', isTrusted: true, target: {}, preventDefault() { prevented++; }, stopImmediatePropagation() { stopped++; }, ...values });
    return { prevented, stopped };
  };
  return { window, actions, exits, send, pad, tick(time) { frame(time); } };
}

test('Escape stays native without a connected standard controller', () => {
  for (const values of [{ connected: false }, { mapping: '' }]) {
    const s = setup(); Object.assign(s.pad, values);
    assert.deepEqual(s.send(), { prevented: 0, stopped: 0 });
    assert.deepEqual(s.actions, []);
  }
});

test('page Escape and B dispatch the same back action once without exiting', () => {
  const s = setup();
  s.window.YTGamepad.act('back');
  assert.deepEqual(s.send(), { prevented: 1, stopped: 1 });
  assert.deepEqual(s.exits, []);
  s.window.YTGamepad.act('back');
  assert.deepEqual(s.actions, ['back', 'back', 'back']);
});

test('Escape dispatches once above search and watch shadow surfaces', () => {
  for (const id of ['yt-gamepad-menu', 'ytg-watch']) {
    const s = setup();
    assert.deepEqual(s.send({ target: { id, shadowRoot: {} } }), { prevented: 1, stopped: 1 });
    assert.deepEqual(s.exits, []);
    assert.deepEqual(s.actions, ['back']);
  }
});

test('synthetic native Escape cannot recursively dispatch back', () => {
  const s = setup();
  assert.deepEqual(s.send({ isTrusted: false }), { prevented: 0, stopped: 0 });
  assert.deepEqual(s.actions, []);
  s.window.YTGamepadInput.configure({ enabled: false });
  assert.deepEqual(s.send(), { prevented: 0, stopped: 0 });
});

test('held Escape does not return through multiple layers or change input mode', () => {
  const s = setup();
  s.send(); s.send({ repeat: true }); s.send({ repeat: true });
  assert.deepEqual(s.actions, ['back']);
  assert.deepEqual(s.exits, []);
  assert.equal(s.window.YTGamepadInput.mode, 'mouse');
  s.send(); assert.deepEqual(s.actions, ['back', 'back']);
});

test('prevented Escape and other keys do not dispatch back', () => {
  const s = setup();
  assert.deepEqual(s.send({ defaultPrevented: true }), { prevented: 0, stopped: 0 });
  assert.deepEqual(s.send({ key: 'Enter' }), { prevented: 0, stopped: 0 });
  assert.deepEqual(s.actions, []);
});
