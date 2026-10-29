import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { launchExtension, virtualPad } from './helpers/extension.mjs';
import { next as watchNext, player as watchPlayer, option } from './helpers/watch-info-data.mjs';

const fixture = `<!doctype html><html><body style="margin:0;background:#101010;color:white"><ytd-app><ytd-page-manager><ytd-shorts>
<ytd-reel-video-renderer id="previous"><video id="inactive"></video></ytd-reel-video-renderer>
<ytd-reel-video-renderer id="current" is-active style="display:block;margin:auto;width:360px;height:700px;background:#444">Shorts player<video id="active"></video></ytd-reel-video-renderer>
<ytd-reel-video-renderer id="following"><video id="next"></video></ytd-reel-video-renderer>
<div id="navigation-button-up"><button>Previous</button></div><div id="navigation-button-down"><button>Next</button></div>
</ytd-shorts></ytd-page-manager></ytd-app><script>
window.ytcfg={get:key=>key==='INNERTUBE_CONTEXT'?{client:{clientVersion:'test'}}:undefined};
window.switches=[];
for (const video of document.querySelectorAll('video')) {
 video.dataset.paused='false';video.dataset.position='10';
 Object.defineProperties(video,{paused:{get:()=>video.dataset.paused==='true'},duration:{get:()=>30},currentTime:{get:()=>Number(video.dataset.position),set:value=>video.dataset.position=String(value)}});
 video.pause=()=>{video.dataset.paused='true'};video.play=async()=>{video.dataset.paused='false'};
}
for (const [direction,id] of [['down','following'],['up','current']]) document.querySelector('#navigation-button-'+direction+' button').onclick=()=>{
 window.switches.push(direction);document.dispatchEvent(new Event('yt-navigate-start'));
 document.querySelector('[is-active]').removeAttribute('is-active');document.getElementById(id).setAttribute('is-active','');
 history.pushState({},'', '/shorts/'+id);document.dispatchEvent(new Event('yt-navigate-finish'));
};
</script></body></html>`;

async function installMedia(context, page, rejectPlay = false) {
  // Native media state is normally shared across worlds. Mirror our DOM-backed
  // test player in ISOLATED too, where the production controller reads it.
  const cdp = await context.newCDPSession(page), worlds = [];
  cdp.on('Runtime.executionContextCreated', ({ context }) => worlds.push(context.id));
  await cdp.send('Runtime.enable');
  for (const contextId of worlds) await cdp.send('Runtime.evaluate', { contextId, expression: `
    for (const video of document.querySelectorAll('video')) {
      Object.defineProperties(video,{readyState:{configurable:true,get:()=>3},paused:{configurable:true,get:()=>video.dataset.paused==='true'},duration:{configurable:true,get:()=>30},currentTime:{configurable:true,get:()=>Number(video.dataset.position),set:value=>video.dataset.position=String(value)}});
      video.pause=()=>{video.dataset.paused='true'};video.play=async()=>{if (${rejectPlay}) throw new Error('autoplay blocked');video.dataset.paused='false'};
    }` });
  await cdp.detach();
}

async function installShortsContext(context) {
  await context.addInitScript(() => {
    window.ytcfg ||= { get: key => key === 'INNERTUBE_CONTEXT'
      ? { client: { clientName: 'WEB', clientVersion: 'shorts-fixture' } } : undefined };
  });
}

async function installShortsAPI(context, ids, autoPlayer = true) {
  await context.route('https://www.youtube.com/youtubei/v1/reel/**', route => route.fulfill({ json: route.request().url().includes('reel_item_watch')
    ? { playerResponse: { playabilityStatus: { status: 'OK' } } }
    : { entries: ids.map(videoId => ({ reelWatchEndpoint: { videoId } })) } }));
  if (autoPlayer) await context.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const video = document.querySelector('#active'); if (!video) return;
      let player = video.closest('.html5-video-player');
      if (!player) { player = document.createElement('div'); player.id = 'shorts-player'; player.className = 'html5-video-player'; video.replaceWith(player); player.append(video); }
      let current = location.pathname.split('/')[2]; window.apiLoads = [];
      player.getVideoData = () => ({ video_id: current });
      player.loadVideoById = id => { current = id; window.apiLoads.push(id); video.dataset.paused = 'false'; };
    });
  });
}

async function pressPad(page, button) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.evaluate(button => new Promise((resolve, reject) => {
    const neutral = () => document.documentElement.setAttribute('data-test-pad', JSON.stringify({ connected: true }));
    const cleanup = () => { clearTimeout(timer); window.removeEventListener('yt-gamepad-action', received, true); neutral(); };
    const received = () => { cleanup(); resolve(); };
    const timer = setTimeout(() => { cleanup(); reject(new Error(`Gamepad button ${button} was not sampled`)); }, 5000);
    // Release on the real input event, before a slow driver round trip can become a held/repeated press.
    window.addEventListener('yt-gamepad-action', received, true);
    document.documentElement.setAttribute('data-test-pad', JSON.stringify({ connected: true, button }));
  }), button);
}

test('actual gamepad input controls the active Short, switches reels, respects dialogs and returns to the feed', { timeout: 45000 }, async t => {
  const { context, worker } = await launchExtension(t);
  await worker.evaluate(() => chrome.storage.local.set({ enabled: true, autoFullscreen: false, uiLanguage: 'zh-CN' }));
  await context.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html', body: fixture }));
  await installShortsAPI(context, ['following']);
  const page = await context.newPage();
  await page.goto('https://www.youtube.com/feed/subscriptions');
  await page.goto('https://www.youtube.com/shorts/JnICtQ9VHJ8');
  const bar = page.locator('#ytg-shorts-controls');
  await bar.waitFor({ state: 'visible' });
  await installMedia(context, page);
  const pad = await virtualPad(context, page);
  await page.bringToFront(); await pad({ connected: true }); await page.waitForTimeout(150);
  const press = button => pressPad(page, button);
  await press(0);
  assert.equal(await page.locator('#active').getAttribute('data-paused'), 'true');
  assert.equal(await page.locator('#inactive').getAttribute('data-paused'), 'false');
  await press(2);
  assert.equal(await page.locator('#active').getAttribute('data-paused'), 'false');
  await page.evaluate(() => {
    document.querySelector('#current').removeAttribute('is-active');
    document.querySelector('#previous').setAttribute('is-active', '');
    document.querySelector('#previous').style.display = 'none';
  });
  await press(5);
  assert.equal(await page.locator('#active').getAttribute('data-position'), '15');
  assert.equal(await page.locator('#inactive').getAttribute('data-position'), '10', 'hidden cached reels never own playback, even with a stale active marker');
  await press(4);
  assert.equal(await page.locator('#active').getAttribute('data-position'), '10');
  await page.locator('#active').evaluate(video => { video.volume = .5; });
  await press(7);
  assert.ok(await page.locator('#active').evaluate(video => video.volume) > .5);
  await page.evaluate(() => {
    document.querySelector('#previous').removeAttribute('is-active');
    document.querySelector('#current').setAttribute('is-active', '');
  });
  await page.evaluate(() => { const dialog = document.createElement('div'); dialog.id = 'native-dialog'; dialog.setAttribute('role','dialog'); dialog.innerHTML='<button>Close</button>'; document.body.append(dialog); });
  await press(13);
  assert.deepEqual(await page.evaluate(() => window.switches), [], 'native dialogs own directions');
  await page.locator('#native-dialog').evaluate(node => node.remove());
  await press(13);
  await page.waitForURL('**/shorts/following');
  await press(0);
  assert.equal(await page.locator('#active').getAttribute('data-paused'), 'true');
  assert.deepEqual(await page.evaluate(() => window.switches), [], 'playback uses the API rather than native reel controls');
  await page.waitForTimeout(200);
  await press(12);
  await page.waitForURL('**/shorts/JnICtQ9VHJ8');
  mkdirSync('output/playwright', { recursive: true });
  await page.screenshot({ path: 'output/playwright/shorts-gamepad.png' });
  await press(1);
  await page.waitForURL('**/feed/subscriptions');
  await page.locator('#ytg-shorts-controls').waitFor({ state: 'hidden' });
});

