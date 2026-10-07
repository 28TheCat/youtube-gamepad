import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moduleSource } from '../scripts/test-source.mjs';
import { runInNewContext } from 'node:vm';

function setup() {
  const window = {};
  runInNewContext(moduleSource('bindings.js'), { window });
  return window;
}

test('catalog exposes functions without requiring or assigning physical buttons', () => {
  const { YTGamepadActions: actions, YTGamepadBindings: bindings } = setup();
  for (const id of ['mute', 'comments', 'like', 'dislike', 'subscribe', 'save', 'description', 'settings']) {
    assert.ok(actions.list({ context: 'watch' }).some(action => action.id === id));
    assert.equal(bindings.defaults[id], undefined);
  }
  for (const id of Object.keys(bindings.defaults)) assert.equal(bindings.labels[id], actions.get(id).label);
  assert.equal(actions.get('constructor'), undefined);
  assert.equal(actions.get('unknown'), undefined);
});

test('search filtering excludes player operations and public listing hides internal pause', () => {
  const actions = setup().YTGamepadActions;
  const search = actions.list({ context: 'search' });
  assert.ok(search.some(action => action.id === 'back'));
  assert.ok(search.some(action => action.id === 'keyboardSymbols'));
  assert.ok(search.every(action => action.target !== 'media' && action.target !== 'watchAction'));
  assert.ok(!actions.list().some(action => action.id === 'pause'));
  assert.ok(actions.list({ includeInternal: true }).some(action => action.id === 'pause'));
});

test('catalog consumers cannot mutate shared defaults or context permissions', () => {
  const actions = setup().YTGamepadActions;
  assert.throws(() => { actions.get('seekForward').parameter.default = 30; }, TypeError);
  assert.throws(() => { actions.get('like').contexts.push('search'); });
  actions.list().pop();
  assert.ok(actions.get('keyboardCandidates'));
});
