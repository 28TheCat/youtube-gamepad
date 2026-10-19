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

test('actual gamepad input controls the active Short, switches reels, respects dialogs and returns to the feed', { timeout: 45000 }, async t => {
  const { context, worker } = await launchExtension(t);
  await worker.evaluate(() => chrome.storage.local.set({ enabled: true, autoFullscreen: false, uiLanguage: 'zh-CN' }));
  await context.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html', body: fixture }));
  const page = await context.newPage();
  await page.goto('https://www.youtube.com/feed/subscriptions');
  await page.goto('https://www.youtube.com/shorts/JnICtQ9VHJ8');
  const bar = page.locator('#ytg-shorts-controls');
  await bar.waitFor({ state: 'visible' });
  await installMedia(context, page);
  const pad = await virtualPad(context, page);
  await page.bringToFront(); await pad({ connected: true }); await page.waitForTimeout(150);
  const press = async button => { await pad({ connected: true, button }); await page.waitForTimeout(120); await pad({ connected: true }); await page.waitForTimeout(120); };
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
  await press(15);
  assert.equal(await page.locator('#active').getAttribute('data-position'), '15');
  assert.equal(await page.locator('#inactive').getAttribute('data-position'), '10', 'hidden cached reels never own playback, even with a stale active marker');
  await press(14);
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
  assert.equal(await page.locator('#next').getAttribute('data-paused'), 'true');
  assert.equal(await page.locator('#active').getAttribute('data-paused'), 'false');
  await page.waitForTimeout(200);
  await press(12);
  await page.waitForURL('**/shorts/current');
  mkdirSync('output/playwright', { recursive: true });
  await page.screenshot({ path: 'output/playwright/shorts-gamepad.png' });
  await press(1);
  await page.waitForURL('**/feed/subscriptions');
  await page.locator('#ytg-shorts-controls').waitFor({ state: 'hidden' });
});

test('Shorts keep blocked-play errors visible and missing video restores native access', { timeout: 45000 }, async t => {
  const { context, worker } = await launchExtension(t);
  await worker.evaluate(() => chrome.storage.local.set({ enabled: true, autoFullscreen: false }));
  await context.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html', body:
    route.request().url().includes('v=missing') ? '<html><body><ytd-app><button id="native-retry">Retry YouTube</button></ytd-app></body></html>' : watchFixture }));
  const page = await context.newPage();
  await page.goto('https://www.youtube.com/watch?v=first&ytg_shorts=1');
  const player = page.locator('#ytg-shorts-controls'); await player.waitFor();
  await installMedia(context, page, true);
  await page.locator('#active').evaluate(node => { node.dataset.paused = 'true'; });
  await player.locator('[data-shorts-action=playPause]').click();
  await player.getByRole('status').filter({ hasText: 'Playback was blocked' }).waitFor();
  await page.waitForTimeout(700);
  assert.match(await player.getByRole('status').textContent(), /Playback was blocked/);
  await page.goto('https://www.youtube.com/watch?v=missing&ytg_shorts=1');
  await page.waitForFunction(() => document.querySelector('#ytg-shorts-controls')?.hasAttribute('data-native'), undefined, { timeout: 14000 });
  assert.equal(await page.locator('html').evaluate(node => node.classList.contains('ytg-shorts-player')), false);
  assert.equal(await page.locator('#native-retry').isVisible(), true);
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
  await pad({ connected: true, button: 0 }); await page.waitForTimeout(150); await pad({ connected: true });
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

const watchFixture = `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#111;color:white">
<ytd-app><ytd-watch-flexy style="position:relative;z-index:1"><div id="player" style="position:relative;z-index:1"><div id="movie_player"><div class="html5-video-container"><video id="active" muted></video></div><div class="ytp-chrome-bottom"><button>Native play</button></div></div></div>
<h1><yt-formatted-string>City lights · Shorts</yt-formatted-string></h1><div id="channel-name">Travel channel</div></ytd-watch-flexy></ytd-app>
<script>for(const video of document.querySelectorAll('video')){video.dataset.paused='false';video.dataset.position='10';Object.defineProperties(video,{paused:{get:()=>video.dataset.paused==='true'},duration:{get:()=>30},currentTime:{get:()=>Number(video.dataset.position),set:v=>video.dataset.position=String(v)}});video.pause=()=>video.dataset.paused='true';video.play=async()=>{video.dataset.paused='false'}};</script></body></html>`;

