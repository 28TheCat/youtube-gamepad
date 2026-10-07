import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const window = {};
for (const file of ['actions.js', 'bindings.js']) runInNewContext(readFileSync(new URL('../' + file, import.meta.url), 'utf8'), { window });
const schema = window.YTGamepadBindings;

test('bindings ignore unknown actions, invalid positions and duplicates', () => {
  const values = schema.normalize({ confirm: 3, back: 3, search: 99, help: '9', arbitrary: 2 });
  assert.equal(values.confirm, 3);
  assert.equal(new Set(Object.values(values)).size, Object.keys(schema.defaults).length);
  assert.equal(values.arbitrary, undefined);
  assert.ok(Object.values(values).every(button => Number.isInteger(button) && button >= 0 && button <= 11));
});

test('complete swapped bindings and reset defaults round trip', () => {
  const values = { ...schema.defaults, confirm: 1, back: 0 };
  assert.deepEqual({ ...schema.normalize(values) }, values);
  assert.deepEqual({ ...schema.normalize(null) }, { ...schema.defaults });
});

test('legacy bindings seed both layouts, which normalize independently', () => {
  const layouts = schema.normalizeLayouts({ watch: { confirm: 2, playPause: 0 }, browse: { confirm: 1, back: 0, secret: 5 } });
  assert.equal(layouts.watch.confirm, 2);
  assert.equal(layouts.browse.confirm, 1);
  assert.equal(layouts.browse.secret, undefined);
  assert.equal(new Set(Object.values(layouts.browse)).size, Object.keys(schema.defaults).length);
  const migrated = schema.normalizeLayouts(null, { confirm: 1, back: 0 });
  assert.equal(migrated.watch.confirm, 1);
  assert.equal(migrated.browse.confirm, 1);
  migrated.watch.confirm = 2;
  assert.equal(migrated.browse.confirm, 1);
});
