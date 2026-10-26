import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';
import { browserPage } from './helpers/bundles.mjs';

const result = await build({ configFile: false, logLevel: 'silent', plugins: [vue()],
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: { write: false, minify: false, lib: { entry: fileURLToPath(new URL('./helpers/ui-api-fixture.ts', import.meta.url)),
    formats: ['iife'], name: 'UiApiFixture' } } });
const code = (Array.isArray(result) ? result[0] : result).output.find(item => item.type === 'chunk').code;

test('UI theme and layout commands use the real settings channel, persist and release their owners', async t => {
  const page = await browserPage(t);
  await page.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html', body: '<html><body></body></html>' }));
  await page.goto('https://www.youtube.com/');
  await page.evaluate(() => {
    const listeners = new Set(); window.savedUi = { uiTheme: 'dark' }; window.settingsMessages = [];
    window.chrome = { runtime: { id: 'fixture', onMessage: { addListener() {}, removeListener() {} },
      async sendMessage() { return { ok: true }; } }, storage: {
      onChanged: { addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn) },
      local: {
        get(defaults, callback) { const value = { ...defaults, ...window.savedUi }; callback?.(value); return Promise.resolve(value); },
        async set(next) {
          if (window.failUiSave) throw Error('Storage failed');
          const changes = Object.fromEntries(Object.entries(next).map(([key, value]) => [key, { oldValue: window.savedUi[key], newValue: value }]));
          Object.assign(window.savedUi, next); for (const fn of listeners) fn(changes, 'local');
        }
      } } };
  });
  await page.evaluate(code);
  await page.evaluate(() => {
    const channel = UiApiFixture.createApplicationChannel();
    channel.subscribe(message => { if (message.source === 'yt-gamepad-settings') window.settingsMessages.push(message.values); });
    window.stopUiAdapters = UiApiFixture.startContent(channel);
  });
  assert.equal(await page.evaluate(() => document.documentElement.hasAttribute('dark')), true);
  assert.equal(await page.evaluate(() => UiApiFixture.ui.setTheme('dark')), true);
  assert.equal(await page.evaluate(() => document.documentElement.hasAttribute('dark')), true);
  assert.equal(await page.evaluate(() => window.savedUi.uiTheme), 'dark');
  assert.equal(await page.evaluate(() => UiApiFixture.ui.setLayout('windowed')), true);
  assert.equal(await page.evaluate(() => window.settingsMessages.at(-1).playbackLayout), 'windowed');
  assert.equal(await page.evaluate(() => UiApiFixture.ui.state.layout), 'windowed');
  await page.evaluate(() => chrome.storage.local.set({ uiTheme: 'light' }));
  assert.equal(await page.evaluate(() => UiApiFixture.ui.state.theme), 'light');
  await page.evaluate(() => { window.failUiSave = true; });
  assert.equal(await page.evaluate(() => UiApiFixture.ui.setTheme('dark')), false);
  assert.equal(await page.evaluate(() => UiApiFixture.ui.setLayout('fullscreen')), false);
  assert.equal(await page.evaluate(() => UiApiFixture.ui.state.theme), 'light');
  assert.equal(await page.evaluate(() => UiApiFixture.ui.state.layout), 'windowed');
  await page.evaluate(() => { window.failUiSave = false; window.stopUiAdapters(); });
  assert.equal(await page.evaluate(() => UiApiFixture.ui.state.theme), undefined);
  assert.equal(await page.evaluate(() => UiApiFixture.ui.state.layout), undefined);
  assert.equal(await page.evaluate(() => UiApiFixture.ui.setLayout('fullscreen')), false);
  assert.equal(await page.evaluate(() => 'ui' in window), false);
});
