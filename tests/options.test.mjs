import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPinia, setActivePinia } from 'pinia';
import { importSettingsModel } from './helpers/settings-model.mjs';
const { normalizeSettings, loadSettings, settingDefaults } = await importSettingsModel('src/shared/settings.ts');
const { useSettingsStore } = await importSettingsModel('src/settings/store.ts');
function setup(t, stored = {}) {
  const writes = [];
  const previous = globalThis.chrome;
  globalThis.chrome = { storage: { local: {
    async get() { return { ...stored }; },
    async set(values) { writes.push({ ...values }); Object.assign(stored, values); }
  } } };
  setActivePinia(createPinia());
  const model = useSettingsStore();
  t.after(() => { model.dispose(); globalThis.chrome = previous; });
  return { model, writes, stored };
}
const numberInput = (value, valid = true) => ({ type: 'number', value, checkValidity: () => valid, reportValidity() {} });
const checkbox = checked => ({ type: 'checkbox', checked, checkValidity: () => true });
test('settings normalize corrupt storage and preserve independent fullscreen preference', () => {
  assert.deepEqual(normalizeSettings({ enabled: 'false', theater: false, deadzone: Infinity, repeatDelay: 0, repeatInterval: 999 }),
    { ...settingDefaults, enabled: true, theater: false, autoFullscreen: false, deadzone: .35, repeatDelay: 150, repeatInterval: 500 });
  assert.equal(normalizeSettings({ theater: false, autoFullscreen: true }).autoFullscreen, true);
  for (const legacy of ['wide', 'normal'])
    assert.equal(normalizeSettings({ playbackLayout: legacy }).playbackLayout, 'windowed');
  for (const value of ['page', 'fullscreen', 'invalid', undefined])
    assert.equal(normalizeSettings({ playbackLayout: value }).playbackLayout, 'fullscreen');
  assert.equal(normalizeSettings({ playbackLayout: 'windowed' }).playbackLayout, 'windowed');
});
test('legacy combined setting migrates once, then independent switches persist', async t => {
  const { model, writes, stored } = setup(t, { theater: false });
  await model.initialize();
  assert.equal(model.ready, true);
  assert.deepEqual(writes, [{ autoFullscreen: false }]);
  await model.save('theater', { target: checkbox(true) });
  assert.equal(stored.theater, true); assert.equal(stored.autoFullscreen, false);
  await loadSettings(); assert.equal(writes.length, 2);
});
test('invalid input never persists and cross-page changes reset removed settings', async t => {
  const { model, writes } = setup(t, { autoFullscreen: true });
  await model.initialize();
  await model.save('repeatDelay', { target: numberInput('0', false) });
  assert.equal(writes.length, 0); assert.match(model.status, /valid number/);
  model.changed({ enabled: { newValue: false }, deadzone: { newValue: .55 } }, 'sync');
  assert.equal(model.values.enabled, true);
  model.changed({ enabled: { newValue: false }, deadzone: { newValue: .55 } }, 'local');
  assert.equal(model.values.enabled, false); assert.equal(model.values.deadzone, .55);
  model.changed({ enabled: {} }, 'local'); assert.equal(model.values.enabled, true);
});
test('failed writes restore controls and remain visible; failed initialization stays disabled', async t => {
  const { model } = setup(t, { autoFullscreen: true });
  await model.initialize();
  chrome.storage.local.set = async () => { throw new Error('unavailable'); };
  const input = checkbox(false);
  await model.save('enabled', { target: input });
  assert.equal(input.checked, true); assert.equal(model.values.enabled, true);
  assert.match(model.status, /Could not save/); assert.equal(model.statusVisible, true); assert.equal(model.saving, false);
  setActivePinia(createPinia()); const failed = useSettingsStore(); t.after(() => failed.dispose());
  chrome.storage.local.get = async () => { throw new Error('unavailable'); };
  await failed.initialize(); assert.equal(failed.ready, false); assert.match(failed.status, /Could not load/);
});
test('disposed pages ignore pending loads and late writes', async t => {
  const { model } = setup(t, { autoFullscreen: true });
  let finish;
  chrome.storage.local.get = () => new Promise(resolve => { finish = resolve; });
  const pending = model.initialize(); model.dispose(); finish({ enabled: false, autoFullscreen: true }); await pending;
  assert.equal(model.ready, false); assert.equal(model.statusVisible, false);
});