test('Shorts intent survives URL normalization before application startup and a full refresh', { timeout: 45000 }, async t => {
  const { context, worker } = await launchExtension(t);
  await worker.evaluate(() => chrome.storage.local.set({ enabled: true, autoFullscreen: false }));
  await context.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html', body:
    watchFixture.replace('</head>', '<script>history.replaceState({},"","/watch?v=normalized")</script></head>') }));
  const page = await context.newPage(); await page.goto('https://www.youtube.com/watch?v=normalized&ytg_shorts=1');
  await page.waitForFunction(() => document.documentElement.classList.contains('ytg-shorts-player'));
  assert.equal(new URL(page.url()).searchParams.has('ytg_shorts'), false);
  await page.reload();
  await page.waitForFunction(() => document.documentElement.classList.contains('ytg-shorts-player'));
  assert.equal(await page.locator('#ytg-shorts-controls').isVisible(), true);
});

test('dedicated Shorts player owns controls, queue navigation and back while leaving standard watch UI disabled', { timeout: 45000 }, async t => {
  const { context, worker } = await launchExtension(t);
  await worker.evaluate(() => chrome.storage.local.set({ enabled: true, autoFullscreen: false }));
  await context.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html', body: watchFixture }));
  const page = await context.newPage();
  await page.goto('https://www.youtube.com/feed/subscriptions');
  await page.evaluate(() => sessionStorage.setItem('ytg-shorts-queue-v1', JSON.stringify({ ids: ['first', 'second'], returnTo: '/feed/subscriptions' })));
  await page.goto('https://www.youtube.com/watch?v=first&ytg_shorts=1');
  const player = page.locator('#ytg-shorts-controls'); await player.waitFor();
  await installMedia(context, page);
  const pad = await virtualPad(context, page); await page.bringToFront(); await pad({ connected: true }); await page.waitForTimeout(150);
  const press = async button => { await pad({ connected: true, button }); await page.waitForTimeout(120); await pad({ connected: true }); await page.waitForTimeout(120); };
  await page.waitForFunction(() => document.documentElement.classList.contains('ytg-shorts-player'));
  assert.equal(await page.locator('html').evaluate(node => node.classList.contains('ytg-watch-layout')), false);
  assert.equal(await player.locator('.title').textContent(), 'Shorts', 'missing API metadata never falls back to page titles');
  assert.equal(await player.locator('.author').textContent(), 'YouTube');
  assert.equal(await player.locator('.count').textContent(), '1 / 2');
  assert.equal(await player.locator('[data-shorts-action=up]').isDisabled(), true);
  await press(0); assert.equal(await page.locator('#active').getAttribute('data-paused'), 'true');
  await press(2); assert.equal(await page.locator('#active').getAttribute('data-paused'), 'false');
  await press(15); assert.equal(await page.locator('#active').getAttribute('data-position'), '15');
  await pad({ connected: true, button: 13 }); await page.waitForURL('**/watch?v=second&ytg_shorts=1');
  await player.waitFor(); await installMedia(context, page);
  assert.equal(await player.locator('.count').textContent(), '2 / 2');
  await page.evaluate(() => { history.replaceState({}, '', '/watch?v=second'); document.dispatchEvent(new Event('yt-navigate-finish')); });
  assert.equal(await page.locator('html').evaluate(node => node.classList.contains('ytg-shorts-player')), true, 'YouTube URL normalization retains the Shorts interface');
  assert.equal(await player.locator('[data-shorts-action=down]').isDisabled(), true);
  const secondPad = await virtualPad(context, page); await secondPad({ connected: true }); await page.waitForTimeout(150);
  await secondPad({ connected: true, button: 1 });
  await page.waitForURL('**/feed/subscriptions');
});

