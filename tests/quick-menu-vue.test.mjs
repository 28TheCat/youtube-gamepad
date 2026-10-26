import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchExtension, fixture, virtualPad } from './helpers/extension.mjs';

for (const trustedTypes of [false, true]) {
  test(`Vue quick menu routes gamepad back and restores focus (Trusted Types: ${trustedTypes})`, { timeout: 60000 }, async t => {
    const { context, worker } = await launchExtension(t);
    await worker.evaluate(() => chrome.storage.local.set({ enabled: true, autoFullscreen: false }));
    await context.route('https://www.youtube.com/**', route => route.fulfill({
      contentType: 'text/html', body: fixture,
      headers: trustedTypes ? { 'content-security-policy': "require-trusted-types-for 'script'; trusted-types 'none'" } : {}
    }));
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('https://www.youtube.com/');
    const menu = page.locator('#yt-gamepad-menu');
    await menu.waitFor({ state: 'attached' });
    const setPad = await virtualPad(context, page);
    await setPad({ connected: true });
    await page.waitForFunction(() => document.documentElement.classList.contains('ytg-theater'));
    const press = async button => {
      await setPad({ connected: true }); await page.waitForTimeout(80);
      await setPad({ connected: true, button }); await page.waitForTimeout(90);
      await setPad({ connected: true }); await page.waitForTimeout(80);
    };
    const focus = () => page.evaluate(() => document.querySelector('#yt-gamepad-menu').shadowRoot.activeElement?.dataset.menuAction);
    for (let cycle = 0; cycle < 3; cycle++) {
      await press(9);
      await menu.locator('[data-vue-quick-menu]').waitFor();
      assert.equal(await focus(), 'search');
      await press(13);
      assert.equal(await focus(), 'playPause');
      await press(1);
      await menu.waitFor({ state: 'hidden' });
      assert.match(await page.evaluate(() => document.activeElement?.getAttribute('href') || ''), /\/watch\?v=/);
    }
    await press(9);
    await press(0);
    await page.waitForFunction(() => document.querySelector('#yt-gamepad-menu').hasAttribute('data-search'));
    await press(1);
    await menu.locator('[data-vue-quick-menu]').waitFor();
    assert.equal(await focus(), 'search');
    await menu.getByRole('button', { name: 'Back', exact: true }).click();
    await menu.waitFor({ state: 'hidden' });
    assert.deepEqual(errors, []);
  });
}
