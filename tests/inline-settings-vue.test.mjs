import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchExtension, fixture, virtualPad } from './helpers/extension.mjs';

async function setup(t, trustedTypes = false) {
  const env = await launchExtension(t);
  await env.worker.evaluate(() => chrome.storage.local.set({ enabled: true, theater: true, autoFullscreen: false }));
  await env.context.route('https://www.youtube.com/**', route => route.fulfill({
    contentType: 'text/html', body: fixture,
    headers: trustedTypes ? { 'content-security-policy': "require-trusted-types-for 'script'; trusted-types 'none'" } : {}
  }));
  const page = await env.context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, [], 'no uncaught page or extension errors'));
  await page.goto('https://www.youtube.com/');
  await page.bringToFront();
  await page.locator('#yt-gamepad-menu').waitFor({ state: 'attached' });
  const setPad = await virtualPad(env.context, page);
  await setPad({ connected: true });
  await page.waitForFunction(() => document.documentElement.classList.contains('ytg-theater'));
  await page.waitForTimeout(200);
  const press = async button => {
    await setPad({ connected: true });
    await page.waitForTimeout(80);
    await setPad({ connected: true, button });
    await page.waitForTimeout(90);
    await setPad({ connected: true });
    await page.waitForTimeout(80);
  };
  await press(9);
  const menu = page.locator('#yt-gamepad-menu');
  if (!await menu.getByRole('button', { name: 'All settings', exact: true }).isVisible()) await press(9);
  await menu.getByRole('button', { name: 'All settings', exact: true }).waitFor({ timeout: 5000 }).catch(async error => {
    t.diagnostic(JSON.stringify(await page.evaluate(() => ({ classes: document.documentElement.className,
      hidden: document.hidden, focus: document.hasFocus(), pads: navigator.getGamepads().length,
      attrs: Array.from(document.documentElement.attributes).map(attr => [attr.name, attr.value]),
      menu: document.querySelector('#yt-gamepad-menu').shadowRoot.textContent.slice(-800) }))));
    throw error;
  });
  await menu.getByRole('button', { name: 'All settings', exact: true }).click();
  await menu.locator('[data-setting="general"]').waitFor();
  return { ...env, page, menu, press };
}

const focused = page => page.evaluate(() => document.querySelector('#yt-gamepad-menu').shadowRoot.activeElement?.dataset.setting);

test('sidebar settings opens plugin preferences and restores keyboard focus on close', { timeout: 60000 }, async t => {
  const { context, worker } = await launchExtension(t);
  await worker.evaluate(() => chrome.storage.local.set({ enabled: true, theater: true, autoFullscreen: false, uiLanguage: 'zh-CN' }));
  await context.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html', body: fixture }));
  const page = await context.newPage();
  await page.goto('https://www.youtube.com/');
  const entry = page.locator('#ytg-sidebar-settings'), menu = page.locator('#yt-gamepad-menu');
  await entry.waitFor();
  assert.equal(await page.locator('#yt-gamepad-settings-launcher').count(), 0, 'the floating settings entry is removed');
  assert.equal(await entry.getAttribute('aria-label'), '设置');
  const url = page.url();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await entry.click();
  await menu.locator('[data-setting="general"]').waitFor();
  assert.equal(page.url(), url, 'opens plugin preferences without navigating away');
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    const panel = menu.locator('.settings-panel');
    const before = await panel.boundingBox();
    const contentWidth = await panel.evaluate(element => element.clientWidth);
    for (const category of ['general', 'controller', 'display', 'help']) {
      await menu.locator(`[data-setting="${category}"]`).click();
      const after = await panel.boundingBox();
      assert.deepEqual(after, before, `settings window stays fixed for ${category} at ${viewport.width}px`);
      assert.equal(await panel.evaluate(element => element.clientWidth), contentWidth,
        'scrollbars do not change the content width');
    }
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await menu.locator('[data-setting="display"]').click();
  await menu.locator('[data-setting="playback-windowed"]').click();
  await menu.locator('[data-setting="playback-windowed"][aria-pressed="true"]:not(:disabled)').waitFor();
  assert.equal(await worker.evaluate(async () => (await chrome.storage.local.get('playbackLayout')).playbackLayout), 'windowed');
  await menu.getByRole('button', { name: '关闭设置', exact: true }).click();
  await menu.waitFor({ state: 'hidden' });
  await entry.focus();
  await page.keyboard.press('Enter');
  await menu.locator('[data-setting="general"]').waitFor();
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#yt-gamepad-menu').hasAttribute('data-settings'));
  await page.keyboard.press('Escape');
  await menu.waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate(() => window.__pageDOM.activeElement?.id), 'ytg-sidebar-settings');
  const setPad = await virtualPad(context, page);
  await setPad({ connected: true });
  await page.waitForFunction(() => window.__testConnected);
  await page.waitForTimeout(100); // Sample the neutral pad before its first press.
  await entry.focus();
  await setPad({ connected: true, button: 0 });
  await menu.locator('[data-setting="general"]').waitFor();
  await setPad({ connected: true });
  await menu.getByRole('button', { name: '关闭设置', exact: true }).click();
  await menu.waitFor({ state: 'hidden' });
  await page.setViewportSize({ width: 390, height: 844 });
  await entry.scrollIntoViewIfNeeded();
  assert.equal(await entry.isVisible(), true);
  assert.equal(await entry.getAttribute('title'), '设置');
});

