import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchExtension } from './helpers/extension.mjs';
import { next, player, option } from './helpers/watch-info-data.mjs';

test('destination frames release video loading while metadata requests are still pending', { timeout: 30000 }, async t => {
  const { context, worker } = await launchExtension(t);
  await worker.evaluate(() => chrome.storage.local.set({ enabled: true, autoFullscreen: false, playbackLayout: 'page' }));
  await context.addInitScript(() => {
    window.ytcfg = { get: key => ({ INNERTUBE_CONTEXT: { client: { clientName: 'WEB', clientVersion: 'fixture' }, user: {} } })[key] };
    document.addEventListener('DOMContentLoaded', () => {
      const video = document.querySelector('video'), native = document.querySelector('#movie_player');
      window.nativeVideoId = 'first';
      native.getVideoData = () => ({ video_id: window.nativeVideoId });
      Object.defineProperties(video, { readyState: { get: () => 3 }, videoWidth: { get: () => 1280 }, duration: { get: () => 60 } });
      document.querySelector('ytd-app').navigate_ = endpoint => {
        window.switchStartedAt = performance.now();
        document.dispatchEvent(new Event('yt-navigate-start'));
        history.pushState({}, '', endpoint.commandMetadata.webCommandMetadata.url);
        // YouTube exposes the new decoded picture before completing SPA navigation.
        window.nativeVideoId = endpoint.watchEndpoint.videoId;
        video.dispatchEvent(new Event('playing', { bubbles: true }));
      };
    });
  });
  const held = [];
  await context.route('https://www.youtube.com/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path.startsWith('/youtubei/v1/')) {
      const body = request.postDataJSON();
      if (body.videoId === 'second') { held.push(route); return; }
      const response = next();
      response.contents.twoColumnWatchNextResults.secondaryResults.secondaryResults.results = [{ compactVideoRenderer: {
        videoId: 'second', title: { simpleText: 'Second video' }, navigationEndpoint: { watchEndpoint: { videoId: 'second' } }
      } }];
      await route.fulfill({ json: path.endsWith('/player') ? player('first') : path.endsWith('/next') ? response : { contents: {} } });
      return;
    }
    await route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body><ytd-app><div id="movie_player" style="width:1280px;height:720px"><video class="html5-main-video" style="width:100%;height:100%"></video></div></ytd-app></body></html>' });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  await page.goto('https://www.youtube.com/watch?v=first', { waitUntil: 'domcontentloaded' });
  // DOM wrapper overrides are isolated per Chrome world. Simulate decoded
  // media in the extension's world as well as MAIN; no API response is released.
  const cdp = await context.newCDPSession(page), worlds = [];
  cdp.on('Runtime.executionContextCreated', ({ context }) => worlds.push(context.id));
  await cdp.send('Runtime.enable');
  for (const contextId of worlds) {
    await cdp.send('Runtime.evaluate', { contextId, expression: `(() => {
      const video = document.querySelector('video');
      if (video && video.videoWidth === 0) Object.defineProperties(video, {
        readyState: { get: () => 3 }, videoWidth: { get: () => 1280 }, duration: { get: () => 60 }
      });
    })()` });
  }
  await cdp.detach();
  const card = page.locator('#ytg-watch [data-video-id="second"]');
  await card.waitFor({ state: 'attached' });
  await page.waitForFunction(() => document.documentElement.dataset.ytgAdaptation === 'ready');
  // The recommendation row appears when the user opens playback controls.
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('yt-gamepad-action', { detail: { action: 'down' } })));
  await card.click({ force: true });
  await page.waitForURL('**/watch?v=second');
  try {
    await page.waitForFunction(() => document.documentElement.dataset.ytgAdaptation === 'ready' && document.querySelector('#ytg-watch-loading')?.hidden);
  } catch (error) {
    t.diagnostic(await page.evaluate(() => JSON.stringify({ route: location.pathname + location.search,
      adaptation: document.documentElement.dataset.ytgAdaptation, nativeId: window.nativeVideoId,
      loading: document.querySelector('#ytg-watch-loading')?.hidden, text: document.querySelector('#ytg-fallback-notice')?.textContent,
      video: { readyState: document.querySelector('video')?.readyState, width: document.querySelector('video')?.videoWidth } })));
    throw error;
  }
  assert.ok(held.length > 0, 'metadata transport has not completed');
  t.diagnostic(`Controls available with ${held.length} metadata requests pending; observed ${await page.evaluate(() => Math.round(performance.now() - window.switchStartedAt))} ms after navigation in this local fixture.`);
  assert.equal(await page.locator('body').evaluate(body => getComputedStyle(body).opacity), '1');
  assert.equal(await page.evaluate(() => Boolean(document.querySelector('video')?.videoWidth)), true);
  await page.evaluate(() => document.dispatchEvent(new Event('yt-navigate-finish')));
  for (const route of held) await route.abort().catch(() => {});
});