test('Shorts playback errors stay in our player and offer an in-place retry', { timeout: 45000 }, async t => {
  const { context, worker } = await launchExtension(t);
  await worker.evaluate(() => chrome.storage.local.set({ enabled: true, autoFullscreen: false }));
  let missingLoads = 0;
  await context.route('https://www.youtube.com/**', route => {
    const missing = route.request().url().includes('/shorts/missing');
    if (missing && route.request().isNavigationRequest()) missingLoads++;
    return route.fulfill({ contentType: 'text/html', body: missing ? '<html><body><ytd-app></ytd-app></body></html>' : shortsFixture });
  });
  const page = await context.newPage();
  await page.goto('https://www.youtube.com/shorts/first');
  const player = page.locator('#ytg-shorts-controls'); await player.waitFor();
  await installMedia(context, page, true);
  await page.locator('#active').evaluate(node => { node.dataset.paused = 'true'; });
  await player.locator('[data-shorts-action=playPause]').click();
  await player.getByRole('status').filter({ hasText: 'Playback was blocked' }).waitFor();
  await page.waitForTimeout(700);
  assert.match(await player.getByRole('status').textContent(), /Playback was blocked/);
  const retry = player.getByRole('button', { name: 'Retry playback', exact: true });
  await retry.waitFor();
  await installMedia(context, page);
  await retry.click();
  await page.waitForFunction(() => document.querySelector('#active').dataset.paused === 'false');
  await retry.waitFor({ state: 'hidden' });
  await page.locator('#active').evaluate(video => { video.src = '/invalid-media'; video.load(); });
  await player.getByRole('status').filter({ hasText: 'Video could not play' }).waitFor();
  await retry.waitFor();
  assert.equal(await page.locator('html').evaluate(node => node.classList.contains('ytg-shorts-player')), true, 'media errors never reveal the native interface');
  await page.goto('https://www.youtube.com/shorts/missing');
  await retry.waitFor({ state: 'visible', timeout: 14000 });
  assert.equal(await page.locator('html').evaluate(node => node.classList.contains('ytg-shorts-player')), true);
  assert.equal(await player.getByRole('button', { name: 'Use YouTube controls', exact: true }).count(), 0);
  await Promise.all([page.waitForEvent('load'), retry.click()]);
  await player.waitFor();
  assert.equal(missingLoads, 2, 'retry reloads this native Short without leaving our player');
  assert.equal(await page.locator('html').evaluate(node => node.classList.contains('ytg-shorts-player')), true);
});

test('Shorts use saved watch bindings and hide their toolbar when disabled or leaving Shorts', { timeout: 45000 }, async t => {
  const { context, worker } = await launchExtension(t);
  await worker.evaluate(() => chrome.storage.local.set({ enabled: true, autoFullscreen: false,
    bindingLayouts: { watch: { confirm: 2, playPause: 0 }, browse: { confirm: 0, playPause: 2 } } }));
  await context.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html', body: fixture }));
  const page = await context.newPage(); await page.goto('https://www.youtube.com/shorts/JnICtQ9VHJ8');
  const bar = page.locator('#ytg-shorts-controls'); await bar.waitFor();
  await installMedia(context, page);
  const pad = await virtualPad(context, page); await page.bringToFront(); await pad({ connected: true }); await page.waitForTimeout(150);
  await pressPad(page, 0);
  assert.equal(await page.locator('#active').getAttribute('data-paused'), 'true', 'watch playPause binding runs on Shorts');
  await worker.evaluate(() => chrome.storage.local.set({ enabled: false }));
  await bar.waitFor({ state: 'hidden' });
  await pad({ connected: true, button: 0 }); await page.waitForTimeout(150); await pad({ connected: true });
  assert.equal(await page.locator('#active').getAttribute('data-paused'), 'true');
  await worker.evaluate(() => chrome.storage.local.set({ enabled: true }));
  await bar.waitFor({ state: 'visible' });
  await page.evaluate(() => { history.pushState({}, '', '/feed/history'); document.dispatchEvent(new Event('yt-navigate-finish')); });
  await bar.waitFor({ state: 'hidden' });
});

const shortsFixture = `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#111;color:white">
<ytd-app><ytd-page-manager><ytd-shorts><ytd-reel-video-renderer is-active style="display:block;width:360px;height:700px;position:relative;z-index:1"><div id="player" style="position:relative;z-index:1"><div id="shorts-player" class="html5-video-player"><div class="html5-video-container"><video id="active" muted></video></div><div class="ytp-chrome-bottom"><button>Native play</button></div></div></div>
<h1><yt-formatted-string>City lights · Shorts</yt-formatted-string></h1><div id="channel-name">Travel channel</div></ytd-reel-video-renderer></ytd-shorts></ytd-page-manager></ytd-app>
<script>for(const video of document.querySelectorAll('video')){video.dataset.paused='false';video.dataset.position='10';Object.defineProperties(video,{paused:{get:()=>video.dataset.paused==='true'},duration:{get:()=>30},currentTime:{get:()=>Number(video.dataset.position),set:v=>video.dataset.position=String(v)}});video.pause=()=>video.dataset.paused='true';video.play=async()=>{video.dataset.paused='false'}};</script></body></html>`;