test('side settings work without a gamepad, persist edits and fit both screen sizes', { timeout: 60000 }, async t => {
  const { context, worker } = await launchExtension(t);
  await worker.evaluate(() => chrome.storage.local.set({ enabled: true, theater: true, autoFullscreen: false }));
  await context.route('https://www.youtube.com/**', route => route.fulfill({
    contentType: 'text/html', body: fixture,
    headers: { 'content-security-policy': "require-trusted-types-for 'script'; trusted-types 'none'" }
  }));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('https://www.youtube.com/');
  const launcher = page.locator('#ytg-sidebar-settings');
  const menu = page.locator('#yt-gamepad-menu');
  await launcher.click();
  await menu.getByRole('navigation', { name: 'Settings categories' }).waitFor();
  await menu.locator('[data-setting="display"]').click();
  await menu.locator('[data-setting="playback-windowed"]').click();
  await menu.locator('[data-setting="playback-windowed"][aria-pressed="true"]:not(:disabled)').waitFor();
  assert.equal(await worker.evaluate(async () => (await chrome.storage.local.get('playbackLayout')).playbackLayout), 'windowed');
  assert.equal(await menu.isVisible(), true, 'mouse settings work without a controller');
  await menu.locator('[data-setting="controller"]').click();
  if (await menu.locator('.inline-action-list').getAttribute('open') === null) await menu.locator('[data-setting="action-list"]').click();
  await menu.locator('[data-setting="confirm"]').click();
  await menu.locator('[data-setting="display"]').click();
  await menu.locator('[data-setting="controller"]').click();
  await menu.locator('[data-setting="layout-browse"]').waitFor();
  await menu.locator('[data-setting="display"]').click();
  await page.waitForTimeout(250); // Capture the settled hover/focus colors.
  await page.screenshot({ path: 'output/playwright/side-settings-desktop.png' });
  await page.evaluate(() => document.documentElement.setAttribute('dark', ''));
  await page.screenshot({ path: 'output/playwright/side-settings-dark.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await menu.locator('section').evaluate(node => node.scrollWidth <= node.clientWidth), true);
  await page.screenshot({ path: 'output/playwright/side-settings-mobile.png' });
  await menu.getByRole('button', { name: 'Close settings', exact: true }).click();
  await menu.waitFor({ state: 'hidden' });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'output/playwright/side-settings-entry.png' });
  await worker.evaluate(() => chrome.storage.local.set({ enabled: true, theater: true }));
  await launcher.click();
  await menu.locator('[data-setting="general"]:not(:disabled)').waitFor();
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#yt-gamepad-menu').hasAttribute('data-settings'));
  await page.keyboard.press('Escape');
  await menu.waitFor({ state: 'hidden' });
  assert.equal(await page.locator('#yt-gamepad-settings-launcher').count(), 0);
  assert.deepEqual(errors, []);
});

test('Vue settings keep gamepad focus and return through each level to the original card', { timeout: 60000 }, async t => {
  const { page, menu, press, worker } = await setup(t);
  assert.equal(await focused(page), 'general');
  await press(13);
  assert.equal(await focused(page), 'display');
  await press(0);
  assert.equal(await focused(page), 'theater');
  await press(0);
  await menu.locator('[data-setting="theater"][aria-pressed="false"]:not(:disabled)').waitFor();
  assert.equal(await focused(page), 'theater');
  assert.equal(await worker.evaluate(async () => (await chrome.storage.local.get('theater')).theater), false);
  await press(1);
  assert.equal(await focused(page), 'display');
  await press(13);
  assert.equal(await focused(page), 'controller');
  await press(0);
  assert.equal(await focused(page), 'layout-browse');
  if (await menu.locator('.inline-action-list').getAttribute('open') === null) await menu.locator('[data-setting="action-list"]').click();
  await menu.locator('[data-setting="confirm"]').click();
  assert.equal(await focused(page), '0');
  await press(1);
  assert.equal(await focused(page), 'confirm');
  await press(1);
  assert.equal(await focused(page), 'controller');
  await press(1);
  await menu.getByRole('button', { name: 'All settings', exact: true }).waitFor();
  assert.equal(await menu.getByRole('button', { name: 'All settings', exact: true }).evaluate(node => node === node.getRootNode().activeElement), true);
  await press(1);
  await menu.waitFor({ state: 'hidden' });
  assert.match(await page.evaluate(() => document.activeElement?.getAttribute('href') || ''), /\/watch\?v=/);
});

