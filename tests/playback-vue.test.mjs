import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'vite';
import vue from '@vitejs/plugin-vue';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { browserPage } from './helpers/bundles.mjs';

const result = await build({ configFile: false, publicDir: false, logLevel: 'silent',
  plugins: [vue({ template: { compilerOptions: { hoistStatic: false } } })],
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: { write: false, minify: false, lib: {
    entry: fileURLToPath(new URL('../src/ui/vue-watch-view.ts', import.meta.url)),
    formats: ['iife'], name: 'PlaybackViewFixture' } }
});
const code = (Array.isArray(result) ? result[0] : result).output.find(item => item.type === 'chunk').code;
const styles = readFileSync(new URL('../src/ui/watch.css', import.meta.url), 'utf8');
const theme = readFileSync(new URL('../src/ui/theme.css', import.meta.url), 'utf8');
test('gamepad watch layout hides desktop recommendations even during capability recovery', async t => {
  const page = await browserPage(t);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.setContent('<html class="ytg-watch-layout" data-ytg-native="true"><body><ytd-masthead>Search</ytd-masthead><div id="movie_player"><div class="html5-video-container"><video class="html5-main-video"></video></div></div><div id="secondary">Desktop recommendations</div><div id="below">Metadata</div></body></html>');
  await page.addStyleTag({ content: readFileSync(new URL('../src/app/theater.css', import.meta.url), 'utf8') });
  for (const selector of ['ytd-masthead', '#secondary', '#below'])
    assert.equal(await page.locator(selector).evaluate(node => getComputedStyle(node).display), 'none');
  const bounds = await page.locator('#movie_player').boundingBox();
  assert.deepEqual(bounds, { x: 0, y: 0, width: 1280, height: 900 });
  await page.evaluate(() => document.documentElement.classList.remove('ytg-watch-layout'));
  assert.equal(await page.locator('#secondary').evaluate(node => getComputedStyle(node).display), 'block');
});
test('gamepad playback hides native end recommendations and restores them in native mode', async t => {
  const page = await browserPage(t);
  const selectors = ['.html5-endscreen', '.ytp-endscreen-content', '.ytp-autonav-endscreen', '.ytp-upnext', '.ytp-ce-element',
    '.ytp-fullscreen-grid', '.ytp-fullscreen-grid-stills-container', '.ytp-modern-videowall-still'];
  await page.setContent(`<html class="ytg-watch-active"><body><div id="movie_player"><video></video><div class="caption-window">Captions</div>${selectors.map(selector => `<div class="${selector.slice(1)}">Native recommendation</div>`).join('')}</div></body></html>`);
  await page.addStyleTag({ content: readFileSync(new URL('../src/app/theater.css', import.meta.url), 'utf8') });
  for (const selector of selectors) assert.equal(await page.locator(selector).evaluate(node => getComputedStyle(node).display), 'none');
  for (const selector of ['video', '.caption-window']) assert.notEqual(await page.locator(selector).evaluate(node => getComputedStyle(node).display), 'none');
  await page.evaluate(() => document.documentElement.setAttribute('data-ytg-native', 'true'));
  for (const selector of selectors) assert.notEqual(await page.locator(selector).evaluate(node => getComputedStyle(node).display), 'none');
  await page.evaluate(() => {
    document.documentElement.removeAttribute('data-ytg-native');
    document.documentElement.classList.remove('ytg-watch-active');
  });
  for (const selector of selectors) assert.notEqual(await page.locator(selector).evaluate(node => getComputedStyle(node).display), 'none');
});

