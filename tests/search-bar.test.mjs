import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { browserPage } from './helpers/bundles.mjs';
import { mainFixture } from './helpers/main-bundle.mjs';

test('component search uses API destinations, IME, voice, gamepad editing and teardown', { timeout: 60000 }, async t => {
  const page = await browserPage(t);
  await page.setViewportSize({ width: 1000, height: 720 });
  await page.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html', body: `
    <html><body><ytd-masthead style="display:block;height:56px">
      <div id="center" style="width:650px;margin:auto;padding-top:8px">
        <div><input id="search" placeholder="搜索" value="existing"><button id="search-icon-legacy">Search</button></div>
        <div id="voice-search-button"><button>Voice</button></div>
      </div></ytd-masthead><ytd-page-manager><ytd-rich-item-renderer><a id="thumbnail" href="/watch?v=one">Video</a></ytd-rich-item-renderer></ytd-page-manager>
    </body></html>` }));
  await page.goto('https://www.youtube.com/results?search_query=existing');
  await page.route('https://www.youtube.com/complete/search?**', route => route.fulfill({ contentType: 'application/json', body: '["",[]]' }));
  for (const file of ['src/ui/theme.css', 'src/app/browse.css'])
    await page.addStyleTag({ content: readFileSync(new URL(`../${file}`, import.meta.url), 'utf8') });
  await page.evaluate(() => {
    window.submissions = [];
    window.__pageDOM.querySelector('#search-icon-legacy').onclick = () => { throw Error('Native search submit must not be used'); };
    const app = document.createElement('ytd-app');
    app.navigate_ = endpoint => window.submissions.push(endpoint.searchEndpoint.query);
    document.body.append(app);
    window.__pageDOM.querySelector('#voice-search-button button').onclick = () => window.voiceClicked = true;
    const pad = { connected: true, mapping: 'standard', index: 0, id: 'test', axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0, touched: false })) };
    window.__searchPad = pad;
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [pad] });
  });
  await page.addScriptTag({ content: await mainFixture() });
  await page.evaluate(() => window.postMessage({ source: 'yt-gamepad-settings', values: { enabled: true, theater: true } }, location.origin));
  const host = page.locator('#ytg-search-host');
  const input = host.locator('input');
  await host.waitFor({ state: 'visible' });
  assert.equal(await input.inputValue(), 'existing');
  assert.equal(await page.locator('#search').isVisible(), false);
  const clear = host.getByRole('button', { name: 'Clear', exact: true });
  await clear.click();
  assert.equal(await input.inputValue(), '');
  assert.equal(await clear.count(), 0);
  const discovery = host.locator('.search-discovery');
  assert.equal(await discovery.isVisible(), true);
  assert.match(await discovery.textContent(), /Recent searches/);
  assert.match(await discovery.textContent(), /Suggested searches/);
  await discovery.getByText('No search suggestions', { exact: true }).waitFor();
  assert.equal(await page.locator('#search').inputValue(), 'existing');
  await input.press('Enter');
  assert.deepEqual(await page.evaluate(() => window.submissions), [], 'clearing must not submit or navigate');
  await input.fill('  component search  ');
  assert.equal(await discovery.getByRole('group', { name: 'Recent searches' }).count(), 0, 'typing hides recent searches');
  assert.equal(await page.locator('#search').inputValue(), 'existing');
  await input.press('Enter');
  assert.deepEqual(await page.evaluate(() => window.submissions), ['component search']);
  await input.fill('中文');
  await input.dispatchEvent('compositionstart');
  await input.press('Enter');
  assert.equal(await page.evaluate(() => window.submissions.length), 1);
  await input.dispatchEvent('compositionend');
  await host.locator('button[type=submit]').click();
  assert.deepEqual(await page.evaluate(() => window.submissions), ['component search', '中文']);
  await host.getByRole('button', { name: 'Voice search' }).click();
  assert.equal(await page.evaluate(() => window.voiceClicked), true);
  // Gamepad edits update our input without modifying YouTube's hidden input.
  await input.evaluate(node => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(node, 'Gamepad');
    node.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  });
  assert.equal(await input.inputValue(), 'Gamepad');
  assert.equal(await page.locator('#search').inputValue(), 'existing');
  await page.evaluate(() => {
    window.detachedSearch = [document.querySelector('#search'), document.querySelector('#search-icon-legacy')];
    for (const node of window.detachedSearch) node.remove();
  });
  await input.fill('no native input or button');
  await input.press('Enter');
  assert.equal(await page.evaluate(() => window.submissions.at(-1)), 'no native input or button');
  assert.equal(await host.isVisible(), true);
  await input.focus();
  mkdirSync('output/search-bar', { recursive: true });
  await host.screenshot({ path: 'output/search-bar/desktop.png' });
  await page.setViewportSize({ width: 390, height: 720 });
  await page.locator('#center').evaluate(node => node.style.width = '100%');
  assert.ok(await host.evaluate(node => node.scrollWidth <= innerWidth));
  await host.screenshot({ path: 'output/search-bar/mobile.png' });
  await page.evaluate(() => {
    history.replaceState({}, '', '/results?search_query=new+route');
    document.dispatchEvent(new Event('yt-navigate-finish'));
  });
  assert.equal(await input.inputValue(), 'new route');
  await page.evaluate(() => window.YTGamepadMenu.openSearch());
  const keyboardQuery = page.locator('#yt-gamepad-menu').locator('#query');
  await keyboardQuery.waitFor();
  assert.equal(await keyboardQuery.inputValue(), 'new route');
  await keyboardQuery.fill('from gamepad keyboard');
  assert.equal(await input.inputValue(), 'from gamepad keyboard');
  await keyboardQuery.press('Enter');
  assert.equal(await page.evaluate(() => window.submissions.at(-1)), 'from gamepad keyboard');
  await page.locator('#yt-gamepad-menu').waitFor({ state: 'hidden' });
  await input.evaluate(node => window.__unifiedSearchInput = node);
  const mouseHeight = (await host.boundingBox()).height;
  await page.evaluate(() => { window.__searchPad.buttons[15].pressed = true; });
  await page.waitForFunction(() => window.YTGamepadInput.mode === 'gamepad');
  await page.evaluate(() => { window.__searchPad.buttons[15].pressed = false; });
  await page.waitForTimeout(100);
  await input.waitFor();
  assert.ok((await input.boundingBox()).width >= 32, 'the clear button leaves room for the query on a narrow header');
  assert.ok(await host.evaluate(node => node.scrollWidth <= node.clientWidth), 'search controls fit their header without overlap');
  assert.equal(await input.isVisible(), true);
  assert.equal(await host.locator('button:visible,input:visible').count(), 4);
  assert.equal(await input.getAttribute('data-ytg-search-input'), '');
  assert.equal((await host.boundingBox()).height, mouseHeight);
  assert.equal(await input.evaluate(node => node === window.__unifiedSearchInput), true);
  assert.equal(await host.locator('.ytg-search-leading').evaluate(node => getComputedStyle(node).visibility), 'visible');
  const searchTargets = await host.evaluate(node => {
    const entry = node.querySelector('input');
    const clear = node.querySelector('.ytg-search-clear');
    const submit = node.querySelector('button[type=submit]');
    const voice = node.querySelector('.ytg-search-voice');
    window.YTGamepad.focus(entry);
    return ['right', 'right', 'right', 'left', 'left', 'left'].map(direction => {
      window.YTGamepad.act(direction);
      const current = window.YTGamepad.current;
      return current === entry ? 'input' : current === clear ? 'clear' : current === submit ? 'search' : current === voice ? 'voice' : 'outside';
    });
  });
  assert.deepEqual(searchTargets, ['clear', 'search', 'voice', 'search', 'clear', 'input'], 'each search control is a separate target in both directions');
  await page.evaluate(() => {
    window.YTGamepad.focus(window.__pageDOM.querySelector('#ytg-search-host button[type=submit]'));
    window.YTGamepad.act('confirm');
  });
  assert.equal(await page.evaluate(() => window.submissions.at(-1)), 'from gamepad keyboard');
  await page.evaluate(() => {
    window.voiceClicked = false;
    window.YTGamepad.focus(window.__pageDOM.querySelector('#ytg-search-host .ytg-search-voice'));
    window.YTGamepad.act('confirm');
  });
  assert.equal(await page.evaluate(() => window.voiceClicked), true);
  const searchCount = await page.evaluate(() => window.submissions.length);
  const searchRoute = page.url();
  await clear.evaluate(node => window.YTGamepad.focus(node));
  await page.evaluate(() => { window.__searchPad.buttons[0].pressed = true; });
  await clear.waitFor({ state: 'detached' });
  await page.evaluate(() => { window.__searchPad.buttons[0].pressed = false; });
  assert.equal(await input.inputValue(), '');
  assert.equal(await page.evaluate(() => window.__pageDOM.activeElement === window.__pageDOM.querySelector('#ytg-search-host input') && window.YTGamepad.current === window.__pageDOM.activeElement), true, 'clearing returns controller focus to the surviving input');
  assert.equal(await page.evaluate(() => window.submissions.length), searchCount);
  assert.equal(page.url(), searchRoute);
  assert.equal(await discovery.isVisible(), true);
  const recentChoice = discovery.getByRole('button', { name: '↶ from gamepad keyboard', exact: true });
  await recentChoice.click();
  assert.equal(await page.evaluate(() => window.submissions.length), searchCount + 1, 'a recent query submits in one click');
  assert.equal(await page.evaluate(() => window.submissions.at(-1)), 'from gamepad keyboard');
  await clear.click();
  await page.evaluate(() => window.YTGamepad.act('right'));
  assert.equal(await host.locator('button[type=submit]').evaluate(node => window.YTGamepad.current === node), true, 'navigation skips the removed clear button');
  await input.fill('from gamepad keyboard');
  await input.focus();
  await host.screenshot({ path: 'output/search-bar/gamepad.png' });
  await page.evaluate(() => window.YTGamepad.act('confirm'));
  await keyboardQuery.waitFor();
  assert.equal(await keyboardQuery.inputValue(), 'from gamepad keyboard');
  await page.evaluate(() => window.YTGamepadMenu.close());
  await page.waitForFunction(() => window.__pageDOM.activeElement?.hasAttribute('data-ytg-search-input'));
  await page.evaluate(() => { window.__searchPad.buttons[3].pressed = true; });
  await keyboardQuery.waitFor();
  await page.evaluate(() => { window.__searchPad.buttons[3].pressed = false; });
  await page.evaluate(() => window.YTGamepadMenu.close());
  // Switch through a real pointer event so the input owner and DOM agree.
  await page.mouse.move(380, 20);
  await page.mouse.move(400, 20);
  await input.waitFor().catch(async error => {
    t.diagnostic(await page.evaluate(() => JSON.stringify(['#ytg-browse-top','#ytg-client-search','#ytg-search-host','.ytg-search-form','.ytg-search-field','[data-ytg-search-input]'].map(selector => {
      const node = window.__pageDOM.querySelector(selector), box = node.getBoundingClientRect();
      return [selector, box.width, getComputedStyle(node).display];
    }))));
    throw error;
  });
  await page.setViewportSize({ width: 1000, height: 720 });
  await input.fill('');
  await input.evaluate(node => node.blur());
  await page.evaluate(() => document.documentElement.setAttribute('data-ytg-language', 'zh-CN'));
  await host.getByRole('button', { name: '搜索', exact: true }).waitFor();
  await host.screenshot({ path: 'output/search-bar/unified.png' });
  assert.equal(await host.getByRole('button', { name: '清空', exact: true }).count(), 0);
  await input.fill('手柄搜索');
  await host.getByRole('button', { name: '清空', exact: true }).waitFor();
  await host.screenshot({ path: 'output/search-bar/clear.png' });
  const requested = [];
  await page.route('https://www.youtube.com/complete/search?**', route => {
    const url = new URL(route.request().url());
    const query = url.searchParams.get('q'); requested.push(query);
    assert.equal(url.searchParams.get('ds'), 'yt');
    return route.fulfill({ contentType: 'text/javascript', body: `window.google.ac.h(${JSON.stringify([query,
      [[query ? `${query} walkthrough` : 'Steam Deck', 0, [512]], ['<img onerror=alert(1)>', 0, []]]])})` });
  });
  await host.getByRole('button', { name: '清空', exact: true }).click();
  await discovery.getByRole('button', { name: 'Steam Deck', exact: true }).waitFor();
  assert.equal(await discovery.locator('img').count(), 0, 'API suggestions render as text');
  assert.ok(requested.includes(''), 'empty input requests suggestions from the API');
  await page.screenshot({ path: 'output/search-bar/discovery.png' });
  await discovery.getByRole('button', { name: 'Steam Deck', exact: true }).click();
  assert.equal(await page.evaluate(() => window.submissions.at(-1)), 'Steam Deck');
  await input.fill('elden');
  const suggested = discovery.getByRole('button', { name: 'elden walkthrough', exact: true });
  await suggested.waitFor();
  assert.equal(await discovery.getByRole('group', { name: '最近搜索' }).count(), 0);
  await suggested.click();
  assert.equal(await page.evaluate(() => window.submissions.at(-1)), 'elden walkthrough');
  await page.evaluate(() => { document.querySelector('#center').append(...window.detachedSearch); window.YTGamepadRuntime.destroy(); });
  assert.equal(await host.count(), 0);
  assert.equal(await page.locator('#search').isVisible(), true);
});