test('manifest watch metadata, reactions, subscription and playlist choices use API requests under CSP', { timeout: 45000 }, async t => {
  const { context, worker } = await launchExtension(t);
  await worker.evaluate(() => chrome.storage.local.set({ enabled: false }));
  await context.addCookies([{ name: 'SAPISID', value: 'fixture', domain: 'www.youtube.com', path: '/', secure: true }]);
  await context.addInitScript(() => {
    window.ytcfg = { get: key => ({ INNERTUBE_CONTEXT: { client: { clientName: 'WEB', clientVersion: 'browser-fixture' }, user: {} },
      LOGGED_IN: true, SESSION_INDEX: 2 })[key] };
  });
  const calls = [];
  await context.route('https://www.youtube.com/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path.startsWith('/youtubei/v1/')) {
      const body = request.postDataJSON(); calls.push({ path, body, headers: await request.allHeaders() });
      await route.fulfill({ json: path.endsWith('/player') ? player(body.videoId) : path.endsWith('/next') ? next() :
        path.endsWith('/get_add_to_playlist') ? { contents: { addToPlaylistRenderer: { playlists: [option('PLone'), option('WL', true)] } } } : { success: true } });
    } else await route.fulfill({ contentType: 'text/html', headers: {
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; connect-src 'self'"
    }, body: '<!doctype html><html><body><ytd-app></ytd-app></body></html>' });
  });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('https://www.youtube.com/watch?v=first');
  await page.evaluate(() => {
    window.invokeInfo = fields => new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      const timer = setTimeout(() => { document.removeEventListener('ytg-page-response-v1', receive); reject(Error('Bridge timeout')); }, 10000);
      function receive(event) {
        const response = JSON.parse(event.detail);
        if (response.id !== id) return;
        clearTimeout(timer); document.removeEventListener('ytg-page-response-v1', receive); resolve(response);
      }
      document.addEventListener('ytg-page-response-v1', receive);
      document.dispatchEvent(new CustomEvent('ytg-page-request-v1', { detail: JSON.stringify({ version: 1, id, ...fields }) }));
    });
  });
  const read = () => page.evaluate(() => window.invokeInfo({ operation: 'readWatchInfo' }));
  await read();
  await page.waitForFunction(async () => (await window.invokeInfo({ operation: 'readWatchInfo' })).value?.details?.videoId === 'first');
  const details = await read();
  assert.equal(details.value.details.title, 'Title first');
  await page.evaluate(() => window.invokeInfo({ operation: 'readWatchNext' }));
  await page.waitForFunction(async () => !(await window.invokeInfo({ operation: 'readWatchNext' })).value.loading);
  assert.equal(calls.filter(call => call.path.endsWith('/next')).length, 1, 'details and recommendations reuse one initial response');
  const action = action => page.evaluate(action => window.invokeInfo({ operation: 'watchAction', action }), action);
  assert.equal((await action('like')).value, true);
  assert.equal((await read()).value.liked, true);
  assert.equal((await action('subscribe')).value, true);
  assert.equal((await read()).value.subscribed, true);
  const lists = await page.evaluate(() => window.invokeInfo({ operation: 'watchPlaylists' }));
  assert.equal(lists.value.length, 2);
  assert.equal(JSON.stringify(lists).includes('private-set-id'), false);
  assert.equal(JSON.stringify(lists).includes('PLone'), true); // Title may include the playlist name/ID.
  assert.deepEqual(Object.keys(lists.value[0]).sort(), ['key', 'selected', 'title']);
  const saved = await page.evaluate(key => window.invokeInfo({ operation: 'watchPlaylistToggle', key }), lists.value[0].key);
  assert.equal(saved.value, true);
  assert.equal(calls.at(-1).body.playlistId, 'PLone');
  assert.equal(calls.at(-1).body.actions[0].action, 'ACTION_ADD_VIDEO');
  assert.match(calls.at(-1).headers.cookie, /SAPISID=fixture/);
  assert.match(calls.at(-1).headers.authorization, /^SAPISIDHASH /);
  assert.equal(calls.at(-1).headers['x-goog-authuser'], '2');
  assert.equal(await page.locator('#movie_player').count(), 0, 'metadata does not need the page player object');
  assert.deepEqual(errors, []);
});