test('Vue settings preserve independent bindings, external updates and narrow-screen layout', { timeout: 60000 }, async t => {
  const { page, menu, worker, press } = await setup(t, true);
  await menu.locator('[data-setting="controller"]').click();
  if (await menu.locator('.inline-action-list').getAttribute('open') === null) await menu.locator('[data-setting="action-list"]').click();
  await menu.locator('[data-setting="confirm"]').click();
  await menu.locator('[data-setting="1"]').click();
  await menu.locator('[data-setting="1"][aria-pressed="true"]:not(:disabled)').waitFor();
  const saved = await worker.evaluate(() => chrome.storage.local.get('bindingLayouts'));
  assert.equal(saved.bindingLayouts.browse.confirm, 1);
  assert.equal(saved.bindingLayouts.browse.back, 0);
  assert.equal(saved.bindingLayouts.watch.confirm, 0);
  await press(0); // Back is now the physical bottom button on browse pages.
  assert.equal(await focused(page), 'confirm');
  await menu.locator('[data-setting="layout-watch"]').click();
  if (await menu.locator('.inline-action-list').getAttribute('open') === null) await menu.locator('[data-setting="action-list"]').click();
  await menu.locator('[data-setting="confirm"]').click();
  assert.equal(await focused(page), '0');
  await menu.locator('[data-inline-back]').click();
  await menu.locator('[data-setting="resetBindings"]').click();
  await menu.locator('[data-setting="resetBindings"]:not(:disabled)').waitFor();
  await menu.locator('[data-setting="repeatDelay-+"]').click();
  await menu.locator('[data-setting="repeatDelay-+"]:not(:disabled)').waitFor();
  assert.equal(await focused(page), 'repeatDelay-+');
  assert.equal(await worker.evaluate(async () => (await chrome.storage.local.get('repeatDelay')).repeatDelay), 360);
  await worker.evaluate(() => chrome.storage.local.set({ repeatDelay: 440 }));
  await menu.locator('.inline-adjustment').filter({ hasText: '440 ms' }).waitFor();
  assert.equal(await focused(page), 'repeatDelay-+');
  await page.evaluate(() => document.documentElement.dataset.ytgController = 'playstation');
  await menu.locator('[data-inline-key][data-ytg-family="playstation"]').first().waitFor();
  assert.equal(await focused(page), 'repeatDelay-+');
  await menu.getByRole('button', { name: 'Back to quick menu', exact: true }).focus();
  await worker.evaluate(() => chrome.storage.local.set({ repeatDelay: 450 }));
  await menu.locator('.inline-adjustment').filter({ hasText: '450 ms' }).waitFor();
  assert.equal(await menu.getByRole('button', { name: 'Back to quick menu', exact: true }).evaluate(node => node === node.getRootNode().activeElement), true);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await menu.locator('section').evaluate(node => node.scrollWidth <= node.clientWidth), true);
  await page.screenshot({ path: 'output/playwright/vue-inline-settings-mobile.png' });
  await menu.getByRole('button', { name: 'Back to quick menu', exact: true }).click();
  await menu.getByRole('button', { name: 'All settings', exact: true }).click();
  assert.equal(await focused(page), 'general');
  assert.equal(await menu.locator('#inline-settings button').count(), 4, 'reopening mounts one category list');
});



