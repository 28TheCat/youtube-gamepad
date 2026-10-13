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

test('side settings work without a gamepad, persist edits and fit both screen sizes', { timeout: 60000 }, async t => {
  const { context, worker } = await launchExtension(t);
  await worker.evaluate(() => chrome.storage.local.set({ enabled: false, theater: true, autoFullscreen: false }));
  await context.route('https://www.youtube.com/**', route => route.fulfill({
    contentType: 'text/html', body: fixture,
    headers: { 'content-security-policy': "require-trusted-types-for 'script'; trusted-types 'none'" }
  }));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('https://www.youtube.com/');
  const launcher = page.locator('#yt-gamepad-settings-launcher').getByRole('button');
  const menu = page.locator('#yt-gamepad-menu');
  await launcher.click();
  await menu.getByRole('navigation', { name: 'Settings categories' }).waitFor();
  await menu.locator('[data-setting="display"]').click();
  await menu.locator('[data-setting="theater"]').click();
  await menu.locator('[data-setting="theater"][aria-pressed="false"]:not(:disabled)').waitFor();
  assert.equal(await worker.evaluate(async () => (await chrome.storage.local.get('theater')).theater), false);
  assert.equal(await menu.isVisible(), true, 'disabled gamepad controls do not close mouse settings');
  await menu.locator('[data-setting="controller"]').click();
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
  await launcher.click();
  await menu.locator('[data-setting="general"]:not(:disabled)').waitFor();
  await page.keyboard.press('Escape');
  await menu.waitFor({ state: 'hidden' });
  assert.equal(await page.locator('#yt-gamepad-settings-launcher').count(), 1);
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
