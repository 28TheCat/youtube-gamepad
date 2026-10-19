import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'vite';
import vue from '@vitejs/plugin-vue';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { browserPage } from './helpers/bundles.mjs';

const result = await build({ configFile: false, publicDir: false, logLevel: 'silent',
  plugins: [{ name: 'count-playback-region-updates', enforce: 'pre', transform(source, id) {
    const region = id.match(/\/(PlaybackMetadata|PlaybackRecommendations|PlaybackControls|PlaybackHints|Timeline|PlaybackCard)\.vue$/)?.[1];
    if (!region) return;
    return source.replace('<script setup lang="ts">', `<script setup lang="ts">\nimport { onBeforeUpdate as countRegionUpdate } from 'vue';\ncountRegionUpdate(() => { const counters = (window as any).__playbackUpdates ||= {}; counters['${region}'] = (counters['${region}'] || 0) + 1; });`);
  } }, vue({ template: { compilerOptions: { hoistStatic: false } } })],
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: { write: false, minify: false, lib: {
    entry: fileURLToPath(new URL('../src/ui/vue-watch-view.ts', import.meta.url)),
    formats: ['iife'], name: 'PlaybackViewFixture' } }
});
const code = (Array.isArray(result) ? result[0] : result).output.find(item => item.type === 'chunk').code;
const styles = readFileSync(new URL('../src/ui/watch.css', import.meta.url), 'utf8');
const theme = readFileSync(new URL('../src/ui/theme.css', import.meta.url), 'utf8');

