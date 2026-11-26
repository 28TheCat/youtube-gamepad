import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import vue from '@vitejs/plugin-vue';
import { browserPage } from './helpers/bundles.mjs';

const result = await build({ configFile: false, publicDir: false, logLevel: 'silent', plugins: [vue()],
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: { write: false, minify: false, lib: { entry: fileURLToPath(new URL('./helpers/tv-playback-fixture.ts', import.meta.url)), formats: ['iife'], name: 'TvPlaybackFixture' } } });
const code = (Array.isArray(result) ? result[0] : result).output.find(item => item.type === 'chunk').code;

test('fullscreen reading leaves room for captions and returns to the opening control', async t => {
  const page = await browserPage(t);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setContent(`<html class="ytg-watch-layout ytg-controls ytg-gamepad-input" data-ytg-playback-layout="fullscreen"><body>
    <div id="movie_player"><video class="html5-main-video" muted></video>
    <div class="caption-window ytp-caption-window-bottom" style="position:absolute;left:20%;top:auto;color:white">Test captions</div></div>
    </body></html>`);
  for (const path of ['../src/ui/theme.css', '../src/app/theater.css'])
    await page.addStyleTag({ content: readFileSync(new URL(path, import.meta.url), 'utf8') });
  await page.addScriptTag({ content: code + ';window.fixture = TvPlaybackFixture.setup("A line of the long comment.\\n".repeat(80) + "End of comment.");' });
  await page.evaluate(async () => {
    const video = document.querySelector('video');
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    let frame = 0;
    video.srcObject = canvas.captureStream(30);
    setInterval(() => { context.fillRect(frame++ % canvas.width, 0, 1, canvas.height); }, 33);
    await video.play();
  });
  const host = page.locator('#ytg-watch'), menu = page.locator('#yt-gamepad-menu');
  const player = page.locator('#movie_player'), caption = player.locator('.caption-window');
  const expanded = await player.boundingBox();
  const press = action => page.evaluate(action => window.fixture.press(action), action);
  for (const name of ['comments', 'description']) {
    await host.locator('[data-action="moreActions"]').click();
    await menu.locator(`[data-menu-action="watch:${name}"]`).click();
    const dialog = host.locator('.dialog:not([hidden])');
    const panel = await dialog.boundingBox(), media = await player.boundingBox(), subtitles = await caption.boundingBox();
    assert.ok(media.width < expanded.width);
    assert.ok(media.x + media.width <= panel.x + 1);
    assert.ok(subtitles.y >= media.y && subtitles.y + subtitles.height <= media.y + media.height);
    const time = await player.locator('video').evaluate(video => video.currentTime);
    await page.waitForFunction(time => document.querySelector('video').currentTime > time, time);
    if (name === 'comments') {
      const sheet = dialog.locator('.sheet');
      const text = sheet.locator('[data-focus-id="comment:long"]');
      await text.waitFor();
      for (let i = 0; i < 25; i++) await press('down');
      assert.ok(await sheet.evaluate(node => {
        const comment = node.querySelector('.comment-text');
        return node.scrollTop > 0 && comment.getBoundingClientRect().bottom <= node.getBoundingClientRect().bottom;
      }));
    }
    await page.setViewportSize({ width: 390, height: 844 });
    const stackedPanel = await dialog.boundingBox(), stackedMedia = await player.boundingBox(), stackedCaption = await caption.boundingBox();
    assert.ok(stackedMedia.y + stackedMedia.height <= stackedPanel.y + 1);
    assert.ok(stackedCaption.x >= stackedMedia.x && stackedCaption.x + stackedCaption.width <= stackedMedia.x + stackedMedia.width);
    assert.ok(stackedCaption.y >= stackedMedia.y && stackedCaption.y + stackedCaption.height <= stackedPanel.y);
    assert.ok(await dialog.locator('.sheet').evaluate(node => node.scrollWidth <= node.clientWidth));
    await page.setViewportSize({ width: 1920, height: 1080 });
    await press('back');
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(await host.evaluate(node => node.shadowRoot.activeElement?.dataset.focusId), 'moreActions');
    assert.equal((await player.boundingBox()).width, expanded.width);
  }
});

