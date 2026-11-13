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
      await setPad({ connected: true });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await page.evaluate(button => new Promise((resolve, reject) => {
        const finish = () => {
          clearTimeout(timer); window.removeEventListener('yt-gamepad-action', finish, true);
          document.documentElement.setAttribute('data-test-pad', JSON.stringify({ connected: true })); resolve();
        };
        const timer = setTimeout(() => {
          window.removeEventListener('yt-gamepad-action', finish, true); reject(new Error('Gamepad action was not sampled'));
        }, 5000);
        window.addEventListener('yt-gamepad-action', finish, true);
        document.documentElement.setAttribute('data-test-pad', JSON.stringify({ connected: true, button }));
      }), button);
    };
    const focus = () => page.evaluate(() => document.querySelector('#yt-gamepad-menu').shadowRoot.activeElement?.dataset.menuAction);
    const returnTarget = page.locator('#ytg-browse-top .client-account');
    await returnTarget.focus();
    assert.ok(await returnTarget.evaluate(node => node.getRootNode().activeElement === node));
    for (let cycle = 0; cycle < 3; cycle++) {
      await press(9);
      await menu.locator('[data-vue-quick-menu]').waitFor();
      assert.equal(await focus(), 'search');
      await press(13);
      assert.equal(await focus(), 'playPause');
      await press(1);
      await menu.waitFor({ state: 'hidden' });
      assert.ok(await returnTarget.evaluate(node => node.getRootNode().activeElement === node), 'closing restores the original header button');
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

test('quick menu retains content through fade and safely interrupts closing', { timeout: 60000 }, async t => {
  const { context, worker } = await launchExtension(t);
  await worker.evaluate(() => chrome.storage.local.set({ enabled: true, autoFullscreen: false, browseMode: 'youtube' }));
  await context.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html', body: fixture }));
  const page = await context.newPage();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('https://www.youtube.com/');
  const menu = page.locator('#yt-gamepad-menu');
  await menu.waitFor({ state: 'attached' });
  const setPad = await virtualPad(context, page);
  await setPad({ connected: true });
  await page.waitForFunction(() => document.documentElement.classList.contains('ytg-theater'));
  await page.keyboard.press('F1');
  await menu.locator('[data-vue-quick-menu]').waitFor();
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#yt-gamepad-menu')).opacity === '1');
  const closing = await menu.getByRole('button', { name: 'Back', exact: true }).evaluate(button => {
    const host = button.getRootNode().host;
    button.click();
    return { mounted: !!host.shadowRoot.querySelector('[data-vue-quick-menu]'),
      opened: host.hasAttribute('data-open'),
      fading: host.getAnimations().some(animation => animation.effect.getKeyframes().some(frame => frame.opacity === '0')) };
  });
  assert.deepEqual(closing, { mounted: true, opened: false, fading: true });
  await page.keyboard.press('F1');
  await page.waitForFunction(() => {
    const host = document.querySelector('#yt-gamepad-menu');
    return host.hasAttribute('data-open') && getComputedStyle(host).opacity === '1';
  });
  assert.equal(await menu.locator('[data-vue-quick-menu]').count(), 1, 'the old exit cannot dispose the reopened menu');
  await menu.getByRole('button', { name: 'Back', exact: true }).click();
  await menu.waitFor({ state: 'hidden' });
  await page.waitForFunction(() => !document.querySelector('#yt-gamepad-menu').shadowRoot.querySelector('[data-vue-quick-menu]'));
});
