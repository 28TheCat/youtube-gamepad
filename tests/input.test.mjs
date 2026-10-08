import { moduleSource } from '../scripts/test-source.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const source = moduleSource('src/input/gamepad.ts');
function setup(location = { pathname: '/' }) {
  const actions = [], connections = [], listeners = {}, documentListeners = {}, classes = new Set(), pad = { index: 0, connected: true, mapping: 'standard', axes: [0, 0], buttons: Array.from({ length: 16 }, () => ({ pressed: false })) };
  let frame;
  const window = { dispatchEvent(e) { if ('connected' in e.detail) connections.push(e.detail.connected); else if (e.detail.action) actions.push(e.detail.action); }, addEventListener(name, fn) { listeners[name] = fn; } };
  const document = { hidden: false, hasFocus: () => true, documentElement: { dataset: {}, classList: { toggle(name, on) { if (on) classes.add(name); else classes.delete(name); } } }, addEventListener(name, fn) { documentListeners[name] = fn; } };
  const contextNavigator = { getGamepads: () => [pad] };
  runInNewContext(source, { window, document, location, navigator: contextNavigator, requestAnimationFrame(fn) { frame = fn; }, CustomEvent: class { constructor(name, data) { this.detail = data.detail; } } });
  return { pad, actions, connections, window, document, classes, listeners, documentListeners, setPads(pads) { contextNavigator.getGamepads = () => pads; }, tick(time) { frame(time); } };
}

test('route changes switch layouts and require held buttons to release first', () => {
  const location = { pathname: '/' }, s = setup(location);
  s.window.YTGamepadInput.configure({ bindingLayouts: { browse: { confirm: 1, back: 0 }, watch: { confirm: 2, playPause: 0 } } });
  s.tick(0);
  s.pad.buttons[1].pressed = true; s.tick(16);
  assert.deepEqual(s.actions, ['confirm']);
  location.pathname = '/watch'; s.tick(32);
  assert.deepEqual(s.actions, ['confirm']);
  s.pad.buttons[1].pressed = false; s.tick(48);
  s.pad.buttons[2].pressed = true; s.tick(64);
  assert.deepEqual(s.actions, ['confirm', 'confirm']);
  s.pad.buttons[2].pressed = false; s.tick(80);
  s.pad.buttons[0].pressed = true; s.tick(96);
  assert.deepEqual(s.actions, ['confirm', 'confirm', 'playPause']);
  location.pathname = '/results'; s.tick(112);
  s.pad.buttons[0].pressed = false; s.tick(128);
  s.pad.buttons[0].pressed = true; s.tick(144);
  assert.deepEqual(s.actions, ['confirm', 'confirm', 'playPause', 'back']);
});

test('connection state is detected while disabled and only emits on changes', () => {
  const s = setup(); s.window.YTGamepadInput.configure({ enabled: false });
  s.tick(0); s.tick(16);
  assert.equal(s.window.YTGamepadInput.connected, true);
  s.pad.connected = false; s.tick(32);
  s.pad.connected = true; s.tick(48);
  assert.deepEqual(s.connections, [true, false, true]);
});
test('confirm fires once per press, then rearms on release', () => {
  const s = setup(); s.pad.buttons[0].pressed = true; s.tick(0); s.tick(16);
  assert.deepEqual(s.actions, ['confirm']);
  s.pad.buttons[0].pressed = false; s.tick(32); s.pad.buttons[0].pressed = true; s.tick(48);
  assert.deepEqual(s.actions, ['confirm', 'confirm']);
});

