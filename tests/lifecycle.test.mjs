import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { moduleSource } from '../scripts/test-source.mjs';

function setup() {
  const tasks = new Map(), listeners = new Set(), warnings = [];
  let nextId = 0, disconnects = 0;
  const schedule = callback => { tasks.set(++nextId, callback); return nextId; };
  const window = {}, target = {
    addEventListener(type, fn) { listeners.add(fn); }, removeEventListener(type, fn) { listeners.delete(fn); }
  };
  runInNewContext(moduleSource('runtime.js'), { window,
    setTimeout: schedule, clearTimeout: id => tasks.delete(id), setInterval: schedule, clearInterval: id => tasks.delete(id),
    requestAnimationFrame: schedule, cancelAnimationFrame: id => tasks.delete(id),
    MutationObserver: class { observe() {} disconnect() { disconnects++; } },
    console: { warn(...args) { warnings.push(args); } }
  });
  return { runtime: window.YTGamepadRuntime, target, tasks, listeners, warnings, get disconnects() { return disconnects; } };
}

test('destroy cancels listeners, intervals, timeouts and frames, including queued callbacks', () => {
  const s = setup(), scope = s.runtime.scope('view');
  let calls = 0;
  scope.listen(s.target, 'change', () => calls++);
  scope.interval(() => calls++, 500); scope.timeout(() => calls++, 100); scope.frame(() => calls++);
  const observer = scope.observer(() => calls++); observer.observe({}, {});
  const stale = [...s.listeners, ...s.tasks.values()];
  scope.destroy(); scope.destroy(); stale.forEach(callback => callback(0));
  assert.equal(calls, 0); assert.equal(s.tasks.size, 0); assert.equal(s.listeners.size, 0);
  assert.equal(s.disconnects, 1); assert.deepEqual(Object.keys(s.runtime.resources), []);
});

test('completed work is released and observer disconnect/reobserve does not accumulate resources', () => {
  const s = setup(), scope = s.runtime.scope('view');
  for (let i = 0; i < 100; i++) {
    const id = scope.timeout(() => {}, 10); s.tasks.get(id)();
    assert.equal(scope.size, 0);
  }
  const observer = scope.observer(() => {});
  observer.observe({}, {}); observer.disconnect(); assert.equal(scope.size, 0);
  observer.observe({}, {}); assert.equal(scope.size, 1);
  scope.destroy(); assert.equal(s.disconnects, 2);
});

test('replacing a scope disables its old callbacks and cleanup continues after one failure', () => {
  const s = setup(), old = s.runtime.scope('view');
  let calls = 0, cleaned = 0;
  old.listen(s.target, 'click', () => calls++);
  const stale = [...s.listeners][0];
  old.cleanup(() => cleaned++); old.cleanup(() => { throw new Error('partial view failure'); });
  const next = s.runtime.scope('view'); stale();
  assert.equal(old.destroyed, true); assert.equal(calls, 0); assert.equal(cleaned, 1); assert.equal(s.warnings.length, 1);
  next.listen(s.target, 'click', () => calls++); [...s.listeners][0](); assert.equal(calls, 1);
  s.runtime.destroy(); assert.equal(s.listeners.size, 0);
});

test('route disposal preserves a later site wrapper and makes a retained wrapper inert', () => {
  const s = setup(), window = { YTGamepadRuntime: s.runtime };
  const location = { pathname: '/', search: '', origin: 'https://www.youtube.com' };
  let calls = 0;
  const history = { pushState() { calls++; assert.equal(this, history); } };
  const original = history.pushState;
  runInNewContext(moduleSource('app/route-controller.js'), { window, URL });
  const interaction = window.YTGamepadStateMachine.createStore();
  const routes = window.YTGamepadRouteController.create({ interaction, location, history, window: s.target, document: s.target,
    routeNow: () => '/', enabled: () => true, renderMode() {}, onStart() {}, hasTemporaryLayer: () => false
  });
  routes.start(); const retained = history.pushState;
  const siteWrapper = function (...args) { return retained.apply(this, args); }; history.pushState = siteWrapper;
  routes.destroy(); const state = interaction.state; history.pushState({}, '', '/');
  assert.equal(history.pushState, siteWrapper); assert.equal(calls, 1); assert.equal(interaction.state, state);
  assert.notEqual(retained, original);
});
