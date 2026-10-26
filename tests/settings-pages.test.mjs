import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { launchExtension } from './helpers/extension.mjs';

test('gamepad test shows all mappings, live inputs, calibration and saved sensitivity without persisting readings', { timeout: 60000 }, async t => {
  const { options, worker } = await launchExtension(t);
  const errors = [];
  options.on('pageerror', error => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, []));
  await options.evaluate(() => {
    window.testDevices = [];
    window.testPolls = 0;
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => { window.testPolls++; return window.testDevices; } });
  });
  await options.locator('[data-category-link="test"]').click();
  await options.getByText('No gamepad detected yet.', { exact: true }).waitFor();
  await options.evaluate(() => {
    window.testDevices = [null, { connected: true, index: 1, id: 'Raw USB gamepad', mapping: '',
      axes: [.45, -.2, .3], buttons: [{ pressed: true, touched: true, value: 1 }, { pressed: false, touched: true, value: .4 }] }];
  });
  await options.getByText('Non-standard mapping · detection only', { exact: true }).waitFor();
  await options.waitForFunction(() => document.querySelector('[data-button-index="0"]')?.dataset.pressed === 'true');
  assert.equal(await options.locator('[data-button-index="1"] meter').getAttribute('value'), '0.4');
  assert.equal(await options.getByRole('button', { name: 'Measure stick drift', exact: true }).isDisabled(), true);
  await options.evaluate(() => {
    window.testDevices.push({ connected: true, index: 2, id: 'Standard test gamepad', mapping: 'standard',
      axes: [.02, -.03, .8, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) });
  });
  await options.waitForFunction(() => document.querySelector('#testDevice')?.options.length === 2);
  await options.selectOption('#testDevice', '2');
  await options.getByText('Standard mapping · supported', { exact: true }).waitFor();
  assert.equal(await options.locator('[data-axis-pair="2"] .gamepad-test-dot').getAttribute('data-outside'), 'true');
  await options.getByRole('button', { name: 'Measure stick drift', exact: true }).click();
  await options.getByRole('button', { name: 'Apply suggested deadzone: 0.15', exact: true }).waitFor();
  assert.equal(await worker.evaluate(async () => (await chrome.storage.local.get('deadzone')).deadzone ?? .35), .35, 'measurement does not save automatically');
  await options.getByRole('button', { name: 'Apply suggested deadzone: 0.15', exact: true }).click();
  await options.waitForFunction(() => document.querySelector('#testDeadzone').value === '0.15');
  assert.equal(await worker.evaluate(async () => (await chrome.storage.local.get('deadzone')).deadzone), .15);
  await options.locator('#testDeadzone').fill('0.55');
  assert.equal(await worker.evaluate(async () => (await chrome.storage.local.get('deadzone')).deadzone), .15);
  await options.getByRole('button', { name: 'Apply preview', exact: true }).click();
  await options.waitForFunction(() => document.querySelector('#deadzone').value === '0.55');
  assert.equal(await worker.evaluate(async () => (await chrome.storage.local.get('deadzone')).deadzone), .55);
  await worker.evaluate(() => chrome.storage.local.set({ uiLanguage: 'zh-CN' }));
  await options.getByRole('heading', { name: '手柄检测与校准', exact: true }).waitFor();
  await options.screenshot({ path: 'output/playwright/gamepad-test-zh.png', fullPage: true });
  await options.setViewportSize({ width: 390, height: 844 });
  assert.equal(await options.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await options.screenshot({ path: 'output/playwright/gamepad-test-mobile-zh.png', fullPage: true });
  await options.setViewportSize({ width: 1280, height: 900 });
  await options.getByRole('button', { name: '测量摇杆漂移', exact: true }).click();
  await options.evaluate(() => { window.testDevices = []; });
  await options.getByText('暂未检测到手柄。', { exact: true }).waitFor();
  assert.equal(await options.locator('progress').count(), 0);
  await options.evaluate(() => { window.testDevices = [{ connected: true, index: 2, id: 'Replacement', mapping: 'standard', axes: [0, 0], buttons: [] }]; });
  await options.getByText('Replacement', { exact: true }).last().waitFor();
  assert.equal(await options.getByRole('button', { name: /^应用建议死区/ }).count(), 0);
  await options.locator('[data-category-link="general"]').click();
  const polls = await options.evaluate(() => window.testPolls);
  await options.waitForTimeout(200);
  assert.equal(await options.evaluate(() => window.testPolls), polls, 'unmount stops polling');
  const saved = await worker.evaluate(() => chrome.storage.local.get(null));
  assert.equal(JSON.stringify(saved).includes('Raw USB gamepad'), false);
  assert.equal(JSON.stringify(saved).includes('Standard test gamepad'), false);
});

test('gamepad detection explains unavailable browser access', { timeout: 60000 }, async t => {
  const { options } = await launchExtension(t);
  await options.evaluate(() => Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => { throw new DOMException('blocked', 'SecurityError'); } }));
  await options.locator('[data-category-link="test"]').click();
  await options.getByText('Gamepad detection is unavailable. Check browser permissions and try reopening this page.', { exact: true }).waitFor();
  assert.equal(await options.locator('#testDevice').count(), 0);
});

test('popup opens gamepad detection without requiring a YouTube tab', { timeout: 60000 }, async t => {
  const { context, id } = await launchExtension(t);
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${id}/src/popup/popup.html`);
  const opened = context.waitForEvent('page');
  await popup.locator('#openGamepadTest').click();
  const detection = await opened;
  await detection.waitForURL(`chrome-extension://${id}/src/settings/options.html#gamepadTest`);
  await detection.getByRole('heading', { name: 'Gamepad detection & calibration', exact: true }).waitFor();
});

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


test('right-hand preset persists across reloads and restores saved bindings', { timeout: 60000 }, async t => {
  const { options, worker } = await launchExtension(t);
  await options.locator('[data-category-link="controller"]').click();
  await options.locator('#binding-confirm').selectOption('1');
  await options.waitForFunction(() => !document.querySelector('#binding-confirm').disabled);
  const before = await worker.evaluate(() => chrome.storage.local.get(['bindings', 'bindingLayouts']));
  await options.locator('#rightHandMode').click();
  await options.waitForFunction(() => document.querySelector('#rightHandMode').getAttribute('aria-pressed') === 'true');
  assert.equal(await options.locator('#binding-confirm').inputValue(), '0');
  assert.equal(await options.locator('#binding-help').inputValue(), '5');
  assert.equal(await options.locator('#binding-confirm').isDisabled(), true);
  await options.reload();
  await options.locator('[data-category-link="controller"]').click();
  await options.waitForFunction(() => document.querySelector('#rightHandMode').getAttribute('aria-pressed') === 'true');
  await options.locator('#rightHandMode').click();
  await options.waitForFunction(() => !document.querySelector('#binding-confirm').disabled);
  assert.equal(await options.locator('#binding-confirm').inputValue(), '1');
  assert.deepEqual(await worker.evaluate(() => chrome.storage.local.get(['bindings', 'bindingLayouts'])), before);
});