test('fullscreen keeps media controls primary and returns from secondary actions without leaving playback', { timeout: 30000 }, async t => {
  const page = await browserPage(t);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html', body: '<html data-ytg-playback-layout="fullscreen" data-ytg-language="en" class="ytg-gamepad-input"><body style="margin:0;background:linear-gradient(130deg,#254b52,#111e2f);height:100vh"></body></html>' }));
  await page.goto('https://www.youtube.com/watch?v=tv');
  await page.addStyleTag({ content: readFileSync(new URL('../src/ui/theme.css', import.meta.url), 'utf8') });
  await page.addScriptTag({ content: code + ';window.fixture = TvPlaybackFixture.setup();' });
  const host = page.locator('#ytg-watch'), menu = page.locator('#yt-gamepad-menu');
  const more = host.locator('[data-action="moreActions"]');
  const press = action => page.evaluate(action => window.fixture.press(action), action);
  const focused = () => host.evaluate(node => node.shadowRoot.activeElement?.dataset.focusId);
  assert.deepEqual(await host.locator('.toolbar [data-action]').evaluateAll(nodes => nodes.map(node => node.dataset.action)),
    ['seekBack', 'playPause', 'seekForward', 'captions', 'moreActions']);
  assert.equal(await focused(), 'playPause');
  assert.equal(await host.locator('.hint').innerText().then(text => text.includes('Recommendations')), false);
  await press('right'); assert.equal(await focused(), 'seekForward');
  await press('right'); assert.equal(await focused(), 'captions');
  await press('confirm');
  assert.equal(await host.locator('[data-action="captions"]').getAttribute('aria-pressed'), 'true');
  await press('right'); assert.equal(await focused(), 'moreActions');
  await press('confirm');
  await menu.locator('[data-vue-quick-menu]').waitFor();
  assert.equal(await menu.locator('[data-menu-action="search"]').evaluate(node => node.getRootNode().activeElement === node), true);
  for (const id of ['like', 'save', 'channel', 'subscribe', 'description']) await menu.locator(`[data-menu-action="watch:${id}"]`).waitFor();
  await press('back'); await menu.waitFor({ state: 'hidden' });
  assert.equal(await focused(), 'moreActions');
  await more.click(); await menu.locator('[data-menu-action="watch:like"]').click();
  await menu.waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate(() => window.fixture.page.liked), true);
  await more.click();
  assert.equal(await menu.locator('[data-menu-action="watch:like"]').getAttribute('aria-pressed'), 'true');
  await menu.locator('[data-menu-action="watch:save"]').click();
  await host.locator('[data-vue-playlists]').waitFor();
  await press('back');
  assert.equal(await focused(), 'moreActions');
  await more.click(); await menu.locator('[data-menu-action="watch:description"]').click();
  await host.locator('[data-vue-description]').getByText('Details remain available from More actions.', { exact: true }).waitFor();
  await page.evaluate(() => { window.fixture.playback.settingsOpen = true; });
  await press('back');
  assert.equal(await page.evaluate(() => window.fixture.playback.settingsOpen), false);
  assert.equal(await host.locator('[data-vue-description]').isVisible(), true);
  await press('back'); assert.equal(await focused(), 'moreActions');
  await more.click(); await menu.locator('[data-menu-action="watch:subscribe"]').click();
  await menu.waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate(() => window.fixture.page.subscribed), true);
  await more.click(); await menu.locator('[data-menu-action="watch:subscribe"]').click();
  await host.locator('.subscription-panel:not([hidden])').waitFor();
  const subscription = await host.locator('.subscription-panel .sheet').boundingBox();
  assert.ok(subscription.x >= 0 && subscription.y >= 0 && subscription.x + subscription.width <= 1920 && subscription.y + subscription.height <= 1080);
  await press('back'); assert.equal(await focused(), 'moreActions');
  await more.click(); await menu.locator('[data-menu-action="watch:channel"]').click();
  await menu.waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate(() => window.fixture.commands.some(([type]) => type === 'channel')), true);
  const before = await page.evaluate(() => window.fixture.playback.video.paused);
  await press('playPause');
  assert.equal(await page.evaluate(() => window.fixture.playback.video.paused), !before);
  mkdirSync('output/playwright', { recursive: true });
  for (const width of [1920, 1280, 800]) {
    await page.setViewportSize({ width, height: 1080 });
    const boxes = await host.locator('.toolbar button').evaluateAll(nodes => nodes.map(node => {
      const b = node.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom };
    }));
    for (let i = 0; i < boxes.length; i++) {
      assert.ok(boxes[i].left >= 0 && boxes[i].right <= width);
      for (const other of boxes.slice(i + 1)) assert.ok(boxes[i].right <= other.left || other.right <= boxes[i].left || boxes[i].bottom <= other.top || other.bottom <= boxes[i].top);
    }
    await page.screenshot({ path: `output/playwright/tv-primary-controls-${width}.png` });
  }
  // Density tokens must reach controls across the watch Shadow DOM boundary.
  await page.setViewportSize({ width: 1920, height: 1080 });
  const controlHeight = () => host.locator('[data-action="captions"]').evaluate(node => node.getBoundingClientRect().height);
  const standardHeight = await controlHeight();
  for (const dark of [false, true]) {
    await page.evaluate(dark => {
      document.documentElement.toggleAttribute('dark', dark);
      document.documentElement.setAttribute('data-ytg-density', 'tv');
    }, dark);
    assert.ok(await controlHeight() > standardHeight);
    assert.equal(await host.locator('.surface').evaluate(node => getComputedStyle(node).getPropertyValue('--ytg-font-body').trim()), '20px');
    await page.setViewportSize({ width: 800, height: 650 });
    for (const box of await host.locator('.toolbar button').evaluateAll(nodes => nodes.map(node => {
      const b = node.getBoundingClientRect(); return { left: b.left, right: b.right };
    }))) assert.ok(box.left >= 0 && box.right <= 800);
    await page.setViewportSize({ width: 1920, height: 1080 });
  }
  await page.evaluate(() => document.documentElement.setAttribute('data-ytg-density', 'standard'));
  assert.equal(await controlHeight(), standardHeight);
  await page.evaluate(() => window.fixture.destroy());
});
