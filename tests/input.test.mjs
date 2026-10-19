import { moduleSource } from '../scripts/test-source.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const source = moduleSource('src/input/gamepad.ts');
function setup(location = { pathname: '/' }, temporarySpeed, canRepeatMedia) {
  const actions = [], ends = [], connections = [], listeners = {}, documentListeners = {}, classes = new Set(), pad = { index: 0, connected: true, mapping: 'standard', axes: [0, 0], buttons: Array.from({ length: 16 }, () => ({ pressed: false })) };
  let frame, currentTime = 0;
  const keyListeners = [];
  const window = { dispatchEvent(e) { if (e.type === 'yt-gamepad-button-end') ends.push({ ...e.detail }); else if ('connected' in e.detail) connections.push(e.detail.connected); else if (e.detail.action) actions.push(e.detail.action); }, addEventListener(name, fn) { listeners[name] = fn; if (name === 'keydown') keyListeners.push(fn); } };
  const document = { hidden: false, hasFocus: () => true, documentElement: { dataset: {}, classList: { toggle(name, on) { if (on) classes.add(name); else classes.delete(name); } } }, addEventListener(name, fn) { documentListeners[name] = fn; } };
  const contextNavigator = { getGamepads: () => [pad] };
  runInNewContext(source, { window, document, location, performance: { now: () => currentTime }, navigator: contextNavigator, requestAnimationFrame(fn) { frame = fn; }, CustomEvent: class { constructor(name, data) { this.type = name; this.detail = data.detail; } } });
  if (temporarySpeed || canRepeatMedia) window.YTGamepadInputModule.create({ runtime: window.YTGamepadRuntime, controllerStyle: window.YTGamepadControllerStyle,
    isSearchOpen: () => !!(window.YTGamepadMenu?.opened && window.YTGamepadMenu.state.view === 'search'), temporarySpeed, canRepeatMedia });
  return { pad, actions, ends, connections, window, document, classes, listeners, documentListeners,
    key(key, values = {}) {
      const event = { key, isTrusted: true, defaultPrevented: false, stopped: false,
        preventDefault() { this.defaultPrevented = true; }, stopImmediatePropagation() { this.stopped = true; }, ...values };
      for (const listener of keyListeners) { listener(event); if (event.stopped) break; }
      return event;
    }, setPads(pads) { contextNavigator.getGamepads = () => pads; }, tick(time) { currentTime = time; frame(time); } };
}

test('playback seeking and volume repeat with configured timing and end once on release', () => {
  for (const [button, action] of [[4, 'seekBack'], [5, 'seekForward'], [6, 'volumeDown'], [7, 'volumeUp']]) {
    const s = setup({ pathname: '/watch' });
    s.window.YTGamepadInput.configure({ repeatDelay: 500, repeatInterval: 200 }); s.tick(0);
    s.pad.buttons[button].pressed = true; s.tick(10); s.tick(509);
    assert.deepEqual(s.actions, [action]); assert.equal(s.window.YTGamepadInput.isHeld(action), true);
    s.tick(510); s.tick(709); s.tick(710);
    assert.deepEqual(s.actions, [action, action, action]);
    s.pad.buttons[button].pressed = false; s.tick(720); s.tick(1000);
    assert.deepEqual(s.ends, [{ action, cancelled: false }]);
    assert.equal(s.window.YTGamepadInput.isHeld(action), false);
  }
});

test('playback hold follows remapping while confirm, back, pause and menu remain once per press', () => {
  const s = setup({ pathname: '/watch' });
  s.window.YTGamepadInput.configure({ bindings: { seekForward: 8 } }); s.tick(0);
  s.pad.buttons[8].pressed = true; s.tick(10); s.tick(360);
  assert.deepEqual(s.actions, ['seekForward', 'seekForward']);
  s.pad.buttons[8].pressed = false; s.tick(400);
  for (const [button, action] of [[0, 'confirm'], [1, 'back'], [2, 'playPause'], [9, 'help']]) {
    const start = s.actions.length;
    s.pad.buttons[button].pressed = true; s.tick(1000); s.tick(2000); s.tick(3000);
    assert.deepEqual(s.actions.slice(start), [action]);
    s.pad.buttons[button].pressed = false; s.tick(3100);
  }
});

