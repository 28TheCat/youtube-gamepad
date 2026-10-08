import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchExtension, fixture, virtualPad } from './helpers/extension.mjs';

for (const trustedTypes of [false, true]) {
  test(`Vue search preserves editing, pinyin and back (Trusted Types: ${trustedTypes})`, { timeout: 60000 }, async t => {
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
    await menu.waitFor({ state: 'attached', timeout: 7000 }).catch(error => { throw new Error(`${error.message}\nPage errors: ${errors.join('; ')}`); });
    const setPad = await virtualPad(context, page);
    await setPad({ connected: true });
    await page.waitForFunction(() => document.documentElement.classList.contains('ytg-theater'));
    const press = async button => {
      await setPad({ connected: true }); await page.waitForTimeout(80);
      await setPad({ connected: true, button }); await page.waitForTimeout(90);
      await setPad({ connected: true }); await page.waitForTimeout(80);
    };
    const active = () => page.evaluate(() => document.querySelector('#yt-gamepad-menu').shadowRoot.activeElement?.dataset);
    const input = menu.locator('#query');
    await press(9); await press(0);
    await menu.locator('[data-vue-search]').waitFor();
    assert.equal((await active()).focusId, 'key:0:0');
    await press(0);
    assert.equal(await input.inputValue(), 'A');
    await input.fill('A😀B');
    await input.evaluate(node => { node.setSelectionRange(3, 3); node.dispatchEvent(new Event('select')); });
    await press(2);
    assert.equal(await input.inputValue(), 'AB');
    await press(5); // RB advances past B.
    await press(0);
    assert.equal(await input.inputValue(), 'ABA');
    await press(10); // L3 toggles symbols while retaining the key coordinate.
    assert.equal((await active()).focusId, 'key:0:0');
    await press(0);
    assert.equal(await input.inputValue(), 'ABA1');
    await press(10);
    await menu.getByRole('button', { name: 'Clear', exact: true }).click();
    await menu.getByRole('button', { name: 'Switch input language', exact: true }).click();
    await press(1);
    assert.equal((await active()).action, 'SWITCH_LANGUAGE');
    await menu.getByRole('button', { name: 'Switch input language', exact: true }).click();
    await menu.getByRole('button', { name: 'Chinese (Pinyin)', exact: true }).click();
    for (const label of ['N', 'I', 'H', 'A', 'O']) await menu.getByRole('button', { name: label, exact: true }).click();
    assert.equal(await input.inputValue(), '');
    assert.match(await menu.locator('#composition').textContent(), /nihao/);
    await press(7); // RT cannot submit an unconfirmed composition.
    assert.match(await menu.locator('#message').textContent(), /candidate before searching/);
    await press(3); // Y confirms the selected/first candidate, not the search.
    assert.match(await input.inputValue(), /你好/);
    for (const label of ['N', 'I']) await menu.getByRole('button', { name: label, exact: true }).click();
    await press(11); // R3 enters candidates.
    assert.equal((await active()).row, '-1');
    const firstCandidate = await menu.locator('#composition button').first().textContent();
    await press(5); // RB advances the candidate page.
    assert.notEqual(await menu.locator('#composition button').first().textContent(), firstCandidate);
    assert.equal((await active()).row, '-1');
    await press(4); // LB returns to the previous candidate page.
    assert.equal(await menu.locator('#composition button').first().textContent(), firstCandidate);
    await press(11); // R3 restores the remembered keyboard coordinate.
    assert.notEqual((await active()).row, '-1');
    await menu.getByRole('button', { name: 'Use typed text: ni', exact: true }).click();
    assert.equal(await input.inputValue(), '你好ni');
    await menu.getByRole('button', { name: 'N', exact: true }).click();
    await press(1); // B cancels composition only.
    assert.equal(await menu.locator('#composition').isVisible(), false);
    assert.equal(await menu.locator('[data-vue-search]').isVisible(), true);
    await press(1); // Search -> quick menu.
    await menu.locator('[data-vue-quick-menu]').waitFor();
    assert.equal((await active()).menuAction, 'search');
    await press(1); // Quick menu -> original page focus.
    await menu.waitFor({ state: 'hidden' });
    assert.match(await page.evaluate(() => document.activeElement?.getAttribute('href') || ''), /\/watch\?v=/);
    // Reopening reads the native query, with a fresh single Vue tree.
    await press(3);
    await menu.locator('[data-vue-search]').waitFor();
    assert.equal(await menu.locator('#query').count(), 1);
    await press(1);
    await menu.waitFor({ state: 'hidden' });
    assert.deepEqual(errors, []);
  });
}

test('Vue search submits through native adapter and bounds untrusted history', { timeout: 60000 }, async t => {
  const { context, worker } = await launchExtension(t);
  await worker.evaluate(() => chrome.storage.local.set({ enabled: true, autoFullscreen: false }));
  await context.addInitScript(() => localStorage.setItem('ytg-recent-searches', JSON.stringify(['<img onerror=alert(1)>', 'x'.repeat(257), 42])));
  await context.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html', body: fixture }));
  const page = await context.newPage();
  await page.goto('https://www.youtube.com/');
  const menu = page.locator('#yt-gamepad-menu');
  await menu.waitFor({ state: 'attached' });
  const setPad = await virtualPad(context, page);
  await setPad({ connected: true });
  await page.waitForFunction(() => document.documentElement.classList.contains('ytg-theater'));
  const open = async () => {
    await setPad({ connected: true, button: 3 });
    await menu.locator('[data-vue-search]').waitFor();
    await setPad({ connected: true }); await page.waitForTimeout(100);
  };
  await page.evaluate(() => {
    document.querySelector('#search-icon-legacy').addEventListener('click', () => {
      document.documentElement.dataset.submittedSearch = document.querySelector('input#search').value;
    });
  });
  await open();
  assert.equal(await menu.locator('#recent button').count(), 1);
  assert.equal(await menu.locator('#recent img').count(), 0);
  await menu.locator('#query').fill('  Vue search  ');
  await menu.locator('#query').press('Enter');
  await menu.waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate(() => document.documentElement.dataset.submittedSearch), 'Vue search');
  await open();
  assert.equal(await menu.locator('#recent button').first().textContent(), '↶ Vue search');
  await page.evaluate(() => document.querySelector('#search-icon-legacy').remove());
  await menu.locator('#query').fill('cannot submit');
  await menu.locator('#query').press('Enter');
  assert.match(await menu.locator('#message').textContent(), /unavailable/);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('ytg-recent-searches')).includes('cannot submit')), false);
  await page.setViewportSize({ width: 390, height: 720 });
  assert.ok(await menu.locator('#query').isVisible());
  assert.equal(await page.evaluate(() => document.querySelector('#yt-gamepad-menu').shadowRoot.querySelector('section').scrollWidth <= innerWidth), true);
});
