import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchExtension } from './helpers/extension.mjs';

const fixture = `<!doctype html><html><body><ytd-app><ytd-shorts><ytd-reel-video-renderer is-active style="display:block;height:700px">
<div id="shorts-player" class="html5-video-player"><video muted></video></div></ytd-reel-video-renderer>
<div id="navigation-button-down"><button onclick="window.nativeMoves++">Native next</button></div>
<div id="navigation-button-up"><button onclick="window.nativeMoves++">Native previous</button></div></ytd-shorts></ytd-app>
<script>
window.ytcfg={get:key=>key==='INNERTUBE_CONTEXT'?{client:{clientName:'WEB',clientVersion:'test'},user:{}}:undefined};
window.nativeMoves=0;window.routeMoves=0;window.apiLoads=[];
document.querySelector('ytd-app').navigate_=()=>{window.routeMoves++;throw new Error('Native reel routing must not run')};
const player=document.querySelector('#shorts-player'),video=player.querySelector('video');let current='first';
player.getVideoData=()=>({video_id:current});
function stream(id){const canvas=document.createElement('canvas');canvas.width=180;canvas.height=320;
const ctx=canvas.getContext('2d');const paint=()=>{ctx.fillStyle=id==='second'?'#824e66':'#174e66';ctx.fillRect(0,0,180,320);requestAnimationFrame(paint)};paint();
video.srcObject=canvas.captureStream(15);void video.play();}
player.loadVideoById=id=>{if(window.rejectPlayback)throw new Error('Player unavailable');current=id;window.apiLoads.push(id);stream(id)};
stream('first');
</script></body></html>`;

async function setup(t, failSequence = false) {
  const { context, worker } = await launchExtension(t);
  await worker.evaluate(() => chrome.storage.local.set({ enabled: true, autoFullscreen: false, uiLanguage: 'en' }));
  const requests = []; let documents = 0, fail = failSequence;
  await context.route('https://i.ytimg.com/**', route => route.abort());
  await context.route('https://www.youtube.com/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().isNavigationRequest()) documents++;
    if (path.endsWith('/reel/reel_item_watch')) return route.fulfill({ json: { playerResponse: { playabilityStatus: { status: 'OK' } } } });
    if (path.endsWith('/reel/reel_watch_sequence')) {
      const body = route.request().postDataJSON(); requests.push(body);
      if (fail) return route.fulfill({ status: 503, json: { error: {} } });
      const continuation = body.sequenceParams === 'second-batch';
      return route.fulfill({ json: { entries: (continuation ? ['second', 'third'] : ['first', 'second', 'second']).map(videoId => ({ reelWatchEndpoint: { videoId } })),
        ...(!continuation ? { continuationEndpoint: { continuationCommand: { token: 'second-batch', request: 'CONTINUATION_REQUEST_TYPE_REEL_WATCH_SEQUENCE' } } } : {}) } });
    }
    if (path.startsWith('/youtubei/')) return route.fulfill({ json: { contents: [] } });
    return route.fulfill({ contentType: 'text/html', body: fixture });
  });
  const page = await context.newPage(); await page.goto('https://www.youtube.com/shorts/first');
  const controls = page.locator('#ytg-shorts-controls'); await controls.waitFor();
  await page.waitForFunction(() => document.querySelector('video').readyState >= 2);
  return { page, controls, requests, documents: () => documents, recover: () => { fail = false; } };
}

test('Shorts API owns recommendations, continuation, wheel playback and previous history without native reel navigation', { timeout: 45000 }, async t => {
  const { page, controls, requests, documents } = await setup(t);
  const player = await page.locator('#shorts-player').elementHandle();
  await page.mouse.move(20, 450); await page.mouse.wheel(0, 400);
  await page.waitForURL('**/shorts/second');
  await controls.locator('.preview').waitFor({ state: 'hidden' });
  await controls.locator('[data-shorts-action=down]').click(); await page.waitForURL('**/shorts/third');
  await controls.locator('.preview').waitFor({ state: 'hidden' });
  await controls.locator('[data-shorts-action=up]').click(); await page.waitForURL('**/shorts/second');
  await controls.locator('.preview').waitFor({ state: 'hidden' });
  assert.deepEqual(await page.evaluate(() => window.apiLoads), ['second', 'third', 'second']);
  assert.equal(await page.evaluate(() => window.nativeMoves + window.routeMoves), 0);
  assert.equal(documents(), 1);
  assert.equal(await player.evaluate(el => el === document.querySelector('#shorts-player')), true);
  assert.ok(requests.some(body => body.sequenceParams === 'second-batch'));
});

test('Shorts API failures retain current playback and can retry without native fallback', { timeout: 45000 }, async t => {
  const { page, controls, recover, documents } = await setup(t, true);
  await controls.locator('[data-shorts-action=down]').click();
  await controls.getByRole('status').filter({ hasText: 'No next video' }).waitFor();
  assert.match(page.url(), /\/shorts\/first$/);
  assert.equal(await page.evaluate(() => window.nativeMoves + window.routeMoves + window.apiLoads.length), 0);
  recover();
  await controls.locator('[data-shorts-action=down]').click(); await page.waitForURL('**/shorts/second');
  await controls.locator('.preview').waitFor({ state: 'hidden' });
  await page.evaluate(() => { window.rejectPlayback = true; });
  await controls.locator('[data-shorts-action=up]').click();
  await controls.getByRole('status').filter({ hasText: 'No next video' }).waitFor();
  assert.match(page.url(), /\/shorts\/second$/);
  assert.equal(documents(), 1);
});

test('Shorts navigation arrows switch videos while a detail panel is open', { timeout: 45000 }, async t => {
  const { page, controls, documents } = await setup(t);
  await controls.locator('[data-shorts-action=comments]').click();
  await controls.locator('.drawer').waitFor({ state: 'visible' });
  await controls.locator('[data-shorts-action=down]').click();
  await page.waitForURL('**/shorts/second', { timeout: 5000 });
  await controls.locator('.drawer').waitFor({ state: 'hidden' });
  await controls.locator('.preview').waitFor({ state: 'hidden' });
  await controls.locator('[data-shorts-action=more]').click();
  await controls.locator('.drawer').waitFor({ state: 'visible' });
  await controls.locator('[data-shorts-action=up]').click();
  await page.waitForURL('**/shorts/first', { timeout: 5000 });
  await controls.locator('.drawer').waitFor({ state: 'hidden' });
  assert.deepEqual(await page.evaluate(() => window.apiLoads), ['second', 'first']);
  assert.equal(await page.evaluate(() => window.nativeMoves + window.routeMoves), 0);
  assert.equal(documents(), 1);
});