test('Shorts use a gamepad action rail and consume one wheel gesture per video', { timeout: 45000 }, async t => {
  const { context, worker } = await launchExtension(t);
  await worker.evaluate(() => chrome.storage.local.set({ enabled: true, autoFullscreen: false, uiLanguage: 'en' }));
  await context.addCookies([{ name: 'SAPISID', value: 'shorts-fixture', domain: 'www.youtube.com', path: '/', secure: true }]);
  await context.addInitScript(() => {
    window.ytcfg = { get: key => ({ INNERTUBE_CONTEXT: { client: { clientName: 'WEB', clientVersion: 'shorts-fixture' }, user: {} }, LOGGED_IN: true })[key] };
  });
  await context.route('https://www.youtube.com/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.startsWith('/youtubei/v1/')) return route.fulfill({ json: path.endsWith('/player') ? watchPlayer(route.request().postDataJSON().videoId) : path.endsWith('/next') ? watchNext() : {} });
    return route.fulfill({ contentType: 'text/html', body: fixture.replace(/window\.ytcfg=\{get:key=>key==='INNERTUBE_CONTEXT'\?\{client:\{clientVersion:'test'\}\}:undefined\};/, '') });
  });
  await installShortsAPI(context, ['following']);
  const page = await context.newPage();
  await page.goto('https://www.youtube.com/feed/subscriptions');
  await page.goto('https://www.youtube.com/shorts/JnICtQ9VHJ8');
  const controls = page.locator('#ytg-shorts-controls'); await controls.waitFor(); await installMedia(context, page);
  await controls.locator('[data-shorts-action=like]:enabled').waitFor();
  assert.equal(await controls.locator('.rail .media-action').count(), 4);
  const centers = await controls.locator('.rail button svg').evaluateAll(icons => icons.map(icon => {
    const rect = icon.getBoundingClientRect(); return rect.left + rect.width / 2;
  }));
  assert.equal(centers.length, 5);
  assert.ok(Math.max(...centers) - Math.min(...centers) < 1, 'Shorts action icons and More share one vertical centerline');
  const mute = controls.locator('.rail [data-shorts-action=mute]');
  await mute.click();
  await page.waitForFunction(() => document.querySelector('#ytg-shorts-controls').shadowRoot.querySelector('[data-shorts-action=mute]').getAttribute('aria-pressed') === 'true');
  assert.equal(await page.locator('#active').evaluate(video => video.muted), true);
  await mute.click();
  await page.waitForFunction(() => document.querySelector('#ytg-shorts-controls').shadowRoot.querySelector('[data-shorts-action=mute]').getAttribute('aria-pressed') === 'false');
  await controls.locator('[data-shorts-action=playPause]').focus();
  const pad = await virtualPad(context, page); await page.bringToFront(); await pad({ connected: true }); await page.waitForTimeout(150);
  const press = button => pressPad(page, button);
  const focusedAction = () => page.evaluate(() => document.querySelector('#ytg-shorts-controls').shadowRoot.activeElement?.dataset.shortsAction);
  await press(15); assert.equal(await focusedAction(), 'like', 'right enters the action rail');
  await press(13); assert.equal(await focusedAction(), 'comments', 'vertical input selects an action in the rail');
  assert.match(page.url(), /\/shorts\/JnICtQ9VHJ8$/);
  await press(0); await controls.locator('.drawer').waitFor();
  assert.equal(await controls.getByRole('button', { name: 'Use YouTube controls', exact: true }).count(), 0);
  await page.evaluate(() => window.dispatchEvent(new WheelEvent('wheel', { deltaY: 400, cancelable: true })));
  assert.deepEqual(await page.evaluate(() => window.switches), [], 'an open drawer owns scrolling');
  await press(1); assert.equal(await controls.locator('.drawer').isVisible(), false); assert.equal(await focusedAction(), 'comments');
  await press(1); assert.equal(await focusedAction(), 'playPause', 'B leaves the rail before returning to the feed');
  await press(5); assert.equal(await page.locator('#active').getAttribute('data-position'), '15', 'the shoulder button seeks without entering the rail');
  await page.evaluate(() => { for (let i = 0; i < 5; i++) window.dispatchEvent(new WheelEvent('wheel', { deltaY: 400, cancelable: true })); });
  await page.waitForURL('**/shorts/following');
  assert.deepEqual(await page.evaluate(() => window.apiLoads), ['following'], 'a wheel burst only changes one video');
  assert.deepEqual(await page.evaluate(() => window.switches), [], 'wheel switching never clicks native controls');
  await page.waitForTimeout(220);
  await page.evaluate(() => window.dispatchEvent(new WheelEvent('wheel', { deltaY: -400, cancelable: true })));
  await page.waitForURL('**/shorts/JnICtQ9VHJ8');
  await press(9); await controls.locator('.drawer').waitFor();
  assert.equal(await controls.getByRole('button', { name: 'Use YouTube controls', exact: true }).count(), 0, 'More has no native-player escape');
  await press(1); await press(1); await page.waitForURL('**/feed/subscriptions');
});

test('opening a list card loads and controls native Shorts media without visiting watch', { timeout: 45000 }, async t => {
  const { context, worker } = await launchExtension(t);
  await worker.evaluate(() => chrome.storage.local.set({ enabled: true, autoFullscreen: false, uiLanguage: 'en' }));
  const paths = [];
  const feed = { contents: ['first', 'second'].map(videoId => ({ reelItemRenderer: { videoId, headline: { simpleText: 'Short ' + videoId } } })) };
  await context.route('https://i.ytimg.com/**', route => route.fulfill({ status: 204 }));
  await context.route('https://www.youtube.com/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.startsWith('/youtubei/')) return route.fulfill({ json: path.endsWith('/browse') ? feed : {} });
    if (route.request().isNavigationRequest()) paths.push(path);
    return route.fulfill({ contentType: 'text/html', body: path.startsWith('/shorts/')
      ? shortsFixture.replace(/<script>[\s\S]*?<\/script>/, '')
      : '<html><body><ytd-app></ytd-app><script>window.ytcfg={get:key=>key==="INNERTUBE_CONTEXT"?{client:{clientVersion:"test"}}:undefined}</script></body></html>' });
  });
  await installShortsAPI(context, ['second']);
  const page = await context.newPage();
  await page.goto('https://www.youtube.com/feed/subscriptions');
  await page.evaluate(html => {
    document.querySelector('ytd-app').navigate_ = endpoint => {
      document.dispatchEvent(new Event('yt-navigate-start'));
      document.querySelector('ytd-app').innerHTML = new DOMParser().parseFromString(html, 'text/html').querySelector('ytd-app').innerHTML;
      history.pushState({}, '', endpoint.commandMetadata.webCommandMetadata.url);
      document.dispatchEvent(new Event('yt-navigate-finish'));
    };
  }, shortsFixture.replace(/<script>[\s\S]*?<\/script>/, ''));
  await page.locator('[data-browse-id="short:first"]').click();
  await page.waitForURL('**/shorts/first');
  const player = page.locator('#ytg-shorts-controls'); await player.waitFor();
  await page.evaluate(async () => {
    const video = document.querySelector('video'), canvas = document.createElement('canvas');
    canvas.width = 360; canvas.height = 640;
    const ctx = canvas.getContext('2d');
    const paint = () => { ctx.fillStyle = '#174e66'; ctx.fillRect(0, 0, 360, 640); requestAnimationFrame(paint); }; paint();
    video.srcObject = canvas.captureStream(15); video.muted = true; await video.play();
    await new Promise(resolve => video.requestVideoFrameCallback(resolve));
  });
  assert.deepEqual(paths, ['/feed/subscriptions'], 'opening Shorts uses the native router without replacing the document');
  assert.equal(await player.locator('.count').textContent(), '1 / 2');
  assert.equal(await page.locator('video').evaluate(video => video.videoHeight), 640);
  assert.equal(await page.locator('video').isVisible(), true);
  await player.locator('[data-shorts-action=playPause]').click();
  await page.waitForFunction(() => document.querySelector('video').paused);
  await player.locator('[data-shorts-action=playPause]').click();
  await page.waitForFunction(() => !document.querySelector('video').paused);
  await player.getByRole('button', { name: 'Back to feed', exact: true }).click();
  await page.waitForURL('**/feed/subscriptions');
  await page.locator('[data-browse-id="short:first"]').waitFor();
});