test('dedicated Shorts shows real media frames and restores native controls, loop and layout on request or disable', { timeout: 45000 }, async t => {
  const { context, worker } = await launchExtension(t);
  await worker.evaluate(() => chrome.storage.local.set({ enabled: true, autoFullscreen: false }));
  await context.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html', body: watchFixture.replace(/<script>[\s\S]*?<\/script>/, '') }));
  const page = await context.newPage(); await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('https://www.youtube.com/watch?v=first&ytg_shorts=1');
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
  await page.locator('#movie_player').evaluate(node => node.classList.add('ad-showing'));
  await page.waitForFunction(() => !document.querySelector('video').loop);
  assert.equal(await player.locator('.play').isVisible(), false, 'ads retain native pointer controls');
  await page.locator('#movie_player').evaluate(node => node.classList.remove('ad-showing'));
  await page.waitForFunction(() => document.querySelector('video').loop);
  assert.equal(await player.locator('.play').isVisible(), true);
  assert.equal(await page.locator('#active').evaluate(node => { const r=node.getBoundingClientRect(); return r.height > 500 && r.width > 250 && getComputedStyle(node).visibility !== 'hidden'; }), true, 'video retains a visible portrait surface below the transparent play target');
  mkdirSync('output/playwright', { recursive: true });
  await page.screenshot({ path: 'output/playwright/shorts-dedicated-desktop.png' });
  await page.setViewportSize({ width: 600, height: 900 });
  await page.screenshot({ path: 'output/playwright/shorts-dedicated-compact.png' });
  await player.getByRole('button', { name: 'Use YouTube controls', exact: true }).click();
  assert.equal(await page.locator('html').evaluate(node => node.classList.contains('ytg-shorts-player')), false);
  assert.equal(await page.locator('#active').evaluate(node => node.loop), false);
  await player.getByRole('button', { name: 'Retry Shorts view', exact: true }).click();
  await page.waitForFunction(() => document.documentElement.classList.contains('ytg-shorts-player'));
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
      const comment = { onResponseReceivedEndpoints: [
        { reloadContinuationItemsCommand: { continuationItems: [] } },
        { appendContinuationItemsAction: { continuationItems: [{ commentThreadRenderer: {
          commentViewModel: { commentViewModel: { commentId: 'short-comment', commentKey: 'comment-key' } }
        } }] } }
      ], frameworkUpdates: { entityBatchUpdate: { mutations: [{ payload: { commentEntityPayload: {
        key: 'comment-key', properties: { content: { content: 'A comment on this Short.' } }, author: { displayName: 'Shorts viewer', channelId: 'UCviewer' }, toolbar: { replyCount: '0' }
      } } }] } } };
      await route.fulfill({ json: path.endsWith('/player') ? watchPlayer(body.videoId) : path.endsWith('/next') ? body.continuation ? comment : watchNext()
        : path.endsWith('/get_add_to_playlist') ? { contents: { addToPlaylistRenderer: { playlists: [option('PLshorts')] } } } : { success: true } });
    } else await route.fulfill({ contentType: 'text/html', body: watchFixture });
  });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('https://www.youtube.com/watch?v=first&ytg_shorts=1');
  const player = page.locator('#ytg-shorts-controls'); await player.waitFor(); await installMedia(context, page);
  await player.locator('.title').filter({ hasText: 'Title first' }).waitFor();
  const before = await page.locator('#movie_player').boundingBox();
  await player.locator('[data-shorts-action=comments]').click();
  try { await player.locator('.comment-text').filter({ hasText: 'A comment on this Short.' }).waitFor({ timeout: 10000 }); }
  catch (error) { t.diagnostic(JSON.stringify({ calls, panel: await player.locator('.drawer').textContent(), errors })); throw error; }
  await page.waitForTimeout(250);
  const after = await page.locator('#movie_player').boundingBox();
  const drawer = await player.locator('.drawer').boundingBox();
  const stage = await player.locator('.stage').boundingBox();
  assert.ok(Math.abs(stage.x - after.x) < 2 && Math.abs(stage.width - after.width) < 2, `overlay follows the video: ${JSON.stringify({ stage, after })}`);
  assert.ok(after.x < before.x, 'opening comments shifts the video left');
  assert.ok(after.x + after.width <= drawer.x, 'the drawer does not cover the video');
  const pad = await virtualPad(context, page); await page.bringToFront(); await pad({ connected: true }); await page.waitForTimeout(100);
  const press = async button => { await pad({ connected: true, button }); await page.waitForTimeout(90); await pad({ connected: true }); await page.waitForTimeout(90); };
  await press(13);
  assert.match(page.url(), /v=first/, 'comments own down instead of changing the video');
  await press(1); assert.equal(await player.locator('.drawer').isVisible(), false);
  await player.locator('[data-shorts-action=like]').click();
  await page.waitForFunction(() => document.querySelector('#ytg-shorts-controls').shadowRoot.querySelector('[data-shorts-action=like]').getAttribute('aria-pressed') === 'true');
  assert.equal(calls.filter(call => call.path.endsWith('/like/like')).length, 1);
  await player.locator('[data-shorts-action=save]').click();
  const playlist = player.getByRole('button', { name: 'List PLshorts', exact: true }); await playlist.waitFor(); await playlist.click();
  await page.waitForFunction(() => document.querySelector('#ytg-shorts-controls').shadowRoot.querySelector('.playlist')?.getAttribute('aria-pressed') === 'true');
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