test('inline right-hand preset updates input and restores custom bindings without overwriting storage', { timeout: 60000 }, async t => {
  const { page, menu, worker, context } = await setup(t);
  await menu.locator('[data-setting="controller"]').click();
  const before = await worker.evaluate(() => chrome.storage.local.get(['bindings', 'bindingLayouts']));
  await menu.locator('[data-setting="rightHandMode"]').click();
  await page.waitForFunction(() => document.documentElement.dataset.ytgNavigationStick === 'right');
  assert.equal(await menu.locator('[data-setting="confirm"]').isDisabled(), true);
  const pad = await virtualPad(context, page);
  await pad({ connected: true }); await page.waitForTimeout(80);
  const first = await focused(page);
  await pad({ connected: true, ry: 1 }); await page.waitForTimeout(80);
  await pad({ connected: true }); await page.waitForTimeout(80);
  assert.notEqual(await focused(page), first, 'right stick moves settings focus');
  await menu.locator('[data-setting="rightHandMode"]').click();
  await page.waitForFunction(() => document.documentElement.dataset.ytgNavigationStick === 'left');
  assert.equal(await menu.locator('[data-setting="confirm"]').isDisabled(), false);
  assert.deepEqual(await worker.evaluate(() => chrome.storage.local.get(['bindings', 'bindingLayouts'])), before);
});

test('controller diagram assigns actions from physical buttons and refreshes its icons', { timeout: 60000 }, async t => {
  const { page, menu, worker, press } = await setup(t);
  await menu.locator('[data-setting="controller"]').click();
  const padA = menu.locator('[data-setting="pad-A"]');
  assert.equal(await menu.locator('.inline-pad-key [data-inline-key]').count(), 12);
  await padA.click();
  await menu.locator('[data-setting="assign-playPause"]').click();
  await menu.locator('[data-setting="assign-playPause"][aria-pressed="true"]:not(:disabled)').waitFor();
  const saved = await worker.evaluate(() => chrome.storage.local.get('bindingLayouts'));
  assert.equal(saved.bindingLayouts.browse.playPause, 0);
  assert.equal(saved.bindingLayouts.browse.confirm, 2);
  assert.equal(saved.bindingLayouts.watch.confirm, 0);
  await menu.getByRole('button', { name: 'Back to gamepad settings', exact: true }).click();
  assert.equal(await focused(page), 'pad-A');
  assert.match(await padA.getAttribute('aria-label'), /Play \/ pause/);
  await page.evaluate(() => document.documentElement.dataset.ytgController = 'playstation');
  await padA.locator('[data-ytg-family="playstation"]').waitFor();
  await padA.click();
  await menu.locator('[data-shortcut-recorder]').click();
  await page.keyboard.press('m');
  await menu.locator('[data-shortcut-recorder]:not(:disabled)').waitFor();
  assert.equal(await worker.evaluate(async () => (await chrome.storage.local.get('shortcutLayouts')).shortcutLayouts.browse.A), 'm');
  await menu.getByRole('button', { name: 'Back to gamepad settings', exact: true }).click();
  assert.match(await padA.getAttribute('aria-label'), / · m · Mute/);
  assert.match(await menu.locator('[data-setting="summary-A"]').textContent(), /m/);
  await menu.locator('.settings-panel').evaluate(node => node.scrollTop = 0);
  await page.screenshot({ path: 'output/playwright/controller-bindings-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await menu.locator('section').evaluate(node => node.scrollWidth <= node.clientWidth), true);
  await menu.locator('[data-setting="pad-Select"]').click();
  await menu.locator('[data-setting="assign-search"]').click();
  await menu.locator('[data-setting="assign-search"][aria-pressed="true"]:not(:disabled)').waitFor();
  assert.equal(await worker.evaluate(async () => (await chrome.storage.local.get('bindingLayouts')).bindingLayouts.browse.search), 8);
  await page.screenshot({ path: 'output/playwright/controller-binding-editor-mobile.png' });
  await page.evaluate(() => window.addEventListener('yt-gamepad-action', event => { window.__bindingAction = event.detail.action; }));
  await menu.getByRole('button', { name: 'Close settings', exact: true }).click();
  await menu.waitFor({ state: 'hidden' });
  await press(0);
  assert.equal(await page.evaluate(() => window.__bindingAction), 'mute', 'stored shortcut reaches the live input module');
  await worker.evaluate(() => chrome.storage.local.set({ uiLanguage: 'zh-CN' }));
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.locator('#ytg-sidebar-settings').click();
  await menu.locator('[data-setting="controller"]').click();
  await page.evaluate(() => document.documentElement.dataset.ytgController = 'xbox');
  await menu.locator('.controller-binding-overview').screenshot({ path: 'output/playwright/controller-bindings-overview.png' });
  for (const width of [800, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(await menu.locator('.controller-binding-overview').evaluate(node => node.scrollWidth <= node.clientWidth), true);
  }
  await menu.locator('.controller-binding-overview').screenshot({ path: 'output/playwright/controller-bindings-overview-mobile.png' });
});