test('native list Shorts retain their queue across refresh, gamepad switching and returning to the feed', { timeout: 45000 }, async t => {
  const { context, worker } = await launchExtension(t);
  await worker.evaluate(() => chrome.storage.local.set({ enabled: true, autoFullscreen: false }));
  await context.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html', body: shortsFixture }));
  await context.addInitScript(() => {
    window.ytcfg = { get: key => key === 'INNERTUBE_CONTEXT'
      ? { client: { clientName: 'WEB', clientVersion: 'shorts-fixture' }, user: {} } : undefined };
  });
  await installShortsAPI(context, ['second']);
  const page = await context.newPage();
  await page.goto('https://www.youtube.com/feed/subscriptions');
  await page.evaluate(() => sessionStorage.setItem('ytg-shorts-queue-v1', JSON.stringify({ ids: ['first', 'second'], currentId: 'first', returnTo: '/feed/subscriptions' })));
  await page.goto('https://www.youtube.com/shorts/first');
  const player = page.locator('#ytg-shorts-controls'); await player.waitFor();
  await installMedia(context, page);
  await page.bringToFront();
  await page.waitForFunction(() => document.documentElement.classList.contains('ytg-shorts-player'));
  assert.equal(await page.locator('html').evaluate(node => node.classList.contains('ytg-watch-layout')), false);
  assert.equal(await page.locator('html').getAttribute('data-ytg-playback-layout'), null, 'Shorts keeps its own layout instead of a regular-video layout');
  assert.equal(await player.locator('.title').textContent(), 'Shorts', 'missing API metadata never falls back to page titles');
  assert.equal(await player.locator('.author').textContent(), 'YouTube');
  // Controls mount before the asynchronous recommendation sequence finishes.
  await page.waitForFunction(() => document.querySelector('#ytg-shorts-controls')?.shadowRoot?.querySelector('.count')?.textContent === '1 / 2');
  assert.equal(await player.locator('.count').textContent(), '1 / 2');
  assert.equal(await player.locator('[data-shorts-action=up]').isDisabled(), true);
  await page.reload(); await player.waitFor(); await installMedia(context, page);
  await page.bringToFront();
  await page.waitForFunction(() => document.querySelector('#ytg-shorts-controls')?.shadowRoot?.querySelector('.play')?.getAttribute('aria-pressed') === 'true');
  await page.evaluate(() => {
    document.querySelector('ytd-app').navigate_ = endpoint => {
      document.dispatchEvent(new Event('yt-navigate-start'));
      history.pushState({}, '', endpoint.commandMetadata.webCommandMetadata.url);
      document.dispatchEvent(new Event('yt-navigate-finish'));
    };
  });
  await page.waitForFunction(() => document.querySelector('#ytg-shorts-controls')?.shadowRoot?.querySelector('.count')?.textContent === '1 / 2');
  assert.equal(await player.locator('.count').textContent(), '1 / 2', 'a refresh preserves list ownership on the native Shorts route');
  const refreshedPad = await virtualPad(context, page); await refreshedPad({ connected: true }); await page.waitForTimeout(150);
  const refreshedPress = async button => { await refreshedPad({ connected: true, button }); await page.waitForTimeout(120); await refreshedPad({ connected: true }); await page.waitForTimeout(120); };
  await refreshedPress(0); assert.equal(await page.locator('#active').getAttribute('data-paused'), 'true');
  await refreshedPress(2); assert.equal(await page.locator('#active').getAttribute('data-paused'), 'false');
  await refreshedPress(5); assert.equal(await page.locator('#active').getAttribute('data-position'), '15');
  await refreshedPad({ connected: true, button: 13 }); await page.waitForURL('**/shorts/second');
  await player.waitFor(); await installMedia(context, page);
  await page.waitForFunction(() => document.querySelector('#ytg-shorts-controls')?.shadowRoot?.querySelector('.count')?.textContent === '2 / 2');
  assert.equal(await player.locator('.count').textContent(), '2 / 2');
  assert.equal(await player.locator('[data-shorts-action=down]').isDisabled(), true);
  const secondPad = await virtualPad(context, page); await secondPad({ connected: true }); await page.waitForTimeout(150);
  await secondPad({ connected: true, button: 1 });
  await page.waitForURL('**/feed/subscriptions');
});

test('dedicated Shorts shows real media frames and restores media layout only when disabled', { timeout: 45000 }, async t => {
  const { context, worker } = await launchExtension(t);
  await worker.evaluate(() => chrome.storage.local.set({ enabled: true, autoFullscreen: false }));
  await context.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html', body: shortsFixture.replace(/<script>[\s\S]*?<\/script>/, '') }));
  const page = await context.newPage(); await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('https://www.youtube.com/shorts/first');
  const player = page.locator('#ytg-shorts-controls'); await player.waitFor();
  await page.evaluate(async () => {
    const video = document.querySelector('video'), canvas = document.createElement('canvas'); canvas.width = 360; canvas.height = 640;
    const ctx = canvas.getContext('2d');
    const paint = () => { ctx.fillStyle = '#174e66'; ctx.fillRect(0,0,360,640); ctx.fillStyle = '#f6c380'; ctx.fillRect(0,350,360,290); ctx.fillStyle = '#fff'; ctx.font = '28px system-ui'; ctx.fillText('Shorts playback', 55, 250); requestAnimationFrame(paint); }; paint();
    video.srcObject = canvas.captureStream(15); video.muted = true; await video.play();
  });
  await page.waitForFunction(() => document.querySelector('video').readyState >= 2 && document.querySelector('video').videoHeight === 640);
  await page.waitForFunction(() => document.querySelector('video').loop);
  await page.waitForFunction(() => document.querySelector('#ytg-shorts-controls')?.shadowRoot?.querySelector('.play')?.getAttribute('aria-pressed') === 'true');
  await page.locator('#shorts-player').evaluate(node => node.classList.add('ad-showing'));
  await page.waitForFunction(() => !document.querySelector('video').loop);
  assert.equal(await player.locator('.play').isVisible(), false, 'ads retain native pointer controls');
  await page.locator('#shorts-player').evaluate(node => node.classList.remove('ad-showing'));
  await page.waitForFunction(() => document.querySelector('video').loop);
  assert.equal(await player.locator('.play').isVisible(), true);
  assert.equal(await page.locator('#active').evaluate(node => { const r=node.getBoundingClientRect(); return r.height > 500 && r.width > 250 && getComputedStyle(node).visibility !== 'hidden'; }), true, 'video retains a visible portrait surface below the transparent play target');
  mkdirSync('output/playwright', { recursive: true });
  await page.screenshot({ path: 'output/playwright/shorts-dedicated-desktop.png' });
  await page.setViewportSize({ width: 867, height: 507 });
  for (const button of await player.locator('.rail button').all()) {
    const bounds = await button.boundingBox();
    assert.ok(bounds && bounds.y >= 0 && bounds.y + bounds.height <= 507, 'every side action remains on screen in a short window');
  }
  await page.screenshot({ path: 'output/playwright/shorts-gamepad-small-window.png' });
  await page.setViewportSize({ width: 600, height: 900 });
  await page.screenshot({ path: 'output/playwright/shorts-dedicated-compact.png' });
  assert.equal(await player.getByRole('button', { name: 'Use YouTube controls', exact: true }).count(), 0);
  await worker.evaluate(() => chrome.storage.local.set({ enabled: false })); await player.waitFor({ state: 'hidden' });
  assert.equal(await page.locator('#active').evaluate(node => node.loop), false);
});