test('browsing shoulder buttons do not repeat category changes', () => {
  const s = setup(); s.pad.buttons[5].pressed = true; s.tick(0); s.tick(500); s.tick(1000);
  assert.deepEqual(s.actions, ['seekForward']); assert.deepEqual(s.ends, []);
});

test('Shorts select watch bindings and repeat playback media actions', () => {
  const s = setup({ pathname: '/shorts/JnICtQ9VHJ8' });
  s.window.YTGamepadInput.configure({ bindingLayouts: { watch: { seekForward: 8 }, browse: { seekForward: 5 } } });
  s.tick(0); s.pad.buttons[8].pressed = true; s.tick(10); s.tick(360);
  assert.deepEqual(s.actions, ['seekForward', 'seekForward']);
  s.pad.buttons[8].pressed = false; s.tick(400);
  assert.equal(s.window.YTGamepadInput.isHeld('seekForward'), false);
});

test('page shortcuts override physical buttons, switch by layout and yield to settings navigation', () => {
  const route = { pathname: '/watch' }, s = setup(route);
  let settingsOpen = false;
  s.document.querySelector = () => ({ hasAttribute: () => settingsOpen });
  s.window.YTGamepadInput.configure({ shortcutLayouts: { watch: { X: 'm', Select: 'c' }, browse: { X: ' ' } } });
  s.tick(0);
  s.pad.buttons[2].pressed = true; s.tick(10);
  assert.equal(s.actions.at(-1), 'mute');
  s.pad.buttons[2].pressed = false; s.tick(20);
  s.pad.buttons[8].pressed = true; s.tick(30);
  assert.equal(s.actions.at(-1), 'captions');
  s.pad.buttons[8].pressed = false; s.tick(40);
  settingsOpen = true;
  s.pad.buttons[2].pressed = true; s.tick(50);
  assert.equal(s.actions.at(-1), 'playPause');
  s.pad.buttons[2].pressed = false; s.tick(60);
  settingsOpen = false; route.pathname = '/'; s.tick(70);
  s.pad.buttons[2].pressed = true; s.tick(80);
  assert.equal(s.actions.at(-1), 'playPause');
});

test('a new layer cancels a media hold and closing it cannot resume the held button', () => {
  let allowed = true;
  const s = setup({ pathname: '/watch' }, undefined, () => allowed);
  s.pad.buttons[5].pressed = true; s.tick(0); allowed = false; s.tick(100);
  assert.deepEqual(s.ends, [{ action: 'seekForward', cancelled: true }]);
  allowed = true; s.tick(1000); assert.deepEqual(s.actions, ['seekForward']);
  s.pad.buttons[5].pressed = false; s.tick(1100);
  s.pad.buttons[5].pressed = true; s.tick(1200); s.tick(1550);
  assert.deepEqual(s.actions, ['seekForward', 'seekForward', 'seekForward']);
});

test('interruption cancels pending media input immediately and requires a fresh press', () => {
  for (const cancel of [
    s => s.listeners.blur(), s => s.documentListeners.pointerdown({ isTrusted: true, pointerType: 'mouse' }),
    s => s.documentListeners['yt-navigate-start'](), s => s.window.YTGamepadInput.configure({ enabled: false }),
    s => s.listeners.gamepaddisconnected({ gamepad: { index: 0 } }), s => s.window.YTGamepadInput.destroy(),
    s => { s.pad.buttons[1].pressed = true; s.tick(100); }
  ]) {
    const s = setup({ pathname: '/watch' }); s.pad.buttons[5].pressed = true; s.tick(0);
    cancel(s); s.tick(500);
    assert.deepEqual(s.ends, [{ action: 'seekForward', cancelled: true }]);
    assert.equal(s.actions.filter(action => action === 'seekForward').length, 1);
  }
});

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

