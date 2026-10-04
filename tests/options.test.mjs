import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

async function setup(stored) {
  const fields = {}, writes = [];
  for (const key of ['enabled', 'theater', 'autoFullscreen', 'deadzone', 'repeatDelay', 'repeatInterval', 'status', 'deadzoneValue', 'fieldset', 'form']) {
    fields[key] = { type: ['enabled', 'theater', 'autoFullscreen'].includes(key) ? 'checkbox' : 'number', valid: true,
      handlers: {}, addEventListener(name, fn) { this.handlers[name] = fn; }, checkValidity() { return this.valid; }, reportValidity() {} };
  }
  let changed;
  const chrome = { storage: { local: {
    async get(defaults) { return { ...defaults, ...stored }; },
    async set(values) { writes.push(structuredClone(values)); Object.assign(stored, values); }
  }, onChanged: { addListener(fn) { changed = fn; } } } };
  runInNewContext(readFileSync(new URL('../options.js', import.meta.url), 'utf8'), {
    chrome, document: { getElementById: key => fields[key], querySelector: selector => fields[selector.replace('#', '')] }
  });
  await new Promise(resolve => setImmediate(resolve));
  return { fields, writes, stored, changed };
}

test('legacy combined preference initializes independent fullscreen without changing layout', async () => {
  const s = await setup({ theater: false });
  assert.equal(s.fields.autoFullscreen.checked, false);
  assert.deepEqual(s.writes, [{ autoFullscreen: false }]);
  s.fields.theater.checked = true;
  await s.fields.theater.handlers.change();
  assert.equal(s.stored.theater, true);
  assert.equal(s.stored.autoFullscreen, false);
});

test('existing fullscreen preference survives opening options and other field writes', async () => {
  const s = await setup({ theater: false, autoFullscreen: true });
  assert.equal(s.fields.autoFullscreen.checked, true);
  assert.equal(s.writes.length, 0);
  s.fields.repeatInterval.value = '200';
  await s.fields.repeatInterval.handlers.change();
  assert.deepEqual(s.writes, [{ repeatInterval: 200 }]);
  assert.equal(s.stored.autoFullscreen, true);
});

test('invalid fields are not persisted; external enabled changes update the settings page', async () => {
  const s = await setup({ autoFullscreen: true });
  s.fields.repeatInterval.valid = false;
  await s.fields.repeatInterval.handlers.change();
  assert.equal(s.writes.length, 0);
  assert.match(s.fields.status.textContent, /有效数值/);
  s.changed({ enabled: { newValue: false } }, 'local');
  assert.equal(s.fields.enabled.checked, false);
});