test('Shorts drawers use real comments, reactions and playlists and isolate directional input', { timeout: 45000 }, async t => {
  const { context, worker } = await launchExtension(t);
  await worker.evaluate(() => chrome.storage.local.set({ enabled: true, uiLanguage: 'en' }));
  await context.addCookies([{ name: 'SAPISID', value: 'shorts-fixture', domain: 'www.youtube.com', path: '/', secure: true }]);
  await context.addInitScript(() => {
    window.ytcfg = { get: key => ({ INNERTUBE_CONTEXT: { client: { clientName: 'WEB', clientVersion: 'shorts-fixture' }, user: {} }, LOGGED_IN: true })[key] };
  });
  const calls = [];
  await context.route('https://www.youtube.com/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path.startsWith('/youtubei/v1/')) {
      const body = request.postDataJSON(); calls.push({ path, body });
      const isReply = body.continuation === 'short-replies';
      const commentId = isReply ? 'short-reply' : 'short-comment', entityKey = 'key:' + commentId;
      const comment = { onResponseReceivedEndpoints: [
        ...(!isReply ? [{ reloadContinuationItemsCommand: { continuationItems: [] } }] : []),
        { appendContinuationItemsAction: { continuationItems: [{ commentThreadRenderer: {
          commentViewModel: { commentViewModel: { commentId, commentKey: entityKey } },
          ...(!isReply ? { replies: { commentRepliesRenderer: { subThreads: [{ continuationItemRenderer: {
            continuationEndpoint: { continuationCommand: { token: 'short-replies', request: 'CONTINUATION_REQUEST_TYPE_WATCH_NEXT' } }
          } }] } } } : {})
        } }] } }
      ], frameworkUpdates: { entityBatchUpdate: { mutations: [{ payload: { commentEntityPayload: {
        key: entityKey, properties: { content: { content: isReply ? 'A reply on this Short.' : 'A comment on this Short.' } },
        author: { displayName: 'Shorts viewer', channelId: 'UCviewer' }, toolbar: { replyCount: isReply ? '0' : '1' }
      } } }] } } };
      await route.fulfill({ json: path.endsWith('/player') ? watchPlayer(body.videoId) : path.endsWith('/next') ? body.continuation ? comment : watchNext()
        : path.endsWith('/get_add_to_playlist') ? { contents: { addToPlaylistRenderer: { playlists: [option('PLshorts')] } } } : { success: true } });
    } else await route.fulfill({ contentType: 'text/html', body: shortsFixture });
  });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('https://www.youtube.com/shorts/first');
  const player = page.locator('#ytg-shorts-controls'); await player.waitFor(); await installMedia(context, page);
  await player.locator('.title').filter({ hasText: 'Title first' }).waitFor();
  const before = await page.locator('#shorts-player').boundingBox();
  await player.locator('[data-shorts-action=comments]').click();
  try { await player.locator('.comment-text').filter({ hasText: 'A comment on this Short.' }).waitFor({ timeout: 10000 }); }
  catch (error) { t.diagnostic(JSON.stringify({ calls, panel: await player.locator('.drawer').textContent(), errors })); throw error; }
  assert.equal(await player.locator('[data-vue-comments] .comment-thread').count(), 1, 'Shorts use the shared comment component');
  for (const selector of ['.comment-author', '.comment-text']) {
    const typography = await player.locator(`[data-vue-comments] ${selector}`).evaluate(node => {
      const style = getComputedStyle(node);
      return { fontSize: style.fontSize, lineHeight: style.lineHeight, fontWeight: style.fontWeight, color: style.color };
    });
    assert.deepEqual(typography, { ...(selector === '.comment-author' ? { fontSize: '13px', lineHeight: '18px', fontWeight: '500' } : { fontSize: '16px', lineHeight: '24px', fontWeight: '400' }), color: 'rgb(15, 15, 15)' });
  }
  await page.waitForTimeout(250);
  const after = await page.locator('#shorts-player').boundingBox();
  const drawer = await player.locator('.drawer').boundingBox();
  const stage = await player.locator('.stage').boundingBox();
  assert.ok(Math.abs(stage.x - after.x) < 2 && Math.abs(stage.width - after.width) < 2, `overlay follows the video: ${JSON.stringify({ stage, after })}`);
  assert.ok(after.x < before.x, 'opening comments shifts the video left');
  assert.ok(after.x + after.width <= drawer.x, 'the drawer does not cover the video');
  const pad = await virtualPad(context, page); await page.bringToFront(); await pad({ connected: true }); await page.waitForTimeout(100);
  const press = button => pressPad(page, button);
  await player.locator('[data-focus-id="replies:short-comment"]').click();
  await player.locator('[data-comment-detail] .detail-replies .comment-text').filter({ hasText: 'A reply on this Short.' }).waitFor();
  assert.equal(await player.locator('.reply-connection').last().evaluate(node => getComputedStyle(node).borderBottomLeftRadius), '16px');
  assert.equal(await player.locator('.detail-replies .reply-continuation').last().isVisible(), false);
  await press(1);
  assert.equal(await player.locator('.drawer').isVisible(), true, 'B returns from replies to comments before closing');
  assert.equal(await player.locator('[data-comment-detail]').count(), 0);
  assert.equal(await player.evaluate(host => host.shadowRoot.activeElement?.dataset.focusId), 'replies:short-comment', 'returning from replies restores the original comment action');
  await press(13);
  assert.match(page.url(), /\/shorts\/first$/, 'comments own down instead of changing the video');
  await press(1); assert.equal(await player.locator('.drawer').isVisible(), false);
  await player.locator('[data-shorts-action=like]').click();
  await page.waitForFunction(() => document.querySelector('#ytg-shorts-controls').shadowRoot.querySelector('[data-shorts-action=like]').getAttribute('aria-pressed') === 'true');
  assert.equal(calls.filter(call => call.path.endsWith('/like/like')).length, 1);
  await player.locator('[data-shorts-action=save]').click();
  const playlist = player.locator('[data-focus-id="playlist:0"]'); await playlist.waitFor(); await playlist.click();
  await page.waitForFunction(() => document.querySelector('#ytg-shorts-controls').shadowRoot.querySelector('[data-focus-id="playlist:0"]')?.getAttribute('aria-pressed') === 'true');
  assert.equal(calls.filter(call => call.path.endsWith('/browse/edit_playlist')).length, 1);
  await press(1); await press(9);
  assert.equal(await player.getAttribute('data-panel'), 'actions', 'Start opens the Shorts action menu');
  await press(1); assert.equal(await player.locator('.drawer').isVisible(), false);
  mkdirSync('output/playwright', { recursive: true });
  await player.locator('[data-shorts-action=comments]').click();
  await page.screenshot({ path: 'output/playwright/shorts-comments-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'output/playwright/shorts-comments-mobile.png' });
  assert.ok(await player.locator('.drawer').evaluate(el => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; }));
  assert.deepEqual(errors, []);
});

test('Shorts playback parameters update live and clamp progress and volume', { timeout: 45000 }, async t => {
  const { context, worker } = await launchExtension(t);
  await worker.evaluate(() => chrome.storage.local.set({ enabled: true, autoFullscreen: false, shortsSeekStep: 8, volumeStep: 12, repeatDelay: 1000 }));
  await context.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html', body: shortsFixture }));
  const page = await context.newPage(); await page.goto('https://www.youtube.com/shorts/first');
  await page.locator('#ytg-shorts-controls').waitFor(); await installMedia(context, page);
  const pad = await virtualPad(context, page); await page.bringToFront(); await pad({ connected: true }); await page.waitForTimeout(150);
  const press = button => pressPad(page, button);
  await page.locator('#active').evaluate(video => { video.volume = .5; });
  await press(5); assert.equal(await page.locator('#active').getAttribute('data-position'), '18');
  await press(7); assert.equal(await page.locator('#active').evaluate(video => video.volume), .62);
  await worker.evaluate(() => chrome.storage.local.set({ shortsSeekStep: 30, volumeStep: 25 }));
  await page.waitForTimeout(200);
  await press(5); assert.equal(await page.locator('#active').getAttribute('data-position'), '30');
  await press(4); assert.equal(await page.locator('#active').getAttribute('data-position'), '0');
  await press(7); await press(7); assert.equal(await page.locator('#active').evaluate(video => video.volume), 1);
});