test('labels follow the active standard controller and fall back after disconnect', () => {
  const s = setup(); s.pad.id = 'Xbox Wireless Controller';
  const ps = { ...s.pad, id: 'DualSense Wireless Controller', index: 1, buttons: s.pad.buttons.map(() => ({ pressed: false })) };
  s.setPads([s.pad, ps]); s.tick(0);
  assert.equal(s.window.YTGamepadControllerStyle.family, 'xbox');
  ps.buttons[0].pressed = true; s.tick(16);
  assert.equal(s.window.YTGamepadControllerStyle.family, 'playstation');
  assert.deepEqual(s.actions, ['confirm']);
  s.pad.buttons[0].pressed = true; s.tick(24);
  assert.equal(s.window.YTGamepadControllerStyle.family, 'playstation');
  assert.deepEqual(s.actions, ['confirm']); // Two held pads must not alternate ownership.
  s.pad.buttons[0].pressed = false;
  ps.buttons[0].pressed = false; s.tick(32);
  assert.equal(s.window.YTGamepadControllerStyle.family, 'playstation');
  ps.connected = false; s.tick(48);
  assert.equal(s.window.YTGamepadControllerStyle.family, 'xbox');
  s.pad.connected = false; s.tick(64);
  assert.equal(s.window.YTGamepadControllerStyle.family, 'generic');
});
test('Y opens search once per press', () => {
  const s = setup(); s.pad.buttons[3].pressed = true; s.tick(0); s.tick(16);
  assert.deepEqual(s.actions, ['search']);
  s.pad.buttons[3].pressed = false; s.tick(32); s.pad.buttons[3].pressed = true; s.tick(48);
  assert.deepEqual(s.actions, ['search', 'search']);
});

test('deadzone and held direction repeat', () => {
  const s = setup(); s.pad.axes[0] = .2; s.tick(0); assert.equal(s.actions.length, 0);
  s.pad.axes[0] = .8; s.tick(10); s.tick(100); s.tick(360); s.tick(500);
  assert.deepEqual(s.actions, ['right', 'right', 'right']);
});
test('disabled input emits no actions', () => {
  const s = setup(); s.window.YTGamepadInput.configure({ enabled: false }); s.pad.buttons[0].pressed = true; s.tick(0);
  assert.deepEqual(s.actions, []);
});
test('nonstandard mapping is ignored', () => {
  const s = setup(); s.pad.mapping = ''; s.pad.buttons[0].pressed = true; s.tick(0);
  assert.deepEqual(s.actions, []);
});

test('only controller activity enters gamepad mode; real mouse motion restores mouse mode', () => {
  const s = setup(), active = () => s.classes.has('ytg-gamepad-input');
  s.tick(0); assert.equal(active(), false);
  s.pad.axes[0] = .8; s.tick(16); assert.equal(active(), true);
  const move = s.documentListeners.mousemove;
  move({ isTrusted: false, movementX: 10 }); assert.equal(active(), true);
  move({ isTrusted: true, clientX: 20, clientY: 30, movementX: 0, movementY: 0 }); assert.equal(active(), true);
  move({ isTrusted: true, clientX: 20, clientY: 30, movementX: 0, movementY: 0 }); assert.equal(active(), true);
  move({ isTrusted: true, clientX: 21, clientY: 30, movementX: 0, movementY: 0 }); assert.equal(active(), true);
  move({ isTrusted: true, clientX: 28, clientY: 30, movementX: 0, movementY: 0 }); assert.equal(active(), false);
  s.tick(400); assert.equal(active(), false); // Held stick cannot steal ownership back.
  s.pad.axes[0] = 0; s.tick(416); s.pad.axes[0] = .8; s.tick(432); assert.equal(active(), true);
  move({ isTrusted: true, clientX: 36, clientY: 30, movementX: 8, movementY: 0 }); assert.equal(active(), false);
});

test('disable, disconnect, blur and hidden page restore the mouse', () => {
  for (const release of [s => s.window.YTGamepadInput.configure({ enabled: false }), s => { s.pad.connected = false; s.tick(16); }, s => s.listeners.blur(), s => { s.document.hidden = true; s.documentListeners.visibilitychange(); }]) {
    const s = setup(); s.pad.buttons[0].pressed = true; s.tick(0);
    assert.equal(s.classes.has('ytg-gamepad-input'), true);
    release(s); assert.equal(s.classes.has('ytg-gamepad-input'), false);
  }
});