test('rapid Shorts directions preserve the latest target during SPA loading and Back skips the entire session', { timeout: 45000 }, async t => {
  const { context, worker } = await launchExtension(t);
  await worker.evaluate(() => chrome.storage.local.set({ enabled: true }));
  const spa = watchFixture.replace('</body>', `<script>
    window.moves=[];
    document.querySelector('ytd-app').navigate_=endpoint=>{
      const id=endpoint.watchEndpoint.videoId; window.moves.push(id);
      document.dispatchEvent(new Event('yt-navigate-start'));
      setTimeout(()=>{
        history.pushState({},'', '/watch?v='+id);
        document.querySelector('h1 yt-formatted-string').textContent='Short '+id;
        document.querySelector('#active').dataset.paused='false';
        document.dispatchEvent(new Event('yt-navigate-finish'));
      },350);
    };
    </script></body>`);
  await context.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html', body: spa }));
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('https://www.youtube.com/feed/subscriptions');
  await page.evaluate(() => sessionStorage.setItem('ytg-shorts-queue-v1', JSON.stringify({ ids: ['first', 'second', 'third', 'fourth'], returnTo: '/feed/subscriptions' })));
  await page.goto('https://www.youtube.com/watch?v=first&ytg_shorts=1');
  const player = page.locator('#ytg-shorts-controls'); await player.waitFor(); await installMedia(context, page);
  await player.locator('[data-shorts-action=down]').click();
  await page.waitForFunction(() => window.moves.length === 1);
  await page.evaluate(() => {
    for (const action of ['down', 'down', 'up']) window.dispatchEvent(new CustomEvent('yt-gamepad-action', { detail: { action } }));
  });
  assert.equal(await player.locator('.count').textContent(), '3 / 4');
  assert.equal(await player.locator('.preview').isVisible(), true);
  await page.waitForURL('**/watch?v=third');
  await page.waitForFunction(() => !document.documentElement.hasAttribute('data-ytg-shorts-switching'));
  assert.deepEqual(await page.evaluate(() => window.moves), ['second', 'third'], 'intermediate fourth is superseded without dropping input');
  assert.equal(await player.locator('.count').textContent(), '3 / 4');
  assert.equal(await player.locator('.preview').isVisible(), false);
  assert.equal(await page.locator('html').evaluate(el => el.classList.contains('ytg-shorts-player')), true);
  await player.getByRole('button', { name: 'Back to feed', exact: true }).click();
  await page.waitForURL('**/feed/subscriptions');
  assert.deepEqual(errors, []);
});