test('R3 requires a hold and releases temporary speed immediately', () => {
  const calls = [], s = setup({ pathname: '/watch' }, held => { calls.push(held); return held; });
  s.tick(0); s.pad.buttons[11].pressed = true; s.tick(10); s.tick(359);
  assert.deepEqual(calls, []);
  s.tick(360); assert.deepEqual(calls, [true]);
  s.pad.buttons[11].pressed = false; s.tick(370);
  assert.deepEqual(calls, [true, false]); assert.deepEqual(s.actions, []);
});

test('cancelled speed cannot restart until R3 is released, including after closing search', () => {
  const calls = []; let allowed = true;
  const s = setup({ pathname: '/watch' }, held => { calls.push(held); return held && allowed; });
  s.pad.buttons[11].pressed = true; s.tick(0); s.tick(350);
  allowed = false; s.tick(366); allowed = true; s.tick(700);
  assert.deepEqual(calls, [true, true, false]);
  s.pad.buttons[11].pressed = false; s.tick(716);
  s.window.YTGamepadMenu = { opened: true, state: { view: 'search' } };
  s.pad.buttons[11].pressed = true; s.tick(732); s.tick(1200);
  assert.equal(s.actions.at(-1), 'keyboardCandidates');
  s.window.YTGamepadMenu.opened = false; s.tick(1600);
  assert.deepEqual(calls, [true, true, false]);
  s.pad.buttons[11].pressed = false; s.tick(1616);
  s.pad.buttons[11].pressed = true; s.tick(1632); s.tick(1982);
  assert.equal(calls.at(-1), true);
});

test('R3 speed is cancelled by other actions, blur, disconnect, disabling and destruction', () => {
  for (const cancel of [s => { s.pad.buttons[9].pressed = true; s.tick(400); },
    s => s.listeners.blur(), s => s.listeners.gamepaddisconnected({ gamepad: s.pad }),
    s => s.window.YTGamepadInput.configure({ enabled: false }), s => s.window.YTGamepadInput.destroy()]) {
    const calls = [], s = setup({ pathname: '/watch' }, held => { calls.push(held); return held; });
    s.pad.buttons[11].pressed = true; s.tick(0); s.tick(350); cancel(s);
    assert.equal(calls.at(-1), false);
  }
});

test('R3 speed respects custom playback bindings and is inactive while browsing', () => {
  const calls = [], s = setup({ pathname: '/watch' }, held => { calls.push(held); return held; });
  s.window.YTGamepadInput.configure({ bindings: { help: 11 } }); s.tick(0);
  s.pad.buttons[11].pressed = true; s.tick(16); s.tick(500);
  assert.deepEqual(s.actions, ['help']); assert.deepEqual(calls, []);
  const browse = setup({ pathname: '/' }, held => { calls.push(held); return held; });
  browse.pad.buttons[11].pressed = true; browse.tick(0); browse.tick(500);
  assert.deepEqual(calls, []);
});

test('an R3 hold cannot cross video routes even before the hold threshold', () => {
  const calls = [], location = { pathname: '/watch', search: '?v=first' };
  const s = setup(location, held => { calls.push(held); return held; });
  s.pad.buttons[11].pressed = true; s.tick(0);
  location.search = '?v=next'; s.tick(200); s.tick(500);
  assert.deepEqual(calls, [false]);
  s.pad.buttons[11].pressed = false; s.tick(516);
  s.pad.buttons[11].pressed = true; s.tick(532); s.tick(882);
  assert.equal(calls.at(-1), true);
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
  move({ isTrusted: true, clientX: 28, clientY: 30, movementX: 0, movementY: 0 }); assert.equal(active(), true);
  move({ isTrusted: true, clientX: 44, clientY: 30, movementX: 0, movementY: 0 }); assert.equal(active(), false);
  s.tick(400); assert.equal(active(), false); // Held stick cannot steal ownership back.
  s.pad.axes[0] = 0; s.tick(416); s.pad.axes[0] = .8; s.tick(432); assert.equal(active(), true);
  move({ isTrusted: true, clientX: 68, clientY: 30, movementX: 24, movementY: 0 }); assert.equal(active(), false);
});

