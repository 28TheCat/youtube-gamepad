import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importSettingsModel } from './helpers/settings-model.mjs';
const { translate, normalizeLanguage, syncLanguage } = await importSettingsModel('src/shared/i18n.ts');
const { normalizeSettings } = await importSettingsModel('src/shared/settings.ts');
test('interface language normalizes independently of keyboard language and translates parameters safely', () => {
  assert.equal(normalizeSettings({ uiLanguage: 'zh-CN' }).uiLanguage, 'zh-CN');
  assert.equal(normalizeLanguage('bad'), 'en');
  assert.equal(normalizeSettings({ language: 'zh-CN' }).uiLanguage, 'en');
  assert.equal(translate('General', 'zh-CN'), '通用');
  assert.equal(translate('视频卡片网格', 'en'), 'Video card grid');
  assert.equal(translate('Channel: {name}', 'zh-CN', { name: '<script>$&</script>' }), '频道：<script>$&</script>');
  assert.equal(translate('Uncatalogued label', 'zh-CN'), 'Uncatalogued label');
});
test('newer storage changes win over the initial read and disposal cancels pending updates', async () => {
  let listener, resolveRead, value;
  globalThis.document = { dispatchEvent() {}, documentElement: { setAttribute: (_, next) => { value = next; } } };
  globalThis.chrome = { storage: { local: { get: () => new Promise(resolve => { resolveRead = resolve; }) },
    onChanged: { addListener: next => { listener = next; }, removeListener: next => { assert.equal(next, listener); listener = undefined; } } } };
  try {
    const stop = syncLanguage();
    listener({ uiLanguage: { newValue: 'zh-CN' } }, 'local');
    resolveRead({ uiLanguage: 'en' }); await new Promise(resolve => setImmediate(resolve));
    assert.equal(value, 'zh-CN');
    listener({ uiLanguage: {} }, 'local'); assert.equal(value, 'en');
    stop(); assert.equal(listener, undefined);
    const secondStop = syncLanguage(); secondStop();
    resolveRead({ uiLanguage: 'zh-CN' }); await new Promise(resolve => setImmediate(resolve));
    assert.equal(value, 'en');
  } finally { delete globalThis.document; delete globalThis.chrome; }
});