test('Shorts More offers captions, available quality and subscription management with gamepad back', { timeout: 45000 }, async t => {
  const { context, worker } = await launchExtension(t);
  await worker.evaluate(() => chrome.storage.local.set({ enabled: true, autoFullscreen: false, uiLanguage: 'en' }));
  await context.addCookies([{ name: 'SAPISID', value: 'shorts-fixture', domain: 'www.youtube.com', path: '/', secure: true }]);
  await context.addInitScript(() => {
    window.ytcfg = { get: key => ({ INNERTUBE_CONTEXT: { client: { clientName: 'WEB', clientVersion: 'shorts-fixture' }, user: {} }, LOGGED_IN: true })[key] };
  });
  const calls = [];
  let rejectSubscription = false, rejectPreference = false;
  await context.route('https://www.youtube.com/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (!path.startsWith('/youtubei/v1/')) return route.fulfill({ contentType: 'text/html', body: shortsFixture });
    const data = request.postDataJSON(); calls.push({ path, data });
    if (rejectSubscription && path.endsWith('/subscribe')) return route.fulfill({ status: 500, json: { error: {} } });
    if (rejectPreference && path.endsWith('/modify_channel_preference')) return route.fulfill({ status: 500, json: { error: {} } });
    return route.fulfill({ json: path.endsWith('/player') ? watchPlayer(data.videoId) : path.endsWith('/next') ? watchNext() : { success: true } });
  });
  const page = await context.newPage(); await page.goto('https://www.youtube.com/shorts/first');
  const controls = page.locator('#ytg-shorts-controls'); await controls.waitFor(); await installMedia(context, page);
  await controls.locator('.title').filter({ hasText: 'Title first' }).waitFor();
  await page.evaluate(() => {
    const player = document.querySelector('#shorts-player');
    window.shortSettings = { videoId: 'first', quality: 'hd1080', captions: false, tracks: true, changes: [] };
    player.getVideoData = () => ({ video_id: window.shortSettings.videoId });
    player.getAvailableQualityLevels = () => ['hd1080', 'hd720', 'medium', 'unknown'];
    player.getPlaybackQuality = () => window.shortSettings.quality;
    player.setPlaybackQualityRange = value => { window.shortSettings.quality = value; window.shortSettings.changes.push(value); };
    player.getOption = () => window.shortSettings.tracks ? [{ languageCode: 'en' }] : [];
    player.isSubtitlesOn = () => window.shortSettings.captions;
    player.toggleSubtitles = () => { window.shortSettings.captions = !window.shortSettings.captions; };
  });
  const pad = await virtualPad(context, page); await page.bringToFront(); await pad({ connected: true }); await page.waitForTimeout(150);
  const press = button => pressPad(page, button);
  await controls.locator('[data-shorts-action=more]').click();
  const captions = controls.locator('[data-shorts-action=captions]'); await captions.click();
  assert.equal(await captions.getAttribute('aria-pressed'), 'true');
  await captions.click(); assert.equal(await captions.getAttribute('aria-pressed'), 'false');
  await page.evaluate(() => { window.shortSettings.tracks = false; });
  await captions.click(); await controls.getByRole('status').filter({ hasText: 'No captions available' }).waitFor();
  assert.equal(await page.evaluate(() => window.shortSettings.captions), false);
  await controls.locator('[data-shorts-action=quality]').click();
  assert.equal(await controls.locator('.drawer').getByRole('button', { name: '1080p', exact: true }).getAttribute('aria-pressed'), 'true');
  const hd = controls.locator('.drawer').getByRole('button', { name: '720p', exact: true });
  await hd.focus(); await press(0);
  assert.equal(await page.evaluate(() => window.shortSettings.quality), 'hd720');
  await press(1);
  assert.equal(await controls.getAttribute('data-panel'), 'actions');
  assert.equal(await page.evaluate(() => document.querySelector('#ytg-shorts-controls').shadowRoot.activeElement?.dataset.shortsAction), 'quality');
  const subscribe = controls.locator('[data-shorts-action=subscribe]');
  rejectSubscription = true; await subscribe.click();
  await controls.getByRole('status').filter({ hasText: 'Could not update subscription' }).waitFor();
  assert.equal(await subscribe.getAttribute('aria-label'), 'Subscribe');
  rejectSubscription = false; await subscribe.click();
  await page.waitForFunction(() => document.querySelector('#ytg-shorts-controls').shadowRoot.querySelector('[data-shorts-action=subscribe]')?.getAttribute('aria-label') === 'Subscribed, manage subscription');
  await subscribe.click();
  assert.equal(await controls.locator('[data-vue-subscription] button').count(), 4);
  const preferences = () => controls.locator('[data-vue-subscription] [aria-pressed]').evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-pressed')));
  const originalPreferences = await preferences();
  rejectPreference = true;
  await controls.locator('[data-focus-id=notificationsNone]').click();
  await controls.locator('[data-vue-subscription]').getByRole('alert').waitFor();
  assert.deepEqual(await preferences(), originalPreferences, 'failed writes preserve the known notification preference');
  assert.equal(await page.evaluate(() => document.querySelector('#ytg-shorts-controls').shadowRoot.activeElement?.dataset.focusId), 'notificationsNone');
  rejectPreference = false;
  await controls.getByRole('button', { name: 'All notifications', exact: true }).focus(); await press(0);
  await page.waitForFunction(() => document.querySelector('#ytg-shorts-controls').shadowRoot.querySelector('[data-key=notificationsAll]')?.getAttribute('aria-pressed') === 'true');
  assert.equal(await page.evaluate(() => document.querySelector('#ytg-shorts-controls').shadowRoot.activeElement?.dataset.key), 'notificationsAll', 'the selected notification keeps gamepad focus after the asynchronous update');
  await controls.getByRole('button', { name: 'Unsubscribe', exact: true }).click();
  await controls.locator('[data-shorts-action=subscribe]').waitFor();
  assert.equal(await controls.getAttribute('data-panel'), 'actions');
  assert.equal(await subscribe.getAttribute('aria-label'), 'Subscribe');
  assert.ok(calls.some(call => call.path.endsWith('/unsubscribe')));
  assert.ok(calls.some(call => call.path.endsWith('/modify_channel_preference')));
  await page.evaluate(() => { window.shortSettings.videoId = 'previous'; });
  await controls.locator('[data-shorts-action=quality]').click();
  await controls.locator('.drawer-message').filter({ hasText: 'Player settings are currently unavailable' }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.shortSettings.changes), ['hd720']);
  await press(1); await press(1);
  assert.equal(await controls.locator('.drawer').isVisible(), false);
  assert.match(page.url(), /\/shorts\/first$/);
});