test('disable and disconnect restore the mouse', () => {
  for (const release of [s => s.window.YTGamepadInput.configure({ enabled: false }), s => { s.pad.connected = false; s.tick(16); }]) {
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

test('route, focus and visibility interruptions preserve hints but cancel held input until neutral', () => {
  for (const interrupt of [s => s.listeners.blur(), s => s.listeners.popstate(), s => s.listeners.pagehide(),
    s => s.documentListeners['yt-navigate-start'](), s => s.documentListeners['yt-navigate-finish'](),
    s => { s.document.hidden = true; s.documentListeners.visibilitychange(); s.document.hidden = false; }]) {
    const s = setup(); s.pad.axes[0] = .8; s.tick(0);
    interrupt(s); s.tick(500);
    assert.equal(s.window.YTGamepadInput.mode, 'gamepad');
    assert.equal(s.actions.length, 1);
    s.pad.axes[0] = 0; s.tick(516); s.pad.axes[0] = .8; s.tick(532);
    assert.equal(s.actions.length, 2);
    s.key('Tab'); s.documentListeners.keydown({ isTrusted: true, key: 'Tab' });
    interrupt(s); assert.equal(s.window.YTGamepadInput.mode, 'keyboard');
  }
});

test('matching keyboard echoes do not change controller prompts or duplicate actions; deliberate keyboard input still works', () => {
  const s = setup(); s.pad.buttons[0].pressed = true; s.tick(0);
  const echo = s.key('Enter');
  assert.equal(echo.defaultPrevented, true);
  assert.equal(s.window.YTGamepadInput.mode, 'gamepad');
  assert.deepEqual(s.actions, ['confirm']);
  assert.equal(s.window.YTGamepadInput.recentSources.at(-1).source, 'keyboard-echo');
  assert.equal(s.window.YTGamepadInput.recentSources.at(-1).decision, 'ignored');
  s.tick(201); s.key('Enter');
  assert.equal(s.window.YTGamepadInput.mode, 'keyboard');
  assert.deepEqual(s.actions, ['confirm', 'confirm']);
});

test('search typing and editable fields immediately own keyboard input despite recent controller actions', () => {
  const s = setup(); s.pad.buttons[0].pressed = true; s.tick(0);
  const enter = s.key('Enter', { target: { closest: () => ({}) } });
  s.documentListeners.keydown(enter);
  assert.equal(enter.defaultPrevented, false);
  assert.equal(s.window.YTGamepadInput.mode, 'keyboard');
  s.pad.buttons[0].pressed = false; s.tick(16); s.pad.buttons[0].pressed = true; s.tick(32);
  s.window.YTGamepadMenu = { opened: true, state: { view: 'search' } };
  const typed = s.key('K'); s.documentListeners.keydown(typed);
  assert.equal(typed.defaultPrevented, false);
  assert.equal(s.window.YTGamepadInput.mode, 'keyboard');
  assert.equal(JSON.stringify(s.window.YTGamepadInput.recentSources).includes('"K"'), false, 'source traces contain no typed text');
});

test('small mouse movements cannot chain across gesture windows and explicit mouse actions always take over', () => {
  const s = setup(); s.pad.buttons[0].pressed = true; s.tick(0);
  const move = (x, timeStamp) => s.documentListeners.mousemove({ isTrusted: true, movementX: x, movementY: 0, clientX: 0, clientY: 0, timeStamp });
  for (let i = 0; i < 20; i++) move(2, 300 * i);
  assert.equal(s.window.YTGamepadInput.mode, 'gamepad');
  move(22, 5710);
  assert.equal(s.window.YTGamepadInput.mode, 'mouse');
  assert.equal(s.window.YTGamepadInput.recentSources.at(-1).source, 'mouse-move');
  for (let i = 0; i < 40; i++) s.documentListeners.wheel({ isTrusted: true });
  assert.equal(s.window.YTGamepadInput.recentSources.length, 32);
  const snapshot = s.window.YTGamepadInput.recentSources; snapshot[0].source = 'changed';
  assert.notEqual(s.window.YTGamepadInput.recentSources[0].source, 'changed');
});

test('analog hysteresis filters threshold chatter and navigation resets require a neutral controller', () => {
  const s = setup(); s.pad.axes[0] = .36; s.tick(0);
  s.pad.axes[0] = .34; s.tick(20); s.pad.axes[0] = .36; s.tick(40);
  assert.deepEqual(s.actions, ['right']);
  s.documentListeners['yt-navigate-start'](); s.tick(500);
  assert.equal(s.window.YTGamepadInput.mode, 'gamepad'); assert.equal(s.actions.length, 1);
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
  s.tick(180); s.tick(182); s.tick(262);
  assert.deepEqual(s.actions, ['keyboardSymbols', 'keyboardCandidates', 'playPause', 'playPause', 'playPause']);
  s.window.YTGamepadMenu.opened = false; s.tick(700);
  assert.equal(s.actions.length, 5);
  s.pad.buttons[2].pressed = false; s.tick(716);
  s.pad.buttons[10].pressed = true; s.pad.buttons[11].pressed = true; s.tick(732);
  assert.equal(s.actions.length, 5);
});

test('Shorts queue navigation keeps a held direction across in-place route events', () => {
  const s = setup({ pathname: '/watch' });
  s.tick(0); s.pad.buttons[13].pressed = true; s.tick(10);
  s.document.documentElement.dataset.ytgShortsSwitching = '';
  s.documentListeners['yt-navigate-start'](); s.tick(160);
  s.documentListeners['yt-navigate-finish'](); s.tick(240);
  assert.deepEqual(s.actions, ['down', 'down', 'down']);
  delete s.document.documentElement.dataset.ytgShortsSwitching;
  s.documentListeners['yt-navigate-start'](); s.tick(400);
  assert.equal(s.actions.length, 3, 'ordinary navigation still requires neutral');
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


test('right-hand preset navigates with the right stick, repeats, and ignores the left stick', () => {
  const s = setup(); s.window.YTGamepadInput.configure({ rightHandMode: true }); s.tick(0);
  s.pad.axes = [.9, 0, .2, 0]; s.tick(16); assert.deepEqual(s.actions, []);
  s.pad.axes[2] = .8; s.tick(32); s.tick(382); s.tick(522);
  assert.deepEqual(s.actions, ['right', 'right', 'right']);
  s.pad.axes[2] = 0; s.pad.axes[3] = -.8; s.tick(540);
  assert.equal(s.actions.at(-1), 'up');
});

test('right-hand preset uses right-side basics and restores each custom layout when disabled', () => {
  const location = { pathname: '/' }, s = setup(location);
  const bindingLayouts = { browse: { confirm: 1, back: 0 }, watch: { confirm: 2, playPause: 0 } };
  s.window.YTGamepadInput.configure({ rightHandMode: true, bindingLayouts }); s.tick(0);
  let time = 16;
  for (const button of [0, 1, 2, 3, 5]) {
    s.pad.buttons[button].pressed = true; s.tick(time); time += 16;
    s.pad.buttons[button].pressed = false; s.tick(time); time += 16;
  }
  assert.deepEqual(s.actions, ['confirm', 'back', 'playPause', 'search', 'help']);
  s.window.YTGamepadInput.configure({ rightHandMode: false, bindingLayouts }); s.tick(time += 16);
  s.pad.buttons[1].pressed = true; s.tick(time += 16); assert.equal(s.actions.at(-1), 'confirm');
  location.pathname = '/watch'; s.tick(time += 16);
  s.pad.buttons[1].pressed = false; s.tick(time += 16);
  s.pad.buttons[2].pressed = true; s.tick(time += 16); assert.equal(s.actions.at(-1), 'confirm');
});

test('right stick must return to neutral after enabling, blur, and route changes', () => {
  const location = { pathname: '/' }, s = setup(location);
  s.pad.axes = [0, 0, .8, 0]; s.window.YTGamepadInput.configure({ rightHandMode: true }); s.tick(0);
  assert.deepEqual(s.actions, []);
  s.pad.axes[2] = 0; s.tick(16); s.pad.axes[2] = .8; s.tick(32);
  s.listeners.blur(); s.tick(500); assert.deepEqual(s.actions, ['right']);
  s.pad.axes[2] = 0; s.tick(516); s.pad.axes[2] = .8; s.tick(532);
  location.pathname = '/watch'; s.tick(1000); assert.deepEqual(s.actions, ['right', 'right']);
  s.pad.axes[2] = 0; s.tick(1016); s.pad.axes[2] = .8; s.tick(1032);
  assert.deepEqual(s.actions, ['right', 'right', 'right']);
});

test('default mode ignores right stick activity and right-hand preset tolerates missing axes', () => {
  const s = setup(); s.pad.axes = [0, 0, .9, 0]; s.tick(0); assert.deepEqual(s.actions, []);
  s.window.YTGamepadInput.configure({ rightHandMode: true }); s.pad.axes = [0, 0]; s.tick(16);
  s.pad.buttons[13].pressed = true; s.tick(32); assert.deepEqual(s.actions, ['down']);
});

test('keyboard uses shared actions without a controller and never double fires repeated confirmation', () => {
  const s = setup(); s.setPads([]); s.tick(0);
  for (const key of ['ArrowRight', 'Enter', ' ', '/', 'F1', 'PageDown', 'Escape']) {
    assert.equal(s.key(key).defaultPrevented, true);
  }
  assert.deepEqual(s.actions, ['right', 'confirm', 'playPause', 'search', 'help', 'seekForward', 'back']);
  assert.equal(s.window.YTGamepadInput.mode, 'keyboard');
  s.key('Enter', { repeat: true }); s.key('ArrowRight', { repeat: true });
  assert.deepEqual(s.actions.slice(7), ['right']);
});

test('physical typing, IME, modified shortcuts and native widgets retain their keys', () => {
  const s = setup();
  for (const values of [{ isComposing: true }, { ctrlKey: true }, { altKey: true }, { metaKey: true },
    { isTrusted: false }, { target: { isContentEditable: true } },
    { composedPath: () => [{ closest: () => ({}) }], target: { id: 'shadow-host' } }]) {
    assert.equal(s.key('ArrowLeft', values).defaultPrevented, false);
  }
  s.window.YTGamepadMenu = { opened: true, state: { view: 'search' } };
  assert.equal(s.key(' ').defaultPrevented, false);
  assert.equal(s.key('/').defaultPrevented, false);
  s.window.YTGamepadInput.configure({ enabled: false });
  assert.equal(s.key('Enter').defaultPrevented, false);
  assert.equal(s.key('Escape').defaultPrevented, false);
  assert.deepEqual(s.actions, []);
});

test('disconnect cancels controller holds but immediately permits keyboard takeover', () => {
  const s = setup({ pathname: '/watch' });
  s.pad.buttons[5].pressed = true; s.tick(0);
  s.setPads([]); s.tick(16);
  s.key('ArrowDown');
  assert.deepEqual(s.ends, [{ action: 'seekForward', cancelled: true }]);
  assert.deepEqual(s.actions, ['seekForward', 'down']);
});

test('right click returns only within a custom surface', () => {
  const s = setup();
  const event = id => ({ isTrusted: true, composedPath: () => [{ id }],
    preventDefault() {}, stopImmediatePropagation() {} });
  s.documentListeners.contextmenu(event('movie_player'));
  assert.deepEqual(s.actions, []);
  s.documentListeners.contextmenu(event('ytg-browse-root'));
  assert.deepEqual(s.actions, ['back']);
});
