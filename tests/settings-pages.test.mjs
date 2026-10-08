import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { launchExtension } from './helpers/extension.mjs';

test('Vue options migrate legacy settings, synchronize pages and preserve both binding layouts', { timeout: 60000 }, async t => {
  const { context, options, worker, id } = await launchExtension(t);
  const errors = [];
  options.on('pageerror', error => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, []));
  await worker.evaluate(async () => {
    await chrome.storage.local.remove('autoFullscreen');
    await chrome.storage.local.set({ theater: false });
  });
  await options.reload();
  await options.waitForFunction(() => !document.querySelector('fieldset').disabled);
  assert.equal(await worker.evaluate(async () => (await chrome.storage.local.get('autoFullscreen')).autoFullscreen), false);
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${id}/src/popup/popup.html`);
  await popup.waitForFunction(() => !document.querySelector('#enabled').disabled);
  await popup.locator('#enabled').uncheck();
  await options.waitForFunction(() => !document.querySelector('#enabled').checked);
  await options.locator('#enabled').check();
  await popup.waitForFunction(() => document.querySelector('#enabled').checked);
  await options.locator('[data-category-link="controller"]').click();
  await options.locator('#binding-confirm').selectOption('1');
  await options.waitForFunction(() => !document.querySelector('#binding-confirm').disabled);
  assert.equal(await options.locator('#binding-back').inputValue(), '0');
  await options.locator('[data-binding-layout="browse"]').click();
  assert.equal(await options.locator('#binding-confirm').inputValue(), '0');
  await options.locator('#binding-search').selectOption('8');
  await options.waitForFunction(() => !document.querySelector('#binding-search').disabled);
  await options.locator('#resetBindings').click();
  await options.waitForFunction(() => !document.querySelector('#resetBindings').disabled);
  const saved = await worker.evaluate(() => chrome.storage.local.get('bindingLayouts'));
  assert.equal(saved.bindingLayouts.watch.confirm, 1);
  assert.equal(saved.bindingLayouts.browse.confirm, 0);
  assert.equal(saved.bindingLayouts.browse.search, 3);
  await worker.evaluate(() => chrome.storage.local.set({ repeatDelay: 440 }));
  await options.waitForFunction(() => document.querySelector('#repeatDelay').value === '440');
});

test('Vue diagnostics export bounded sanitized JSON and clear through the worker', { timeout: 60000 }, async t => {
  const { options, worker } = await launchExtension(t);
  await worker.evaluate(() => chrome.storage.local.set({ 'ytg-diagnostics': [{ timestamp: 123, version: '0.1.0', module: 'site', operation: 'read', name: 'Error', reason: 'failed https://www.youtube.com/watch?v=private', state: { route: 'watch', title: 'private title' } }] }));
  await options.locator('[data-category-link="help"]').click();
  const downloaded = options.waitForEvent('download');
  await options.locator('#exportDiagnostics').click();
  const download = await downloaded;
  const report = JSON.parse(readFileSync(await download.path(), 'utf8'));
  assert.equal(report.formatVersion, 1); assert.equal(report.entries.length, 1);
  assert.equal(report.entries[0].version, '0.1.0');
  assert.equal(report.entries[0].reason, 'failed [URL]');
  assert.equal(report.entries[0].state.title, undefined);
  await options.locator('#clearDiagnostics').click();
  await options.locator('#diagnosticStatus').filter({ hasText: 'Diagnostic records cleared' }).waitFor();
  assert.equal(await worker.evaluate(async () => (await chrome.storage.local.get('ytg-diagnostics'))['ytg-diagnostics']), undefined);
});

test('Vue popup keeps connection feedback and opens inline settings only after a successful response', { timeout: 60000 }, async t => {
  const { context, id } = await launchExtension(t);
  const popup = await context.newPage();
  await popup.addInitScript(() => {
    window.settingsAvailable = false;
    chrome.tabs.query = async () => [{ id: 3 }];
    chrome.tabs.sendMessage = async (_id, message) => {
      if (message.type === 'ytg-open-inline-settings' && !window.settingsAvailable) throw new Error('No content script');
      return { ok: true, connected: true };
    };
  });
  await popup.goto(`chrome-extension://${id}/src/popup/popup.html`);
  await popup.locator('#connection').filter({ hasText: 'Gamepad connected' }).waitFor();
  await popup.locator('#moreSettings').click();
  await popup.locator('#status').filter({ hasText: 'Open a YouTube tab' }).waitFor();
  assert.equal(popup.isClosed(), false);
  await popup.evaluate(() => { window.settingsAvailable = true; });
  const closed = popup.waitForEvent('close');
  await popup.locator('#moreSettings').click(); await closed;
});

test('page lifecycle preserves a cached Vue app and unmounts on final pagehide', { timeout: 60000 }, async t => {
  const { context, id } = await launchExtension(t);
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${id}/src/popup/popup.html`);
  await popup.waitForFunction(() => !document.querySelector('#enabled').disabled);
  await popup.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
  assert.equal(await popup.locator('#enabled').count(), 1);
  await popup.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })));
  assert.equal(await popup.locator('#enabled').count(), 0);
});