test('opening comments hides recommendation thumbnails and closing restores them', async t => {
  const page = await browserPage(t);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.setContent(`<html class="ytg-watch-layout"><head><style>${theme}</style></head><body><div id="movie_player"><video></video></div></body></html>`);
  await page.addStyleTag({ content: readFileSync(new URL('../src/app/theater.css', import.meta.url), 'utf8') });
  await page.evaluate(code);
  await page.evaluate(styles => {
    window.view = PlaybackViewFixture.createVueWatchView({
      activate() {}, closePanel() {}, styles: { watch: styles },
      controllerStyle: { badge() {}, hint() {}, bind() {} }
    });
    window.view.host.hidden = false;
    window.view.presentation.page({ key: 'fixture', isWatch: true, title: 'Video', channel: '', description: '',
      recommendations: [{ key: 'next', label: 'Next video', channel: '', thumbnail: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="100" height="60"/%3E', thumbnailFallback: '' }]
    }, {});
  }, styles);
  const host = page.locator('#ytg-watch'), thumbnail = host.locator('.card-thumbnail img');
  assert.equal(await thumbnail.isVisible(), true);
  await page.evaluate(() => window.view.surface.classList.add('comments-open'));
  await page.evaluate(() => {
    document.documentElement.classList.add('ytg-comments');
    window.view.dialog.classList.add('comments');
    window.view.dialog.hidden = false;
  });
  assert.deepEqual(await page.locator('#movie_player').boundingBox(), { x: 0, y: 0, width: 1280, height: 900 }, 'comments float over the full-size video');
  const panelStyle = await host.locator('.dialog').evaluate(node => {
    const sheet = node.querySelector('.sheet');
    return { outer: getComputedStyle(node).backgroundColor, inner: getComputedStyle(sheet).backgroundColor,
      radius: getComputedStyle(sheet).borderTopRightRadius, scrollbar: getComputedStyle(sheet).scrollbarWidth };
  });
  assert.deepEqual(panelStyle, { outer: 'rgba(0, 0, 0, 0)', inner: 'rgb(24, 24, 24)', radius: '24px', scrollbar: 'none' });
  assert.equal(await thumbnail.isVisible(), false, 'comments must hide thumbnails with explicit visibility:visible');
  assert.equal(await host.locator('.toolbar').isVisible(), false);
  await page.evaluate(() => window.view.surface.classList.remove('comments-open'));
  await page.evaluate(() => { window.view.dialog.hidden = true; document.documentElement.classList.remove('ytg-comments'); });
  assert.equal(await thumbnail.isVisible(), true, 'closing comments restores recommendations');
  assert.equal(await host.locator('.toolbar').isVisible(), true);
  await page.evaluate(() => window.view.presentation.destroy());
});

for (const trustedTypes of [false, true]) {
  test(`Vue playback drag preserves snapshot preview and native video (Trusted Types: ${trustedTypes})`, { timeout: 30000 }, async t => {
    const page = await browserPage(t);
    await page.route('https://www.youtube.com/**', route => route.fulfill({
      contentType: 'text/html', body: `<html><head><style>${theme}</style></head><body><video id="native-video"></video></body></html>`,
      headers: trustedTypes ? { 'content-security-policy': "require-trusted-types-for 'script'; trusted-types 'none'" } : {}
    }));
    await page.goto('https://www.youtube.com/watch?v=fixture');
    await page.evaluate(code);
    await page.evaluate(styles => {
      window.nativeVideo = document.querySelector('video');
      window.commands = []; window.seeks = [];
      window.view = PlaybackViewFixture.createVueWatchView({
        activate: action => window.commands.push(action), seek: seconds => { window.seeks.push(seconds); return true; }, closePanel() {},
        styles: { watch: styles }, controllerStyle: {
          badge(node, value) { node.textContent = value; return node; },
          hint(node, value) { node.textContent = value; return node; },
          bind(node, value, attribute) { node.setAttribute(attribute, value); }
        }
      });
      window.setSnapshot = (currentTime, live = false) => window.view.presentation.playback({
        video: { paused: true, currentTime, duration: live ? Infinity : 100, volume: .4, muted: false,
          timeline: { isLive: live, canSeek: true, start: live ? 100 : 0, end: live ? 200 : 100,
            ranges: [{ start: live ? 100 : 0, end: live ? 200 : 100 }], atLiveEdge: false } },
        captionsEnabled: true, settingsOpen: false
      });
      window.view.host.hidden = false; window.view.presentation.visible(true); window.setSnapshot(20);
    }, styles);
    const host = page.locator('#ytg-watch'), slider = host.getByRole('slider');
    await host.getByRole('button', { name: 'Play', exact: true }).click();
    assert.deepEqual(await page.evaluate(() => window.commands), ['playPause']);
    await host.getByRole('button', { name: 'Volume up', exact: true }).click();
    assert.equal(await host.locator('[data-view="volume"]').textContent(), '40%');
    const bounds = await slider.boundingBox();
    assert.ok(bounds?.width > 0);
    await page.mouse.move(bounds.x + bounds.width * .7, bounds.y + bounds.height / 2);
    await page.mouse.down();
    await page.evaluate(() => window.setSnapshot(25));
    assert.ok(Math.abs(Number(await slider.getAttribute('aria-valuenow')) - 70) < .01);
    assert.equal(await page.evaluate(() => window.seeks.length), 0);
    await page.mouse.up();
    await page.waitForFunction(() => window.seeks.length === 1);
    assert.equal(Math.round(await page.evaluate(() => window.seeks[0])), 70);
    await page.evaluate(() => window.setSnapshot(150, true));
    assert.equal(await slider.getAttribute('aria-valuemin'), '100');
    assert.equal(await slider.getAttribute('aria-valuemax'), '200');
    assert.equal(await page.evaluate(() => document.querySelector('video') === window.nativeVideo), true);
    await page.evaluate(() => window.view.presentation.destroy());
    assert.equal(await page.evaluate(() => document.querySelector('video') === window.nativeVideo), true);
  });
}