test('progress, focus, metadata and recommendation updates render independently', async t => {
  const page = await browserPage(t);
  await page.setContent('<html><body><video></video></body></html>');
  await page.evaluate(code);
  await page.evaluate(styles => {
    window.view = PlaybackViewFixture.createVueWatchView({ activate() {}, closePanel() {}, styles: { watch: styles },
      controllerStyle: { badge() {}, hint() {}, bind() {} } });
    window.view.host.hidden = false; window.view.presentation.visible(true);
    window.pageInfo = { key: '/watch?v=first', isWatch: true, title: 'First title', channel: 'Creator', description: '',
      recommendations: [0, 1].map(index => ({ key: 'duplicate', label: `Queue item ${index}`, channel: 'Creator', thumbnail: '', thumbnailFallback: '' })) };
    window.tick = time => window.view.presentation.playback({ video: { paused: false, currentTime: time, duration: 100, volume: .4, muted: false,
      timeline: { isLive: false, canSeek: true, start: 0, end: 100, ranges: [{ start: 0, end: 100 }], atLiveEdge: false } }, captionsEnabled: false, settingsOpen: false });
    window.view.presentation.page(window.pageInfo, {}); window.tick(0);
  }, styles);
  const counts = () => page.evaluate(() => ({ ...window.__playbackUpdates }));
  const reset = () => page.evaluate(() => { window.__playbackUpdates = {}; });
  await reset();
  await page.evaluate(() => { for (let time = 1; time <= 30; time++) window.tick(time); });
  const progress = await counts();
  assert.ok(progress.Timeline > 0);
  for (const region of ['PlaybackMetadata', 'PlaybackRecommendations', 'PlaybackCard', 'PlaybackControls', 'PlaybackHints']) assert.equal(progress[region] || 0, 0, region);
  const host = page.locator('#ytg-watch');
  assert.equal(await host.getByRole('slider').getAttribute('aria-valuenow'), '30');
  await reset();
  await page.evaluate(() => {
    window.view.presentation.selection('recommendations', 'recommendation:duplicate:1', false);
    window.view.presentation.cards()[1].focus();
  });
  const focus = await counts();
  for (const region of ['PlaybackMetadata', 'PlaybackRecommendations', 'PlaybackCard', 'PlaybackControls', 'Timeline']) assert.equal(focus[region] || 0, 0, region);
  assert.equal(await host.locator('.card.selected').getAttribute('data-focus-id'), 'recommendation:duplicate:1');
  await reset();
  await page.evaluate(() => {
    window.pageInfo = { ...window.pageInfo, title: 'Updated title', recommendations: window.pageInfo.recommendations.map(item => ({ ...item })) };
    window.view.presentation.page(window.pageInfo, {});
  });
  const metadata = await counts();
  assert.equal(metadata.PlaybackMetadata, 1);
  for (const region of ['PlaybackRecommendations', 'PlaybackCard', 'PlaybackControls', 'Timeline']) assert.equal(metadata[region] || 0, 0, region);
  assert.equal(await host.locator('h1').textContent(), 'Updated title');
  await reset();
  await page.evaluate(() => {
    window.pageInfo = { ...window.pageInfo, recommendations: window.pageInfo.recommendations.map((item, index) => ({ ...item, label: `Changed ${index}` })) };
    window.view.presentation.page(window.pageInfo, {});
  });
  const recommendations = await counts();
  assert.equal(recommendations.PlaybackRecommendations, 1);
  assert.ok(recommendations.PlaybackCard > 0);
  for (const region of ['PlaybackMetadata', 'PlaybackControls', 'Timeline']) assert.equal(recommendations[region] || 0, 0, region);
  assert.equal(await host.locator('.card.selected').getAttribute('data-focus-id'), 'recommendation:duplicate:1');
  assert.equal(await page.evaluate(() => window.view.root.activeElement.dataset.focusId), 'recommendation:duplicate:1');
  await reset();
  await page.evaluate(() => window.view.presentation.page({ ...window.pageInfo, recommendations: window.pageInfo.recommendations.map(item => ({ ...item })) }, {}));
  assert.deepEqual(await counts(), {});
  await page.evaluate(() => window.view.presentation.selection('controls', 'like', false));
  await reset();
  await page.evaluate(() => {
    window.pageInfo = { ...window.pageInfo, liked: true };
    window.view.presentation.page(window.pageInfo, {});
  });
  const reaction = await counts();
  assert.equal(reaction.PlaybackControls, 1);
  for (const region of ['PlaybackMetadata', 'PlaybackRecommendations', 'PlaybackCard', 'Timeline']) assert.equal(reaction[region] || 0, 0, region);
  assert.equal(await host.locator('[data-action="like"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await host.locator('[data-action="like"]').evaluate(node => node.classList.contains('selected')), true);
  await page.evaluate(() => { window.view.updateHint('progress', true); window.view.presentation.selection('progress', 'progress', true); });
  assert.equal(await host.locator('.progress').evaluate(node => node.classList.contains('adjusting') && node.classList.contains('selected')), true);
  await page.evaluate(() => { window.view.presentation.destroy(); window.tick(50); window.view.presentation.selection('controls', 'like', false); });
  assert.equal(await host.locator('.card').count(), 0);
});
test('gamepad watch layout hides desktop recommendations even during capability recovery', async t => {
  const page = await browserPage(t);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.setContent('<html class="ytg-watch-layout" data-ytg-native="true"><body><ytd-masthead>Search</ytd-masthead><div id="movie_player"><div class="html5-video-container"><video class="html5-main-video"></video></div></div><div id="secondary">Desktop recommendations</div><div id="below">Metadata</div></body></html>');
  await page.addStyleTag({ content: readFileSync(new URL('../src/app/theater.css', import.meta.url), 'utf8') });
  for (const selector of ['ytd-masthead', '#secondary', '#below'])
    assert.equal(await page.locator(selector).evaluate(node => getComputedStyle(node).display), 'none');
  const bounds = await page.locator('#movie_player').boundingBox();
  assert.equal(bounds.x, 0); assert.equal(bounds.y, 0);
  assert.ok(Math.abs(bounds.width - 844.8) < 1);
  assert.ok(Math.abs(bounds.height - 475.2) < 1);
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
  const playerBefore = await page.locator('#movie_player').boundingBox();
  await page.screenshot({ path: 'output/watch-split-layout.png' });
  await page.evaluate(() => window.view.surface.classList.add('comments-open'));
  await page.evaluate(() => {
    document.documentElement.classList.add('ytg-comments');
    window.view.dialog.classList.add('comments');
    window.view.dialog.hidden = false;
  });
  assert.deepEqual(await page.locator('#movie_player').boundingBox(), playerBefore, 'switching tabs keeps the player fixed');
  const panelStyle = await host.locator('.dialog').evaluate(node => {
    const sheet = node.querySelector('.sheet');
    return { outer: getComputedStyle(node).backgroundColor, inner: getComputedStyle(sheet).backgroundColor,
      radius: getComputedStyle(sheet).borderTopRightRadius, scrollbar: getComputedStyle(sheet).scrollbarWidth };
  });
  assert.deepEqual(panelStyle, { outer: 'rgb(243, 244, 246)', inner: 'rgb(243, 244, 246)', radius: '0px', scrollbar: 'none' });
  assert.equal(await thumbnail.isVisible(), false, 'comments fully hide recommendation images');
  assert.equal(await host.locator('.toolbar').isVisible(), true);
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