test('jitter does not accumulate into a switch; click, wheel and keyboard take ownership immediately', () => {
  const s = setup(); s.pad.buttons[0].pressed = true; s.tick(0);
  for (let i = 0; i < 30; i++) s.documentListeners.mousemove({ isTrusted: true, movementX: i % 2 ? -1 : 1, movementY: 0, timeStamp: i * 10, clientX: 0, clientY: 0 });
  assert.equal(s.window.YTGamepadInput.mode, 'gamepad');
  s.documentListeners.pointerdown({ isTrusted: true, pointerType: 'mouse' });
  assert.equal(s.window.YTGamepadInput.mode, 'mouse');
  s.tick(400); assert.equal(s.actions.length, 1);
  s.pad.buttons[0].pressed = false; s.tick(416); s.pad.buttons[0].pressed = true; s.tick(432);
  s.documentListeners.keydown({ isTrusted: true, key: 'Tab' }); assert.equal(s.window.YTGamepadInput.mode, 'keyboard');
  s.documentListeners.wheel({ isTrusted: true }); assert.equal(s.window.YTGamepadInput.mode, 'mouse');
});

test('analog hysteresis filters threshold chatter and navigation resets require a neutral controller', () => {
  const s = setup(); s.pad.axes[0] = .36; s.tick(0);
  s.pad.axes[0] = .34; s.tick(20); s.pad.axes[0] = .36; s.tick(40);
  assert.deepEqual(s.actions, ['right']);
  s.documentListeners['yt-navigate-start'](); s.tick(500);
  assert.equal(s.window.YTGamepadInput.mode, 'mouse'); assert.equal(s.actions.length, 1);
  s.pad.axes[0] = .1; s.tick(516); s.pad.axes[0] = .36; s.tick(532);
  assert.equal(s.window.YTGamepadInput.mode, 'gamepad'); assert.equal(s.actions.length, 2);
});

test('disconnect event releases immediately even before the polling snapshot updates', () => {
  const s = setup(); s.pad.axes[0] = .8; s.tick(0);
  s.listeners.gamepaddisconnected({ gamepad: { index: 0 } });
  assert.equal(s.window.YTGamepadInput.mode, 'mouse');
  s.tick(500);
  assert.deepEqual(s.actions, ['right']);
});

test('search shortcuts and held deletion are scoped to the search keyboard', () => {
  const s = setup();
  s.window.YTGamepadMenu = { opened: true, state: { view: 'search' } };
  s.pad.buttons[10].pressed = true; s.tick(0);
  s.pad.buttons[10].pressed = false; s.pad.buttons[11].pressed = true; s.tick(16);
  s.pad.buttons[11].pressed = false; s.pad.buttons[2].pressed = true; s.tick(32);
  s.tick(200); s.tick(382); s.tick(522);
  assert.deepEqual(s.actions, ['keyboardSymbols', 'keyboardCandidates', 'playPause', 'playPause', 'playPause']);
  s.window.YTGamepadMenu.opened = false; s.tick(700);
  assert.equal(s.actions.length, 5);
  s.pad.buttons[2].pressed = false; s.tick(716);
  s.pad.buttons[10].pressed = true; s.pad.buttons[11].pressed = true; s.tick(732);
  assert.equal(s.actions.length, 5);
});

test('custom bindings replace defaults and mapped search deletion repeats', () => {
  const s = setup();
  s.window.YTGamepadInput.configure({ bindings: { confirm: 2, playPause: 0, volumeUp: 8 } });
  s.tick(0);
  s.pad.buttons[2].pressed = true; s.tick(16);
  assert.deepEqual(s.actions, ['confirm']);
  s.pad.buttons[2].pressed = false; s.tick(32);
  s.pad.buttons[8].pressed = true; s.tick(48);
  assert.deepEqual(s.actions, ['confirm', 'volumeUp']);
  s.pad.buttons[8].pressed = false; s.tick(64);
  s.window.YTGamepadMenu = { opened: true, state: { view: 'search' } };
  s.pad.buttons[0].pressed = true; s.tick(80); s.tick(430); s.tick(570);
  assert.deepEqual(s.actions.slice(2), ['playPause', 'playPause', 'playPause']);
});

test('changing bindings while a button is held waits for release', () => {
  const s = setup(); s.pad.buttons[0].pressed = true; s.tick(0);
  s.window.YTGamepadInput.configure({ bindings: { confirm: 1, back: 0 } });
  s.tick(16); assert.deepEqual(s.actions, ['confirm']);
  s.pad.buttons[0].pressed = false; s.tick(32);
  s.pad.buttons[0].pressed = true; s.tick(48);
  assert.deepEqual(s.actions, ['confirm', 'back']);
});
