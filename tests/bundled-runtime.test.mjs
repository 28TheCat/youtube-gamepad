import { test } from 'node:test';
import assert from 'node:assert/strict';
import { browserPage, bundleSource, settingsPage } from './helpers/bundles.mjs';
import { fixture } from './helpers/extension.mjs';

for (const connected of [true, false]) {
test(`extension invalidation disposes the bundled application ${connected ? 'with' : 'without'} a controller`, { timeout: 30000 }, async t => {
  const page = await browserPage(t);
  await page.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html', body: fixture }));
  await page.goto('https://www.youtube.com/');
  const client = await page.context().newCDPSession(page);
  const exceptions = [];
  client.on('Runtime.exceptionThrown', event => exceptions.push(event.exceptionDetails.text));
  await client.send('Runtime.enable');
  const frameId = (await client.send('Page.getFrameTree')).frameTree.frame.id;
  const { executionContextId } = await client.send('Page.createIsolatedWorld', { frameId, worldName: 'ytg-invalidated-test' });
  const isolated = async expression => {
    const result = await client.send('Runtime.evaluate', { contextId: executionContextId, expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  await isolated(`globalThis.chrome = {
    runtime: { id:'test', sendMessage:async()=>({ok:true}), onMessage:{addListener(){},removeListener(){}} },
    storage: {local:{ get(keys, callback) { const data={...keys,enabled:true}; callback?.(data); return Promise.resolve(data); },set:async()=>{} },onChanged:{addListener(){},removeListener(){}}}
  }; Object.defineProperty(navigator,'getGamepads',{value:()=>${connected ? "[{index:0,connected:true,mapping:'standard',axes:[0,0],buttons:Array.from({length:17},()=>({pressed:false,value:0}))}]" : '[]'},configurable:true});`);
  await page.addScriptTag({ content: bundleSource('bundles/main.js') });
  await isolated(bundleSource('bundles/content.js'));
  await page.locator('#ytg-sidebar-settings').waitFor();
  if (connected) await page.waitForFunction(() => document.documentElement.classList.contains('ytg-theater'));
  await page.locator('#ytg-sidebar-settings').click();
  await page.locator('#yt-gamepad-menu').locator('[data-setting="general"]:not(:disabled)').waitFor();
  await isolated(`globalThis.invalidCalls=0;
    ${connected ? '' : 'chrome.runtime.id=undefined;'}
    chrome.runtime.sendMessage=()=>{invalidCalls++;throw new Error('Extension context invalidated.');};
    chrome.runtime.onMessage.removeListener=()=>{throw new Error('Extension context invalidated.');};
    chrome.storage.onChanged.removeListener=()=>{throw new Error('Extension context invalidated.');};
    window.dispatchEvent(new Event('focus'));`);
  await page.waitForFunction(() => !document.documentElement.classList.contains('ytg-theater'));
  assert.equal(await page.locator('#yt-gamepad-settings-launcher').count(), 0);
  assert.equal(await page.locator('#yt-gamepad-overlay').count(), 0);
  await page.waitForTimeout(650);
  assert.equal(await isolated('invalidCalls'), connected ? 1 : 0);
  assert.equal(await isolated("Boolean(window[Symbol.for('yt-gamepad.bridge.dispose')])"), false);
  assert.deepEqual(exceptions, []);
});
}

for (const mode of ['late', 'missing', 'cancelled', 'settings']) {
  test(`ISOLATED startup handles ${mode} MAIN without leaving preparation behind`, { timeout: 30000 }, async t => {
    const page = await browserPage(t);
    const body = mode === 'missing' ? fixture.replace('</body>', '<div id="movie_player"><video class="html5-main-video"></video></div></body>') : fixture;
    await page.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html', body }));
    await page.goto(mode === 'missing' ? 'https://www.youtube.com/watch?v=a' : 'https://www.youtube.com/');
    const client = await page.context().newCDPSession(page);
    const frameId = (await client.send('Page.getFrameTree')).frameTree.frame.id;
    const { executionContextId } = await client.send('Page.createIsolatedWorld', { frameId, worldName: 'ytg-startup-test' });
    const isolated = async expression => {
      const result = await client.send('Runtime.evaluate', { contextId: executionContextId, expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    };
    await isolated(`globalThis.chrome = {
      runtime: { id:'test', getManifest:()=>({version:'0.2.0'}), sendMessage:async()=>({ok:true}), onMessage:{addListener(){},removeListener(){}} },
      storage: {local:{ get(keys, callback) { const data={...(Array.isArray(keys)?{}:keys),enabled:true}; callback?.(data); return Promise.resolve(data); },set:async()=>{} },onChanged:{addListener(){},removeListener(){}}}
    }`);
    if (mode === 'settings') await isolated(`const originalGet = chrome.storage.local.get;
      chrome.storage.local.get = (keys, callback) => callback && Object.hasOwn(keys, 'enabled') ? new Promise(resolve => {
        globalThis.releaseSettings = () => { const data={...keys,enabled:true}; callback(data); resolve(data); };
      }) : originalGet(keys, callback);`);
    if (mode === 'missing') await isolated(`Object.defineProperty(navigator, 'getGamepads', {
      value:()=>[{index:0,mapping:'standard',connected:true,axes:[0,0],buttons:Array.from({length:17},()=>({pressed:false,value:0}))}], configurable:true
    })`);
    await isolated(bundleSource('bundles/early.js'));
    assert.equal(await page.locator('body').evaluate(body => getComputedStyle(body).opacity), '1');
    assert.equal(await page.locator('body').evaluate(body => getComputedStyle(body).pointerEvents), 'auto');
    await isolated(bundleSource('bundles/content.js'));
    assert.equal(await page.locator('#yt-gamepad-overlay').count(), 0);
    assert.equal(await page.getAttribute('html', 'data-ytg-boot'), 'starting');
    // A page event cannot claim successful application initialization.
    await page.evaluate(() => window.dispatchEvent(new Event('ytg-main-ready')));
    assert.equal(await page.getAttribute('html', 'data-ytg-boot'), 'starting');
    if (mode === 'late' || mode === 'settings') {
      await page.addScriptTag({ content: bundleSource('bundles/main.js') });
      if (mode === 'settings') {
        await page.locator('#ytg-sidebar-settings').waitFor();
        assert.equal(await page.locator('body').evaluate(body => getComputedStyle(body).opacity), '1', 'startup leaves the page visible while settings load');
        await isolated('releaseSettings()');
      }
    } else if (mode === 'cancelled') {
      await isolated("window[Symbol.for('yt-gamepad.main.dispose')]()");
      await page.addScriptTag({ content: bundleSource('bundles/main.js') });
    }
    await page.waitForFunction(() => !document.documentElement.hasAttribute('data-ytg-boot'));
    assert.equal(await page.locator('body').evaluate(body => getComputedStyle(body).opacity), '1');
    assert.equal(await page.locator('body').evaluate(body => getComputedStyle(body).pointerEvents), 'auto');
    if (mode === 'cancelled') {
      await page.waitForTimeout(200);
      assert.equal(await page.locator('#yt-gamepad-overlay').count(), 0);
    } else {
      await page.locator('#yt-gamepad-overlay').waitFor({ state: 'attached' });
      assert.equal(await page.locator('#yt-gamepad-overlay').count(), 1);
    }
    assert.equal(await page.evaluate(() => Boolean(window[Symbol.for('yt-gamepad.main.dispose')])), false);
    if (mode === 'missing') {
      await page.waitForFunction(() => document.documentElement.dataset.ytgAdaptation === 'fallback', null, { timeout: 12000 });
      assert.equal(await page.getAttribute('html', 'data-ytg-native'), 'true');
      await page.addScriptTag({ content: bundleSource('bundles/main.js') });
      await page.waitForFunction(() => document.documentElement.dataset.ytgAdaptation === 'ready');
    }
  });
}

test('production bundles communicate across MAIN and ISOLATED without module globals', { timeout: 30000 }, async t => {
  const page = await browserPage(t);
  await page.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html', body: fixture }));
  await page.goto('https://www.youtube.com/');
  const client = await page.context().newCDPSession(page);
  const frameId = (await client.send('Page.getFrameTree')).frameTree.frame.id;
  const { executionContextId } = await client.send('Page.createIsolatedWorld', { frameId, worldName: 'ytg-bundle-test' });
  const isolated = async expression => {
    const result = await client.send('Runtime.evaluate', { contextId: executionContextId, expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  // Replace only Chrome privileges and physical gamepad sampling. Both scripts
  // are the unmodified production bundles, evaluated in separate JS worlds.
  await isolated(`(() => {
    const values = { enabled: true, theater: true, autoFullscreen: false };
    const listeners = new Set();
    globalThis.chrome = {
      runtime: { id: 'test', getManifest: () => ({version: '0.2.0'}), sendMessage: async () => ({ok: true}), onMessage: {addListener() {}, removeListener() {}} },
      storage: { local: {
        get(keys, callback) { const data = {...(typeof keys === 'object' && !Array.isArray(keys) ? keys : {}), ...values}; callback?.(data); return Promise.resolve(data); },
        async set(next) { Object.assign(values, next); const changes = Object.fromEntries(Object.entries(next).map(([key,newValue]) => [key,{newValue}])); for (const fn of listeners) fn(changes,'local'); }
      }, onChanged: {addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn)} }
    };
    Object.defineProperty(navigator, 'getGamepads', {value: () => [{ index:0, mapping:'standard', connected:true, axes:[0,0], buttons:Array.from({length:17},()=>({pressed:false,value:0})) }], configurable: true});
  })()`);
  await page.evaluate(() => Object.defineProperty(navigator, 'getGamepads', { value: () => [{ index: 0, mapping: 'standard', connected: true, axes: [0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) }], configurable: true }));
  await page.bringToFront();
  await page.addScriptTag({ content: bundleSource('bundles/main.js') });
  t.diagnostic('MAIN adapter evaluated');
  assert.equal(await page.locator('#yt-gamepad-overlay').count(), 0);
  assert.equal(await page.evaluate(() => Boolean(window[Symbol.for('yt-gamepad.main.dispose')])), false);
  await isolated(bundleSource('bundles/content.js'));
  t.diagnostic('ISOLATED bundle evaluated');
  await page.waitForFunction(() => document.documentElement.classList.contains('ytg-theater'));
  t.diagnostic('ISOLATED application enabled');
  assert.equal(await isolated("Boolean(window[Symbol.for('yt-gamepad.main.dispose')])"), true);
  await page.evaluate(() => window.postMessage({source:'yt-gamepad-settings',values:{enabled:false}},location.origin));
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('ytg-theater')), true);
  assert.equal(await page.locator('#yt-gamepad-overlay').count(), 1);
  assert.deepEqual(await page.evaluate(() => Object.keys(window).filter(key => key.startsWith('YTGamepad'))), []);
  assert.deepEqual(await isolated("Object.keys(window).filter(key => key.startsWith('YTGamepad'))"), []);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('yt-gamepad-action', { detail: { action: 'help' } })));
  await page.locator('#yt-gamepad-menu').getByRole('button', { name: 'All settings', exact: true }).waitFor();
  t.diagnostic('Vue quick menu opened');
  await page.locator('#yt-gamepad-menu').getByRole('button', { name: 'All settings', exact: true }).click();
  await page.locator('#yt-gamepad-menu [data-setting="general"]').waitFor();
  await isolated("chrome.storage.local.set({enabled:false})");
  await page.waitForFunction(() => !document.documentElement.classList.contains('ytg-theater'));
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#yt-gamepad-menu')).display === 'none');
  await page.addScriptTag({ content: bundleSource('bundles/main.js') });
  assert.equal(await page.locator('#yt-gamepad-overlay').count(), 1);
  await isolated(bundleSource('bundles/content.js'));
  assert.equal(await page.locator('#yt-gamepad-overlay').count(), 1);
  assert.equal(await page.locator('#yt-gamepad-menu').count(), 1);
  await isolated("chrome.storage.local.set({enabled:true})");
  await page.waitForFunction(() => document.documentElement.classList.contains('ytg-theater'));
});

test('bundled Vue pages persist settings and use popup message boundaries', { timeout: 30000 }, async t => {
  const options = await settingsPage(t, { stored: { autoFullscreen: true }, hash: '#gamepad' });
  assert.equal(await options.locator('#shortcuts').isVisible(), true);
  await options.locator('[data-category-link="display"]').click();
  await options.locator('#theater').uncheck();
  await options.locator('#status').filter({ hasText: 'Saved' }).waitFor();
  assert.deepEqual(await options.evaluate(() => [window.testStorage.theater, window.testStorage.autoFullscreen]), [false, true]);
  const popup = await settingsPage(t, { pageName: 'popup', stored: { autoFullscreen: true } });
  await popup.locator('#moreSettings').click();
  assert.equal(await popup.evaluate(() => window.testClosed), true);
  assert.equal(await popup.evaluate(() => window.testMessages.some(message => message.id === 3 && message.type === 'ytg-open-inline-settings')), true);
  const unavailable = await settingsPage(t, { pageName: 'popup', stored: { autoFullscreen: true }, available: false });
  await unavailable.locator('#moreSettings').click();
  await unavailable.locator('#status').filter({ hasText: 'Open a YouTube tab' }).waitFor();
  assert.equal(await unavailable.evaluate(() => window.testClosed), false);
});