for (const mode of ['down', 'up', 'reduced-motion', 'failed-thumbnail']) {
test(`Shorts keep their stage and last frame until the replacement reel is ready (${mode})`, { timeout: 45000 }, async t => {
  const { context, worker } = await launchExtension(t);
  await installShortsContext(context);
  await worker.evaluate(() => chrome.storage.local.set({ enabled: true, autoFullscreen: false }));
  await context.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html', body: shortsFixture.replace(/<script>[\s\S]*?<\/script>/, '') }));
  await context.route('https://i.ytimg.com/**', route => mode === 'failed-thumbnail' ? route.abort() : route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="180" height="320"><rect width="180" height="320" fill="#e78b44"/></svg>' }));
  await installShortsAPI(context, mode === 'up' ? ['first'] : ['second'], false);
  const page = await context.newPage(); await page.goto(`https://www.youtube.com/shorts/${mode === 'up' ? 'second' : 'first'}`);
  await page.emulateMedia({ reducedMotion: mode === 'reduced-motion' ? 'reduce' : 'no-preference' });
  const player = page.locator('#ytg-shorts-controls'); await player.waitFor();
  await page.evaluate(async mode => {
    window.originalStage = document.querySelector('#ytg-shorts-controls').shadowRoot.querySelector('.stage');
    const canvas = document.createElement('canvas'); canvas.width = 180; canvas.height = 320;
    const ctx = canvas.getContext('2d');
    const paint = () => { ctx.fillStyle = '#174e66'; ctx.fillRect(0, 0, 180, 320); requestAnimationFrame(paint); }; paint();
    window.shortStream = canvas.captureStream(15);
    const video = document.querySelector('video'); video.srcObject = window.shortStream; await video.play();
    document.querySelector('#shorts-player').loadVideoById = target => {
      if (mode === 'up' && target === 'first') return;
      const old = document.querySelector('ytd-reel-video-renderer');
      const replacement = old.cloneNode(true); replacement.querySelector('video').removeAttribute('data-ytg-shorts-media');
      old.replaceWith(replacement);
    };
  }, mode);
  await player.locator('.count').filter({ hasText: '1 / 2' }).waitFor({ state: 'attached' });
  await page.waitForFunction(() => document.querySelector('video').loop && document.querySelector('video').videoWidth > 0);
  if (mode === 'up') {
    // Previous means a Short actually visited through the API, not a stale saved feed queue.
    await player.locator('[data-shorts-action=down]').click(); await page.waitForURL('**/shorts/first');
    await player.locator('.preview').waitFor({ state: 'hidden' });
    await page.evaluate(() => document.querySelector('video').play());
  }
  await player.locator(`[data-shorts-action=${mode === 'up' ? 'up' : 'down'}]`).click(); await page.waitForURL('**/shorts/second');
  await player.locator('.preview canvas').waitFor({ state: 'visible' });
  await page.waitForTimeout(400);
  assert.equal(await player.locator('.preview canvas').isVisible(), true, 'route completion alone must not discard the last frame');
  assert.equal(await player.locator('.preview canvas').evaluate(canvas => canvas.width), 180);
  if (mode !== 'failed-thumbnail') {
    await page.waitForFunction(() => document.querySelector('#ytg-shorts-controls').shadowRoot.querySelector('.preview img').getAnimations().length > 0);
    const movement = await player.locator('.preview').evaluate(preview => {
      const img = preview.querySelector('img'), canvas = preview.querySelector('canvas');
      for (const item of [img, canvas]) for (const animation of item.getAnimations()) { animation.pause(); animation.currentTime = Number(animation.effect.getTiming().duration) / 2; }
      return { incoming: new DOMMatrixReadOnly(getComputedStyle(img).transform).m42, outgoing: new DOMMatrixReadOnly(getComputedStyle(canvas).transform).m42,
        duration: img.getAnimations()[0].effect.getTiming().duration };
    });
    if (mode === 'reduced-motion') assert.equal(movement.duration, 0, 'system motion preference skips the slide');
    else {
      assert.ok(mode === 'up' ? movement.incoming < 0 && movement.outgoing > 0 : movement.incoming > 0 && movement.outgoing < 0, JSON.stringify(movement));
      const stage = await player.locator('.stage').boundingBox();
      assert.equal(await player.locator('.preview').evaluate(el => getComputedStyle(el).overflow), 'hidden');
      assert.ok(stage.height > 0);
    }
    await player.locator('.preview').evaluate(preview => { for (const item of preview.querySelectorAll('img,canvas')) for (const animation of item.getAnimations()) animation.finish(); });
  } else {
    assert.equal(await player.locator('.preview canvas').evaluate(canvas => canvas.getAnimations().length), 0, 'failed previews leave the outgoing frame in place');
  }
  assert.equal(await page.evaluate(() => window.originalStage === document.querySelector('#ytg-shorts-controls').shadowRoot.querySelector('.stage')), true);
  if (mode === 'down') {
    const session = await context.newCDPSession(page), worlds = [];
    session.on('Runtime.executionContextCreated', ({ context }) => worlds.push(context.id));
    await session.send('Runtime.enable');
    for (const contextId of worlds) await session.send('Runtime.evaluate', { contextId, expression: `
      const candidate = document.querySelector('video');
      candidate.requestVideoFrameCallback = callback => {
        window.addEventListener('test-video-presented', () => callback(performance.now(), {}), { once: true }); return 789;
      };
      candidate.cancelVideoFrameCallback = () => {};
    ` });
    await session.detach();
  }
  await page.evaluate(async () => { const video = document.querySelector('video'); video.srcObject = window.shortStream; await video.play(); });
  if (mode === 'down') {
    await page.waitForTimeout(400);
    assert.equal(await player.locator('.preview').isVisible(), true, 'decoded data alone cannot reveal a video before its frame is presented');
    await page.evaluate(() => window.dispatchEvent(new Event('test-video-presented')));
  }
  await player.locator('.preview').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('#shorts-player').getAttribute('data-ytg-shorts-media'), '');
  assert.equal(await page.locator('video').evaluate(video => video.loop), true);
});
}

test('rapid list directions select the latest native Short and Back returns to its source', { timeout: 45000 }, async t => {
  const { context, worker } = await launchExtension(t);
  await installShortsContext(context);
  await worker.evaluate(() => chrome.storage.local.set({ enabled: true, autoFullscreen: false }));
  const loads = [];
  await context.route('https://www.youtube.com/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().isNavigationRequest() && path.startsWith('/shorts/')) loads.push(path);
    return route.fulfill({ contentType: 'text/html', body: shortsFixture });
  });
  await installShortsAPI(context, ['second', 'third', 'fourth']);
  const page = await context.newPage();
  await page.goto('https://www.youtube.com/feed/subscriptions');
  await page.evaluate(() => sessionStorage.setItem('ytg-shorts-queue-v1', JSON.stringify({ ids: ['first', 'second', 'third', 'fourth'], currentId: 'first', returnTo: '/feed/subscriptions' })));
  await page.goto('https://www.youtube.com/shorts/first');
  const player = page.locator('#ytg-shorts-controls'); await player.waitFor(); await installMedia(context, page);
  await player.locator('.count').filter({ hasText: '1 / 4' }).waitFor({ state: 'attached' });
  await page.evaluate(() => {
    window.originalShortsControls = document.querySelector('#ytg-shorts-controls');
    window.shortEndpoints = [];
    document.querySelector('ytd-app').navigate_ = endpoint => {
      window.shortEndpoints.push(endpoint);
      document.dispatchEvent(new Event('yt-navigate-start'));
      setTimeout(() => {
        history.pushState({}, '', endpoint.commandMetadata.webCommandMetadata.url);
        document.dispatchEvent(new Event('yt-navigate-finish'));
      }, 150);
    };
  });
  await page.evaluate(() => {
    const controls = document.querySelector('#ytg-shorts-controls').shadowRoot;
    for (const action of ['down', 'up']) controls.querySelector('[data-shorts-action=' + action + ']').click();
  });
  await page.waitForFunction(() => document.querySelector('#active').dataset.paused === 'false' && document.querySelector('#ytg-shorts-controls').shadowRoot.querySelector('.preview').hidden);
  assert.deepEqual(loads, ['/shorts/first'], 'reversing a pending move resumes playback without reloading');
  await page.evaluate(() => {
    const controls = document.querySelector('#ytg-shorts-controls').shadowRoot;
    for (const action of ['down', 'down', 'down', 'up']) controls.querySelector('[data-shorts-action=' + action + ']').click();
  });
  await page.waitForURL('**/shorts/third');
  await player.waitFor(); await installMedia(context, page);
  await player.locator('.preview').waitFor({ state: 'hidden' });
  assert.deepEqual(loads, ['/shorts/first'], 'switching preserves the document instead of reloading the native interface');
  assert.equal(await page.evaluate(() => window.originalShortsControls === document.querySelector('#ytg-shorts-controls')), true);
  assert.deepEqual(await page.evaluate(() => window.apiLoads), ['third']);
  assert.equal(await player.locator('.count').textContent(), '3 / 4');
  await player.getByRole('button', { name: 'Back to feed', exact: true }).click();
  await page.waitForURL('**/feed/subscriptions');
});

