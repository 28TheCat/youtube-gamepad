import { moduleSource } from '../scripts/test-source.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

function setup() {
  const window = {}, location = { pathname: '/watch', search: '?v=123' }, applied = [];
  let keys = ['a', 'b', 'c', 'd'];
  runInNewContext(moduleSource('focus.js'), { window, location });
  const focus = window.YTGamepadFocus;
  focus.register('watch', {
    active: () => location.pathname === '/watch',
    capture: () => ({ region: 'recommendations', itemKey: 'b', index: 1 }),
    items: region => region === 'recommendations' ? keys.map(itemKey => ({ region, itemKey })) : [],
    fallback: () => ({ region: 'controls', itemKey: 'playPause' }),
    apply: target => applied.push(target)
  });
  return { focus, location, applied, reorder(value) { keys = value; } };
}

test('reordered recommendations restore by video ID exactly once', () => {
  const s = setup(); s.focus.open('menu'); s.reorder(['d', 'a', 'c', 'b']);
  s.focus.close('menu'); s.focus.close('menu');
  assert.equal(s.applied.length, 1); assert.equal(s.applied[0].itemKey, 'b');
});
test('deleted target selects its surviving neighbor before the index fallback', () => {
  const s = setup(); s.focus.open('menu'); s.reorder(['c', 'd', 'a']); s.focus.close('menu');
  assert.equal(s.applied[0].itemKey, 'c');
});
test('empty recommendation region returns to controls', () => {
  const s = setup(); s.focus.open('menu'); s.reorder([]); s.focus.close('menu');
  assert.equal(s.applied[0].region, 'controls');
});
test('route changes discard old watch target and use the active page rule', () => {
  const s = setup();
  s.focus.register('browse', { active: () => s.location.pathname !== '/watch', capture: () => null,
    items: () => [], fallback: () => ({ itemKey: 'new-page' }), apply: target => s.applied.push(target) });
  s.focus.open('menu'); s.location.pathname = '/results'; s.focus.close('menu');
  assert.equal(s.applied[0].itemKey, 'new-page');
});
test('closing a lower native scope cannot steal focus from the menu above it', () => {
  const s = setup(); s.focus.open('native');
  s.focus.register('core', { active: () => true, capture: () => ({ region: 'overlay', itemKey: 'quality', scope: 'native' }),
    items: () => [{ itemKey: 'quality' }], fallback: () => null, apply: target => s.applied.push(target) });
  s.focus.open('menu'); s.focus.close('native'); assert.equal(s.applied.length, 0);
  s.focus.close('menu'); assert.equal(s.applied[0].itemKey, 'b');
});
test('closing a layer restores its parent without applying a background refresh', () => {
  const s = setup(); s.focus.open('panel'); s.focus.open('menu'); s.focus.restore(s.focus.capture());
  assert.equal(s.applied.length, 0); s.focus.close('menu'); assert.equal(s.applied.length, 1);
});

test('priority layers suspend late native scopes and release them before restoration', () => {
  const s = setup(), attributes = new Map();
  const native = { isConnected: true, contains: () => false,
    getAttribute: key => attributes.get(key) ?? null,
    setAttribute: (key, value) => attributes.set(key, value), removeAttribute: key => attributes.delete(key) };
  s.focus.open('menu', 'watch', 100);
  s.focus.open(native, 'watch');
  assert.equal(attributes.has('inert'), true);
  assert.equal(s.focus.isSuspendedScope(native), true);
  s.focus.close('menu');
  assert.equal(attributes.has('inert'), false);
  assert.equal(s.focus.isSuspendedScope(native), false);
  assert.equal(s.applied.length, 1);
  assert.equal(s.focus.suspended, true);
  s.focus.close(native);
  assert.equal(s.focus.suspended, false);
});

test('priority focus protection preserves an existing inert attribute', () => {
  const s = setup(), attributes = new Map([['inert', 'original']]);
  const native = { isConnected: true, contains: () => false,
    getAttribute: key => attributes.get(key) ?? null,
    setAttribute: (key, value) => attributes.set(key, value), removeAttribute: key => attributes.delete(key) };
  s.focus.open(native, 'watch'); s.focus.open('menu', 'watch', 100);
  assert.equal(s.focus.isSuspendedScope(native), false);
  s.focus.close('menu'); s.focus.close(native);
  assert.equal(attributes.get('inert'), 'original');
});
