import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

async function setup(stored, hash = '') {
  const fields = {}, writes = [];
  for (const key of ['enabled', 'theater', 'autoFullscreen', 'deadzone', 'repeatDelay', 'repeatInterval', 'status', 'deadzoneValue', 'fieldset', 'form']) {
    fields[key] = { type: ['enabled', 'theater', 'autoFullscreen'].includes(key) ? 'checkbox' : 'number', valid: true,
      handlers: {}, addEventListener(name, fn) { this.handlers[name] = fn; }, checkValidity() { return this.valid; }, reportValidity() {} };
  }
  let changed;
  const location = { hash }, windowHandlers = {};
  let focused;
  const links = ['general', 'display', 'controller', 'help'].map(category => ({
    dataset: { categoryLink: category }, attributes: {}, handlers: {},
    setAttribute(key, value) { this.attributes[key] = value; },
    removeAttribute(key) { delete this.attributes[key]; },
    addEventListener(key, handler) { this.handlers[key] = handler; },
    focus() { focused = category; }
  }));
  const panels = ['general', 'display', 'controller', 'controller', 'help', 'help']
    .map(category => ({ dataset: { category }, hidden: false }));
  const chrome = { storage: { local: {
    async get(defaults) { return { ...defaults, ...stored }; },
    async set(values) { writes.push(structuredClone(values)); Object.assign(stored, values); }
  }, onChanged: { addListener(fn) { changed = fn; } } } };
  runInNewContext(readFileSync(new URL('../options.js', import.meta.url), 'utf8'), {
    chrome, window: { addEventListener(key, handler) { windowHandlers[key] = handler; } }, location,
    document: { querySelectorAll: selector => selector === '[data-category-link]' ? links : panels,
      getElementById: key => fields[key], querySelector: selector => fields[selector.replace('#', '')] }
  });
  await new Promise(resolve => setImmediate(resolve));
  return { fields, writes, stored, changed, links, panels, location, windowHandlers, focused: () => focused };
}

test('categories expose only their panels and support old deep links and browser history', async () => {
  const s = await setup({ autoFullscreen: true }, '#gamepad');
  assert.deepEqual(s.panels.map(panel => panel.hidden), [true, true, false, false, true, true]);
  assert.equal(s.links[2].attributes['aria-current'], 'page');
  s.location.hash = '#diagnostics'; s.windowHandlers.hashchange();
  assert.deepEqual(s.panels.map(panel => panel.hidden), [true, true, true, true, false, false]);
  assert.equal(s.links[2].attributes['aria-current'], undefined);
  assert.equal(s.links[3].attributes['aria-current'], 'page');
  s.location.hash = '#display'; s.windowHandlers.hashchange();
  assert.equal(s.panels[1].hidden, false);
  s.location.hash = '#unknown'; s.windowHandlers.hashchange();
  assert.equal(s.panels[0].hidden, false);
  assert.equal(s.links[0].attributes['aria-current'], 'page');
});

test('category keyboard navigation moves focus without changing the active settings', async () => {
  const s = await setup({ autoFullscreen: true });
  let prevented = false;
  s.links[0].handlers.keydown({ key: 'ArrowUp', preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(s.focused(), 'help');
  assert.equal(s.panels[0].hidden, false);
  s.links[3].handlers.keydown({ key: 'ArrowDown', preventDefault() {} });
  assert.equal(s.focused(), 'general');
  s.links[1].handlers.keydown({ key: 'End', preventDefault() {} });
  assert.equal(s.focused(), 'help');
  s.links[3].handlers.keydown({ key: 'Home', preventDefault() {} });
  assert.equal(s.focused(), 'general');
});

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
  assert.match(s.fields.status.textContent, /valid number/);
  s.changed({ enabled: { newValue: false } }, 'local');
  assert.equal(s.fields.enabled.checked, false);
});