for (const mode of ['native', 'hidden-wrapper', 'display-none', 'fixed-wrapper']) {
  const hiddenWrapper = mode === 'hidden-wrapper';
  test(`Shorts ${mode} frames escape native stacking and clipping and restore their ancestors`, { timeout: 45000 }, async t => {
    const { context, worker } = await launchExtension(t);
    await worker.evaluate(() => chrome.storage.local.set({ enabled: true, autoFullscreen: false, uiLanguage: 'en' }));
    const playerId = 'shorts-player';
    const wrapperVisibility = hiddenWrapper ? 'visibility:hidden;' : '';
    const wrapperLayout = mode === 'display-none' ? 'display:none!important;' : mode === 'fixed-wrapper' ? 'position:fixed!important;' : '';
    const content = `<!doctype html><html><head><meta charset="utf-8"><style>
      body{margin:0;background:#111;color:#fff}ytd-app,ytd-page-manager,ytd-shorts,ytd-reel-video-renderer{display:block}
    </style></head><body><ytd-app style="position:relative;z-index:1;isolation:isolate;transform:translateX(23px)">
      <ytd-page-manager style="width:960px;height:820px;contain:size layout;overflow:hidden">
      <ytd-shorts><ytd-reel-video-renderer is-active style="width:360px;height:700px">
        <div id="unlisted-player-wrapper" style="position:relative;z-index:1;isolation:isolate;transform:translateY(13px);contain:size layout;overflow:hidden;width:140px;height:90px;${wrapperVisibility}${wrapperLayout}">
          <div id="${playerId}" class="html5-video-player" style="position:relative;width:120px;height:80px">
            <div class="html5-video-container" style="width:120px;height:80px"><video id="actual-frame" class="html5-main-video" muted playsinline style="width:120px;height:80px"></video></div>
            <div class="ytp-chrome-bottom"><button>Native play</button></div>
          </div>
        </div>
      </ytd-reel-video-renderer></ytd-shorts>
      </ytd-page-manager></ytd-app><script>window.ytcfg={get:key=>key==='INNERTUBE_CONTEXT'?{client:{clientVersion:'test'}}:undefined};</script></body></html>`;
    await context.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html', body: content }));
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('https://www.youtube.com/shorts/stacking');
    const controls = page.locator('#ytg-shorts-controls'); await controls.waitFor();
    await page.evaluate(async () => {
      const video = document.querySelector('video'), canvas = document.createElement('canvas');
      canvas.width = 360; canvas.height = 640;
      const ctx = canvas.getContext('2d');
      const paint = () => { ctx.fillStyle = '#174e66'; ctx.fillRect(0, 0, 360, 640); ctx.fillStyle = '#f6c380'; ctx.fillRect(0, 350, 360, 290); requestAnimationFrame(paint); }; paint();
      video.srcObject = canvas.captureStream(15); video.muted = true; await video.play();
      await new Promise(resolve => video.requestVideoFrameCallback(resolve));
    });
    await page.waitForFunction(() => document.querySelector('video').readyState >= 2 && document.querySelector('video').loop);
    assert.equal(await page.locator('#ytg-browse-root').isVisible(), false, 'the shared browse header does not sit behind the dedicated Shorts controls');
    const assertFrame = async () => {
      const geometry = await page.evaluate(() => {
        const video = document.querySelector('video'), player = video.closest('.html5-video-player');
        const stage = document.querySelector('#ytg-shorts-controls').shadowRoot.querySelector('.stage');
        const bounds = node => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
        const backdrop = document.querySelector('#ytg-shorts-backdrop');
        backdrop.style.pointerEvents = 'auto';
        const rect = stage.getBoundingClientRect(), layers = document.elementsFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 3);
        const result = { video: bounds(video), player: bounds(player), stage: bounds(stage.querySelector('.stage-content')), visibility: getComputedStyle(video).visibility,
          videoLayer: layers.indexOf(video), backdropLayer: layers.indexOf(backdrop), decodedHeight: video.videoHeight };
        backdrop.style.removeProperty('pointer-events');
        return result;
      });
      assert.equal(geometry.decodedHeight, 640, 'the native video decodes the portrait canvas stream');
      assert.equal(geometry.visibility, 'visible', `the video escapes inherited visibility: ${JSON.stringify(geometry)}`);
      for (const name of ['video', 'player']) for (const dimension of ['x', 'y', 'width', 'height'])
        assert.ok(Math.abs(geometry[name][dimension] - geometry.stage[dimension]) < 2, `${name} ${dimension} follows the Shorts stage: ${JSON.stringify(geometry)}`);
      assert.ok(geometry.videoLayer >= 0 && geometry.backdropLayer > geometry.videoLayer, `the decoded video paints above the backdrop: ${JSON.stringify(geometry)}`);
    };
    await assertFrame();
    mkdirSync('output/playwright', { recursive: true });
    await page.screenshot({ path: `output/playwright/shorts-stacking-${mode}-desktop.png` });
    await page.setViewportSize({ width: 600, height: 900 });
    await assertFrame();
    await page.screenshot({ path: `output/playwright/shorts-stacking-${mode}-compact.png` });
    await page.locator('#' + playerId).evaluate(player => player.classList.add('ad-showing'));
    await page.waitForFunction(() => !document.querySelector('video').loop);
    assert.equal(await controls.locator('.play').isVisible(), false, 'the actual player owns ad controls for either route');
    await page.locator('#' + playerId).evaluate(player => player.classList.remove('ad-showing'));
    await page.waitForFunction(() => document.querySelector('video').loop);

    if (hiddenWrapper) {
      await page.evaluate(() => {
        const old = document.querySelector('#unlisted-player-wrapper'), wrapper = document.createElement('div');
        wrapper.id = 'relocated-player-wrapper';
        wrapper.style.cssText = 'position:relative;z-index:2;isolation:isolate;transform:translateX(17px);contain:size layout;overflow:hidden;visibility:hidden;width:130px;height:75px';
        old.parentElement.append(wrapper); wrapper.append(document.querySelector('.html5-video-player'));
      });
      await page.waitForFunction(() => document.querySelector('#relocated-player-wrapper').hasAttribute('data-ytg-shorts-ancestor') && !document.querySelector('#unlisted-player-wrapper').hasAttribute('data-ytg-shorts-ancestor'));
      await assertFrame();
      assert.equal(await page.locator('#unlisted-player-wrapper').evaluate(node => getComputedStyle(node).visibility), 'hidden', 'reparenting restores the old wrapper immediately');
    }

    const assertReleased = async () => {
      assert.equal(await page.locator('[data-ytg-shorts-media],[data-ytg-shorts-ancestor]').count(), 0, 'all media and ancestor overrides are released');
      assert.equal(await page.locator('video').evaluate(video => video.loop), false);
      assert.equal(await page.locator('#unlisted-player-wrapper').evaluate(node => getComputedStyle(node).overflow), 'hidden');
      if (mode === 'display-none') assert.equal(await page.locator('#unlisted-player-wrapper').evaluate(node => getComputedStyle(node).display), 'none', 'native hiding is restored after releasing the media');
      if (mode === 'fixed-wrapper') assert.equal(await page.locator('#unlisted-player-wrapper').evaluate(node => getComputedStyle(node).position), 'fixed', 'native positioning is restored after releasing the media');
      if (hiddenWrapper) assert.equal(await page.locator('#relocated-player-wrapper').evaluate(node => getComputedStyle(node).visibility), 'hidden');
    };
    assert.equal(await controls.getByRole('button', { name: 'Use YouTube controls', exact: true }).count(), 0);
    await worker.evaluate(() => chrome.storage.local.set({ enabled: false }));
    await controls.waitFor({ state: 'hidden' }); await assertReleased();
    await worker.evaluate(() => chrome.storage.local.set({ enabled: true }));
    await page.waitForFunction(() => document.querySelector('video').loop);
    await page.evaluate(() => { history.pushState({}, '', '/feed/history'); document.dispatchEvent(new Event('yt-navigate-finish')); });
    await controls.waitFor({ state: 'hidden' }); await assertReleased();
    assert.deepEqual(errors, []);
  });
}
