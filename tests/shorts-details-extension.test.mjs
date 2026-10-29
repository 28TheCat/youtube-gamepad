import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { launchExtension } from './helpers/extension.mjs';
import { next, player } from './helpers/watch-info-data.mjs';

test('Shorts details maximize the real media ratio and place desktop identity beside the resident player', { timeout: 60000 }, async t => {
  const { context, worker } = await launchExtension(t);
  await worker.evaluate(() => chrome.storage.local.set({ enabled: true, autoFullscreen: false, uiLanguage: 'en' }));
  await context.route('https://example.com/**', route => route.abort());
  await context.route('https://www.youtube.com/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/player')) return route.fulfill({ json: player('first') });
    if (path.endsWith('/next')) return route.fulfill({ json: next() });
    if (path.startsWith('/youtubei/')) return route.fulfill({ json: {} });
    return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><body>
      <ytd-app><ytd-shorts><ytd-reel-video-renderer is-active style="display:block;height:700px">
      <div id="shorts-player" class="html5-video-player"><video muted playsinline></video></div>
      </ytd-reel-video-renderer></ytd-shorts></ytd-app><script>
      window.ytcfg={get:key=>key==='INNERTUBE_CONTEXT'?{client:{clientVersion:'test'}}:undefined};
      document.querySelector('#shorts-player').getVideoData=()=>({video_id:'first'});
      window.showMedia=(width,height)=>{
        const video=document.querySelector('video');
        if(video.srcObject)for(const track of video.srcObject.getTracks())track.stop();
        const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
        const ctx=canvas.getContext('2d');ctx.fillStyle='#c7e86b';ctx.fillRect(0,0,width,height);
        ctx.fillStyle='#365123';ctx.beginPath();ctx.arc(width/2,height/2,Math.min(width,height)*.42,0,Math.PI*2);ctx.fill();
        ctx.fillStyle='white';ctx.textAlign='center';ctx.font='bold 28px Arial';ctx.fillText('SHORTS',width/2,height/2);
        video.srcObject=canvas.captureStream(15);void video.play();
      };showMedia(640,640);
      </script></body></html>` });
  });
  const page = await context.newPage();
  await page.setViewportSize({ width: 1692, height: 812 });
  await page.goto('https://www.youtube.com/shorts/first');
  const controls = page.locator('#ytg-shorts-controls'); await controls.waitFor();
  await controls.locator('.title').filter({ hasText: 'Title first' }).waitFor();
  const original = await page.locator('#shorts-player').elementHandle();
  mkdirSync('output/playwright', { recursive: true });
  for (const [width, height, mediaWidth, mediaHeight, dark] of [
    [1692, 812, 640, 640, false], [1692, 812, 360, 640, true],
    [800, 600, 640, 360, false], [390, 844, 640, 640, false]
  ]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(({ mediaWidth, mediaHeight, dark }) => {
      document.documentElement.toggleAttribute('dark', dark); window.showMedia(mediaWidth, mediaHeight);
    }, { mediaWidth, mediaHeight, dark });
    await page.waitForFunction(ratio => Math.abs(Number(document.documentElement.style.getPropertyValue('--ytg-shorts-ratio')) - ratio) < .001, mediaWidth / mediaHeight);
    const stage = await controls.locator('.stage').boundingBox(), video = await page.locator('video').boundingBox();
    const content = await controls.locator('.stage-content').boundingBox();
    assert.ok(Math.abs(content.width / content.height - mediaWidth / mediaHeight) < .01);
    assert.ok(stage.x >= 0 && stage.x + stage.width <= width && stage.y >= 0 && stage.height > 0);
    assert.ok(Math.abs(stage.width - video.width) < 1 && Math.abs(stage.x - video.x) < 1);
    assert.ok(Math.abs(content.height - video.height) < 1);
    assert.equal(await original.evaluate(node => node === document.querySelector('#shorts-player')), true);
    if (width === 1692) {
      const metadata = await controls.locator('.metadata').boundingBox();
      assert.ok(metadata.x + metadata.width < stage.x, 'identity stays left of the desktop video');
      assert.ok(stage.height >= height - 25, 'media uses the available window height');
      assert.ok(stage.width > 1000, 'desktop playback grows beyond the former 880px cap');
      if (mediaHeight > mediaWidth) {
        assert.ok(stage.height > height && Math.abs(stage.height - content.height) < 1, 'the visible stage itself grows beyond the window instead of clipping an inner scroll area');
        await controls.evaluate(node => { node.scrollTop = 0; });
        await page.mouse.move(stage.x + stage.width / 2, stage.y + 100);
        await page.mouse.wheel(0, 400);
        await page.waitForFunction(() => document.querySelector('#ytg-shorts-controls').scrollTop > 100);
        assert.match(page.url(), /\/shorts\/first$/, 'scrolling over tall media does not switch videos');
        const scrolled = await page.locator('video').boundingBox();
        assert.ok(scrolled.y < video.y - 100, 'the resident media follows the scroll');
        await controls.evaluate(node => { node.scrollTop = node.scrollHeight; });
        await controls.locator('.timeline').waitFor({ state: 'visible' });
        const timeline = await controls.locator('.timeline').boundingBox();
        assert.ok(timeline.y + timeline.height <= height, 'the progress bar remains reachable');
        await controls.evaluate(node => { node.scrollTop = 0; });
      }
      assert.equal(await controls.locator('.subscribe').textContent(), 'Subscribe');
      await page.screenshot({ path: `output/playwright/shorts-details-${dark ? 'dark' : 'light'}.png` });
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await controls.locator('[data-shorts-action=comments]').click();
  await controls.locator('.drawer').waitFor({ state: 'visible' });
  const stage = await controls.locator('.stage').boundingBox(), drawer = await controls.locator('.drawer').boundingBox();
  assert.ok(stage.x + stage.width <= drawer.x, 'comments receive their own space');
});
