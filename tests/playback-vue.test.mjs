import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'vite';
import vue from '@vitejs/plugin-vue';
import { mkdirSync, readFileSync } from 'node:fs';
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

test('shared action buttons reflect player state and delegate commands', async t => {
  const page = await browserPage(t);
  await page.setContent('<html><body></body></html>');
  await page.evaluate(code);
  await page.evaluate(styles => {
    window.actions = [];
    window.view = PlaybackViewFixture.createVueWatchView({ activate: action => window.actions.push(action), closePanel() {}, styles: { watch: styles }, controllerStyle: { badge() {}, hint() {}, bind() {} } });
    window.view.host.hidden = false; window.view.presentation.visible(true);
    window.view.presentation.page({ key: 'video', isWatch: true, title: 'Video', channel: 'Creator', liked: true, recommendations: [] }, {});
    window.view.presentation.playback({ video: { paused: true, muted: true, currentTime: 0, duration: 30, volume: .5 }, captionsEnabled: false, settingsOpen: false });
  }, styles);
  const controls = page.locator('#ytg-watch .toolbar');
  assert.equal(await controls.locator('.media-action').count(), 4);
  assert.equal(await controls.locator('[data-action=like]').getAttribute('aria-pressed'), 'true');
  assert.equal(await controls.locator('[data-action=mute]').getAttribute('aria-pressed'), 'true');
  assert.equal(await controls.locator('[data-action=save]').getAttribute('aria-pressed'), null);
  for (const action of ['like', 'comments', 'save', 'mute']) await controls.locator(`[data-action=${action}]`).click();
  assert.deepEqual(await page.evaluate(() => window.actions), ['like', 'comments', 'save', 'mute']);
  for (const seekStep of [20, 7]) {
    await page.evaluate(seekStep => window.view.presentation.playback({ seekStep, video: { paused: true, currentTime: 0, duration: 30 }, captionsEnabled: false, settingsOpen: false }), seekStep);
    assert.equal(await controls.locator('[data-action=seekBack]').getAttribute('aria-label'), `Rewind ${seekStep} seconds`);
    assert.equal(await controls.locator('[data-action=seekForward]').getAttribute('aria-label'), `Forward ${seekStep} seconds`);
  }
});

test('shared channel avatars fall back on errors and recover when the source changes', async t => {
  const page = await browserPage(t);
  await page.route('https://avatars.test/**', route => route.request().url().endsWith('/good.svg')
    ? route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="red"/></svg>' })
    : route.fulfill({ contentType: 'text/plain', body: 'invalid image' }));
  await page.setContent(`<html data-ytg-playback-layout="windowed"><head><style>${theme}</style></head><body></body></html>`);
  await page.evaluate(code);
  await page.evaluate(styles => {
    window.view = PlaybackViewFixture.createVueWatchView({ activate() {}, closePanel() {}, styles: { watch: styles },
      controllerStyle: { badge() {}, hint() {}, bind() {} } });
    window.view.host.hidden = false;
    window.view.presentation.visible(true);
    window.pageInfo = { key: 'fixture', isWatch: true, title: 'Video', channel: ' 😀 Creator ',
      avatar: 'https://avatars.test/broken', recommendations: [] };
    window.view.presentation.page(window.pageInfo, {});
  }, styles);
  const avatar = page.locator('#ytg-watch .channel-portrait');
  await avatar.locator('[data-view="avatarFallback"]').waitFor();
  assert.equal(await avatar.textContent(), '😀');
  assert.equal(await avatar.locator('img').count(), 0);
  const before = await avatar.boundingBox();
  assert.equal(before.width, 36);
  assert.equal(before.height, 36);
  await page.evaluate(() => window.view.presentation.page({ ...window.pageInfo, avatar: 'https://avatars.test/good.svg' }, {}));
  await page.waitForFunction(() => window.view.root.querySelector('.channel-portrait img')?.naturalWidth > 0);
  assert.deepEqual(await avatar.boundingBox(), before, 'switching between an image and fallback preserves avatar size');
  assert.equal(await avatar.locator('[data-view="avatarFallback"]').count(), 0);
  await page.evaluate(() => window.view.presentation.page({ ...window.pageInfo, avatar: '', channel: ' ' }, {}));
  await avatar.locator('[data-view="avatarFallback"]').waitFor();
  assert.equal(await avatar.textContent(), '●');
});

test('recommendations leave loading blank and show text before delayed covers without shifting cards', async t => {
  const page = await browserPage(t);
  let releaseCover;
  const coverReady = new Promise(resolve => { releaseCover = resolve; });
  await page.route('https://covers.test/**', async route => {
    await coverReady;
    await route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="green"/></svg>' });
  });
  t.after(() => releaseCover());
  await page.setContent(`<html class="ytg-watch-layout" data-ytg-playback-layout="windowed"><head><style>${theme}</style></head><body></body></html>`);
  await page.evaluate(code);
  await page.evaluate(styles => {
    window.view = PlaybackViewFixture.createVueWatchView({ activate() {}, closePanel() {}, styles: { watch: styles },
      controllerStyle: { badge() {}, hint() {}, bind() {} } });
    window.view.host.hidden = false;
    window.view.presentation.visible(true);
    window.pageInfo = { key: 'fixture', isWatch: true, title: 'Video', channel: '', description: '', recommendations: [] };
    window.view.presentation.page(window.pageInfo, {});
  }, styles);
  const host = page.locator('#ytg-watch');
  assert.equal(await host.locator('.empty').count(), 0);
  await page.evaluate(() => window.view.presentation.page({ ...window.pageInfo, recommendations: [
    { key: 'next', label: 'Next video', channel: 'Creator', metadata: '12K views', thumbnail: 'https://covers.test/next.svg' }
  ] }, {}));
  const card = host.locator('.card'), image = card.locator('img');
  assert.equal(await card.locator('.card-title').textContent(), 'Next video');
  assert.equal(await card.locator('.card-meta').first().textContent(), 'Creator');
  assert.equal(await image.evaluate(node => getComputedStyle(node).opacity), '0');
  const before = await card.boundingBox();
  releaseCover();
  await page.waitForFunction(() => getComputedStyle(window.view.root.querySelector('.card img')).opacity === '1');
  assert.deepEqual(await card.boundingBox(), before);
  await page.evaluate(() => window.view.presentation.page(window.pageInfo, { recommendations: 'failed' }));
  assert.equal(await host.locator('.empty[role="status"]').count(), 1);
  await page.evaluate(() => window.view.presentation.page(window.pageInfo, {}));
  assert.equal(await host.locator('.empty').count(), 0);
});

test('windowed collections appear as the first conditional tab with ordered entries and isolated recommendations', async t => {
  const page = await browserPage(t);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.route('https://covers.test/**', route => route.fulfill({ contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#596879"/></svg>' }));
  await page.setContent(`<html class="ytg-watch-layout" data-ytg-playback-layout="windowed" data-ytg-language="zh-CN"><head><style>${theme}</style></head><body style="margin:0"><div id="movie_player"><video></video></div></body></html>`);
  await page.evaluate(code);
  await page.evaluate(styles => {
    window.actions = [];
    window.originalVideo = document.querySelector('video');
    window.view = PlaybackViewFixture.createVueWatchView({ activate: action => window.actions.push(action), closePanel() {}, styles: { watch: styles },
      controllerStyle: { badge() {}, hint() {}, bind() {} } });
    window.view.host.hidden = false;
    window.view.host.style.cssText = '--ytg-watch-side:420px;--ytg-watch-width:860px;--ytg-watch-height:480px';
    const entry = (id, index, selected = false) => ({ key: `queue:${id}`, href: `/watch?v=${id}&list=PLtest&index=${index}`,
      label: `Episode ${index}`, channel: 'Creator', queue: true, selected, duration: '3:39', thumbnail: 'https://covers.test/cover.svg' });
    window.queue = [entry('first', 1), entry('current', 2, true), entry('next', 3)];
    window.related = { key: 'related', label: 'Related video', channel: 'Other creator', thumbnail: 'https://covers.test/cover.svg' };
    window.pageInfo = { key: '/watch?v=current&list=PLtest&index=2', isWatch: true, title: 'Episode 2', channel: 'Creator', description: '',
      playlistTitle: '示例合集', playlistTotal: 24, queue: window.queue, recommendations: [window.queue[0], window.queue[2], window.related] };
    window.view.presentation.page(window.pageInfo, {});
  }, styles);
  const host = page.locator('#ytg-watch');
  assert.deepEqual(await host.locator('.watch-tabs [role=tab]').allTextContents(), ['合集', '推荐视频', '评论']);
  assert.equal(await host.getByRole('tab', { name: '合集', exact: true }).getAttribute('aria-selected'), 'true');
  await host.locator('.collection-heading h2').getByText('示例合集').waitFor();
  assert.equal(await host.locator('.collection-heading p').textContent(), '正在播放 2 / 24');
  await page.evaluate(() => window.view.presentation.page({ ...window.pageInfo, playlistTotal: 30 }, {}));
  assert.equal(await host.locator('.collection-heading p').textContent(), '正在播放 2 / 30');
  await page.evaluate(() => window.view.presentation.page({ ...window.pageInfo, playlistTotal: undefined }, {}));
  assert.equal(await host.locator('.collection-heading p').textContent(), '正在播放第 2 项');
  await page.evaluate(() => window.view.presentation.page(window.pageInfo, {}));
  assert.equal(await host.locator('.collection-entry').count(), 3);
  assert.equal(await host.locator('.collection-close').count(), 0, 'windowed collections remain part of the page');
  assert.equal(await host.locator('.transport-group,.times,.progress,.player-option,.windowed-fullscreen').count(), 0,
    'windowed previews never render duplicate custom player controls');
  assert.equal(await host.locator('.currently-playing').getAttribute('aria-current'), 'true');
  assert.equal(await host.locator('.currently-playing').isDisabled(), true);
  assert.equal(await host.locator('.currently-playing .card-duration').textContent(), '3:39');
  assert.equal(await host.locator('.currently-playing .collection-playing-icon').count(), 1);
  assert.equal(await host.locator('.collection-entry .card-thumbnail').count(), 3);
  assert.equal(await host.locator('.collection-entry .card-meta').count(), 3, 'playlist rows retain author names like YouTube');
  await page.evaluate(() => {
    const queue = window.queue.map((item, index) => index === 2 ? { ...item, channel: 'Second creator' } : item);
    window.view.presentation.page({ ...window.pageInfo, queue }, {});
  });
  assert.deepEqual(await host.locator('.collection-entry .card-meta').allTextContents(), ['Creator', 'Creator', 'Second creator']);
  await page.evaluate(() => window.view.presentation.page(window.pageInfo, {}));
  assert.equal(await host.locator('.collection-entry .card-meta').count(), 3);
  assert.equal(await page.evaluate(() => window.view.presentation.cards().length), 2, 'the playing entry is excluded from navigation');
  await host.locator('[data-video-id="queue:next"]').click();
  assert.equal(await page.evaluate(() => window.actions.at(-1)), 'recommendation:queue:next');
  mkdirSync('output/playwright', { recursive: true });
  await page.screenshot({ path: 'output/playwright/watch-collection-tab.png' });
  await host.getByRole('tab', { name: '推荐视频', exact: true }).click();
  assert.equal(await host.locator('.recommendations .card').count(), 1);
  assert.equal(await host.locator('.recommendations .card-title').textContent(), 'Related video');
  await host.getByRole('tab', { name: '合集', exact: true }).click();
  assert.equal(await host.getByRole('tab', { name: '合集', exact: true }).getAttribute('aria-selected'), 'true');
  await page.evaluate(() => {
    window.view.surface.classList.add('comments-open');
    window.view.updateHint('controls', false);
  });
  assert.equal(await host.locator('.collection-panel').isVisible(), false, 'comments hide the collection instead of overlapping it');
  assert.equal(await host.getByRole('tab', { name: '评论', exact: true }).getAttribute('aria-selected'), 'true');
  await page.evaluate(() => { window.view.surface.classList.remove('comments-open'); window.view.updateHint('controls', false); });
  await page.evaluate(() => { document.documentElement.dataset.ytgPlaybackLayout = 'fullscreen'; });
  assert.equal(await host.locator('.collection-tab').count(), 0);
  assert.equal(await host.locator('.recommendations .card').count(), 3, 'fullscreen retains the existing combined recommendation navigation');
  await host.locator('[data-action="collection"]').click();
  assert.equal(await host.locator('.collection-panel').isVisible(), true);
  assert.equal(await host.locator('.collection-panel').getAttribute('aria-modal'), 'true');
  assert.equal(await page.evaluate(() => window.view.sideIndex()), 1, 'fullscreen selection starts after the playing episode');
  await host.locator('.collection-panel').evaluate(node => Promise.all(node.getAnimations().map(animation => animation.finished)));
  assert.ok(await host.locator('.collection-panel').evaluate(node => { const box = node.getBoundingClientRect(); return box.top === 0 && box.bottom === innerHeight; }), 'drawer covers the viewport height');
  await page.screenshot({ path: 'output/playwright/watch-fullscreen-collection.png' });
  await host.locator('.collection-close').click();
  assert.equal(await host.locator('.collection-panel').count(), 0);
  assert.equal(await page.evaluate(() => window.actions.at(-1)), 'collectionClosed');
  await host.locator('[data-action="collection"]').click();
  await host.locator('.collection-backdrop').click({ position: { x: 10, y: 100 } });
  assert.equal(await host.locator('.collection-panel').count(), 0, 'clicking outside closes the drawer');
  await host.locator('[data-action="collection"]').click();
  assert.equal(await host.locator('.collection-entry').count(), 3);
  await host.locator('[data-video-id="queue:next"]').click();
  assert.equal(await host.locator('.collection-panel').count(), 0, 'selecting an episode closes the fullscreen collection');
  assert.equal(await page.evaluate(() => window.actions.at(-1)), 'recommendation:queue:next');
  await page.evaluate(() => { document.documentElement.dataset.ytgPlaybackLayout = 'windowed'; });
  await host.locator('.collection-tab').waitFor();
  await page.setViewportSize({ width: 900, height: 800 });
  await page.evaluate(() => { window.view.host.style.setProperty('--ytg-watch-side', '280px'); window.view.host.style.setProperty('--ytg-watch-width', '620px'); });
  assert.ok(await host.locator('.collection-entry').first().evaluate(node => {
    const bounds = node.getBoundingClientRect(), duration = node.querySelector('.card-duration').getBoundingClientRect();
    return duration.right <= bounds.right && node.scrollWidth <= bounds.width + 1;
  }), 'narrow collections retain compact horizontal entries');
  await page.evaluate(() => {
    const queue = Array.from({ length: 40 }, (_, index) => ({ key: `episode-${index}`, label: `Episode ${index + 1}`, channel: 'Creator',
      href: `/watch?v=episode-${index}&list=PLtest&index=${index + 1}`, thumbnail: 'https://covers.test/cover.svg', queue: true, selected: index === 30 }));
    window.view.presentation.page({ ...window.pageInfo, key: '/watch?v=episode-30&list=PLtest&index=31', queue,
      recommendations: [...queue.filter(item => !item.selected), window.related] }, {});
  });
  await page.waitForFunction(() => {
    const panel = window.view.root.querySelector('.collection-panel'), current = panel?.querySelector('.currently-playing');
    if (!current) return false;
    const bounds = panel.getBoundingClientRect(), item = current.getBoundingClientRect(), heading = panel.querySelector('.collection-heading').offsetHeight;
    return item.top >= bounds.top + heading && item.bottom <= bounds.bottom;
  });
  await page.evaluate(() => {
    document.documentElement.dataset.ytgInputMode = 'gamepad';
    const target = window.view.root.querySelector('[data-video-id="episode-32"]');
    window.view.presentation.selection('recommendations', target.dataset.focusId, false);
  });
  const focusedEntry = host.locator('[data-video-id="episode-32"]');
  assert.deepEqual(await focusedEntry.evaluate(node => {
    const style = getComputedStyle(node);
    return [style.outlineStyle, style.outlineWidth, style.outlineOffset];
  }), ['solid', '2px', '-2px']);
  assert.notEqual(await focusedEntry.evaluate(node => getComputedStyle(node).backgroundColor),
    await host.locator('.currently-playing').evaluate(node => getComputedStyle(node).backgroundColor), 'focus and playback have distinct backgrounds');
  await page.evaluate(() => { document.documentElement.dataset.ytgInputMode = 'mouse'; });
  assert.equal(await focusedEntry.evaluate(node => getComputedStyle(node).outlineStyle), 'none', 'mouse input hides the controller outline');
  await page.evaluate(() => {
    document.documentElement.dataset.ytgInputMode = 'gamepad';
    document.documentElement.classList.add('ytg-settings-open');
  });
  assert.equal(await focusedEntry.evaluate(node => getComputedStyle(node).outlineStyle), 'none', 'settings suppress background focus');
  await page.evaluate(() => { document.documentElement.classList.remove('ytg-settings-open'); });
  await page.evaluate(() => window.view.presentation.page({ ...window.pageInfo, key: '/watch?v=ordinary', queue: [], playlistTitle: '', recommendations: [window.related] }, {}));
  assert.deepEqual(await host.locator('.watch-tabs [role=tab]').allTextContents(), ['推荐视频', '评论']);
  assert.equal(await host.getByRole('tab', { name: '推荐视频', exact: true }).getAttribute('aria-selected'), 'true');
  assert.equal(await page.evaluate(() => document.querySelector('video') === window.originalVideo), true);
});

test('shared video thumbnails recover through fallback, keep blank placeholders and suppress playlist overlays', async t => {
  const page = await browserPage(t);
  await page.route('https://covers.test/**', route => route.request().url().endsWith('valid.svg')
    ? route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"/>' })
    : route.abort());
  await page.setContent(`<html class="ytg-watch-layout"><head><style>${theme}</style></head><body></body></html>`);
  await page.evaluate(code);
  await page.evaluate(styles => {
    window.view = PlaybackViewFixture.createVueWatchView({ activate() {}, closePanel() {}, styles: { watch: styles },
      controllerStyle: { badge() {}, hint() {}, bind() {} } });
    window.view.host.hidden = false;
    window.pageInfo = { key: 'fixture', isWatch: true, title: 'Video', channel: '', description: '', recommendations: [] };
    window.setThumbnail = item => window.view.presentation.page({ ...window.pageInfo, recommendations: [
      { key: 'next', label: 'Next', channel: '', ...item }
    ] }, {});
    window.setThumbnail({ thumbnail: '', duration: '1:23', watchedPercent: 140 });
  }, styles);
  const thumbnail = page.locator('#ytg-watch .video-thumbnail');
  await thumbnail.locator('.thumbnail-placeholder').waitFor();
  assert.equal(await thumbnail.locator('img').count(), 0);
  assert.equal(await thumbnail.locator('.card-duration').textContent(), '1:23');
  assert.equal(await thumbnail.locator('.card-watch-progress>span').evaluate(el => el.style.width), '100%');
  await page.evaluate(() => window.setThumbnail({ thumbnail: 'https://covers.test/broken', thumbnailFallback: 'https://covers.test/valid.svg' }));
  await thumbnail.locator('img[data-loaded=true]').waitFor();
  assert.equal(await thumbnail.locator('img').getAttribute('src'), 'https://covers.test/valid.svg');
  assert.equal(await thumbnail.locator('img').evaluate(el => getComputedStyle(el).opacity), '1');
  await page.evaluate(() => window.setThumbnail({ thumbnail: 'https://covers.test/broken', thumbnailFallback: 'https://covers.test/also-broken' }));
  await thumbnail.locator('.thumbnail-placeholder').waitFor();
  assert.equal(await thumbnail.locator('img').count(), 0);
  await page.evaluate(() => window.setThumbnail({ thumbnail: 'https://covers.test/valid.svg', isPlaylist: true, duration: '1:23', watchedPercent: 50 }));
  await thumbnail.locator('img[data-loaded=true]').waitFor();
  assert.equal(await thumbnail.locator('.card-duration,.card-watch-progress').count(), 0);
});

test('split playback fits resized and zoomed viewports and scrolls only its side content', async t => {
  const page = await browserPage(t);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setContent(`<!doctype html><html class="ytg-watch-layout ytg-gamepad-input" data-ytg-playback-layout="windowed" data-ytg-language="zh-CN"><head><style>${theme}</style></head><body style="margin:0"><div id="movie_player"><video class="html5-main-video"></video></div></body></html>`);
  await page.addStyleTag({ content: readFileSync(new URL('../src/app/theater.css', import.meta.url), 'utf8') });
  await page.evaluate(code);
  await page.evaluate(styles => {
    window.view = PlaybackViewFixture.createVueWatchView({ activate() {}, closePanel() {}, styles: { watch: styles },
      controllerStyle: { badge() {}, hint() {}, bind() {} } });
    window.view.host.hidden = false;
    window.view.presentation.visible(true);
    window.view.presentation.page({ key: 'fixture', isWatch: true,
      title: '雨天里的城市漫步 · 一起走过安静的街道与熟悉的风景', channel: '清月已经不困了', channelBadge: 'verified', viewCount: '122693', description: '',
      recommendations: Array.from({ length: 24 }, (_, index) => ({ key: `next-${index}`, label: `下一段旅程 · 城市漫步 ${index + 1}`, channel: '城市记录', metadata: '12万次观看 · 3天前', thumbnail: '', thumbnailFallback: '', ...(index === 0 ? { watchedPercent: 37, channelBadge: 'artist' } : {}) }))
    }, {});
  }, styles);
  assert.equal(await page.locator('#ytg-watch .card-watch-progress>span').evaluate(node => node.style.width), '37%');
  assert.equal(await page.locator('#ytg-watch .control.avatar .channel-badge svg').getAttribute('data-icon'), 'material:verified-fill');
  assert.equal(await page.locator('#ytg-watch .heading').textContent().then(text => text.includes('清月已经不困了')), false);
  assert.equal(await page.locator('#ytg-watch .heading .meta .channel-badge').count(), 0);
  assert.match(await page.locator('#ytg-watch .heading .meta').textContent(), /122,693/);
  assert.equal(await page.locator('#ytg-watch .card').nth(0).locator('.channel-badge svg').getAttribute('data-icon'), 'material:artist-fill');
  assert.equal(await page.locator('#ytg-watch .card').nth(1).locator('.channel-badge').count(), 0);
  assert.equal(await page.locator('#ytg-watch .control.avatar .channel-badge svg').evaluate(node => getComputedStyle(node).width), '14px');
  mkdirSync(new URL('../output/playwright/', import.meta.url), { recursive: true });
  // Smaller CSS viewports also reproduce the layout pressure of browser zoom.
  for (const [width, height] of [[1920, 1080], [1280, 900], [1440, 900], [960, 720], [768, 600], [640, 480]]) {
    await page.setViewportSize({ width, height });
    const geometry = await page.evaluate(() => {
      const rect = node => { const r = node.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }; };
      const root = window.view.root;
      window.view.surface.scrollTop = 200;
      const recommendations = root.querySelector('.recommendations');
      recommendations.scrollTop = 200;
      return { player: rect(document.querySelector('#movie_player')), heading: rect(root.querySelector('.heading')),
        toolbar: rect(root.querySelector('.toolbar')), controls: [...root.querySelectorAll('.toolbar .control:not([hidden])')].map(rect),
        scroll: window.view.surface.scrollTop, sideScroll: recommendations.scrollTop,
        documentScroll: document.scrollingElement.scrollTop, tabs: rect(root.querySelector('.watch-tabs')) };
    });
    const side = width <= 700 ? Math.min(240, width * .4) : width <= 1050 ? 340 : 460;
    assert.ok(Math.abs(geometry.player.right - (width - side)) < .1, `stable sidebar at ${width}`);
    assert.ok(Math.abs(height - geometry.player.bottom - 177) < .1, `stable information area at ${width}`);
    assert.ok(geometry.heading.top >= geometry.player.bottom - 1, `title below video at ${width}`);
    assert.ok(geometry.toolbar.top >= geometry.heading.bottom - 1, `controls below title at ${width}`);
    assert.ok(geometry.toolbar.left >= 0 && geometry.toolbar.right <= geometry.player.right + 1,
      `scrollable controls stay in media column at ${width}`);
    for (const control of geometry.controls) {
      assert.ok(control.bottom <= height, `control stays in viewport at ${width}`);
    }
    assert.equal(geometry.scroll, 0, `watch surface cannot scroll at ${width}`);
    assert.equal(geometry.documentScroll, 0);
    assert.ok(geometry.sideScroll > 0, 'recommendations can scroll independently');
    assert.equal(geometry.tabs.top, geometry.player.top);
    await page.mouse.move(geometry.player.right / 2, geometry.toolbar.top + 12);
    await page.mouse.wheel(0, 400);
    assert.equal(await page.evaluate(() => document.scrollingElement.scrollTop), 0, 'wheel over controls keeps the page fixed');
    await page.evaluate(() => { window.view.root.querySelector('.recommendations').scrollTop = 0; });
    await page.screenshot({ path: `output/playwright/watch-responsive-${width}.png` });
  }
  await page.evaluate(() => {
    window.view.surface.classList.add('comments-open');
    window.view.dialog.classList.add('comments');
    window.view.dialog.hidden = false;
    for (let index = 0; index < 30; index++) {
      const comment = document.createElement('p'); comment.textContent = `评论 ${index + 1}：喜欢这样的城市漫步。`;
      window.view.description.append(comment);
    }
    window.view.sheet.scrollTop = 200;
  });
  assert.ok(await page.evaluate(() => window.view.sheet.scrollTop > 0));
  assert.equal(await page.evaluate(() => window.view.surface.scrollTop), 0);
  assert.equal(await page.locator('#ytg-watch .toolbar').isVisible(), true);
  await page.screenshot({ path: 'output/playwright/watch-responsive-comments.png' });
});

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
    window.pageInfo = { ...window.pageInfo, recommendations: window.pageInfo.recommendations.map((item, index) => ({ ...item, label: `Changed ${index}`, metadata: '1694万次观看 · 9年前' })) };
    window.view.presentation.page(window.pageInfo, {});
  });
  const recommendations = await counts();
  assert.equal(recommendations.PlaybackRecommendations, 1);
  assert.ok(recommendations.PlaybackCard > 0);
  assert.equal(await host.locator('.card').first().locator('.card-meta').last().textContent(), '1694万次观看 · 9年前');
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
  assert.ok(Math.abs(bounds.width - 820) < 1);
  assert.ok(Math.abs(bounds.height - 723) < 1);
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
  assert.deepEqual(panelStyle, { outer: 'rgb(255, 255, 255)', inner: 'rgb(255, 255, 255)', radius: '0px', scrollbar: 'none' });
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
      contentType: 'text/html', body: `<html data-ytg-playback-layout="fullscreen"><head><style>${theme}</style></head><body><video id="native-video"></video></body></html>`,
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
    assert.equal(await host.locator('.transport-group').isVisible(), true);
    assert.equal(await host.locator('.windowed-fullscreen').count(), 0);
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


test('playlist route reserves its collection tab and sidebar before queue data arrives', async t => {
  const page = await browserPage(t);
  await page.setContent('<html data-ytg-playback-layout="windowed"><body></body></html>');
  await page.evaluate(code);
  const result = await page.evaluate(styles => {
    const view = PlaybackViewFixture.createVueWatchView({ activate() {}, closePanel() {}, styles: { watch: styles },
      controllerStyle: { badge() {}, hint() {}, bind() {} } });
    const info = { key: '/watch?v=episode&list=PLtest', isWatch: true, title: '', channel: '', recommendations: [], queue: [] };
    view.presentation.page(info, {});
    const tab = view.root.querySelector('.collection-tab');
    const panel = view.root.querySelector('.collection-panel');
    const pending = { tab: !!tab, panel: !!panel, placeholders: panel?.querySelectorAll('.collection-placeholder').length };
    view.presentation.page({ ...info, title: 'Episode', queue: [{ key: 'episode', label: 'Episode', channel: 'Creator', selected: true, queue: true }] }, {});
    return { pending, sameTab: tab === view.root.querySelector('.collection-tab'), samePanel: panel === view.root.querySelector('.collection-panel'),
      loading: !!view.root.querySelector('.collection-loading'), entries: view.root.querySelectorAll('.collection-entry').length };
  }, styles);
  assert.deepEqual(result, { pending: { tab: true, panel: true, placeholders: 5 }, sameTab: true, samePanel: true, loading: false, entries: 1 });
});

test('late collection data updates the entry and list in the same page refresh', async t => {
  const page = await browserPage(t);
  await page.setContent('<html data-ytg-playback-layout="windowed"><body></body></html>');
  await page.evaluate(code);
  const state = await page.evaluate(styles => {
    const view = PlaybackViewFixture.createVueWatchView({ activate() {}, closePanel() {}, styles: { watch: styles },
      controllerStyle: { badge() {}, hint() {}, bind() {} } });
    view.host.hidden = false;
    const queue = [];
    const info = { key: 'video', isWatch: true, title: 'Video', channel: 'Creator', queue, recommendations: [] };
    view.presentation.page(info, {});
    queue.push({ key: 'episode', label: 'Episode', channel: 'Creator', queue: true, selected: true });
    view.presentation.page({ ...info, recommendations: [...queue] }, {});
    return { entry: !!view.root.querySelector('.collection-tab'), list: !!view.root.querySelector('.collection-entry') };
  }, styles);
  assert.deepEqual(state, { entry: true, list: true });
});

test('subscribed control uses a bell and dropdown arrow without a state dot', async t => {
  const page = await browserPage(t);
  await page.setContent('<html data-ytg-playback-layout="windowed" data-ytg-language="zh-CN"><body></body></html>');
  await page.addStyleTag({ content: theme });
  await page.evaluate(code);
  await page.evaluate(styles => {
    window.subscriptionActions = [];
    window.view = PlaybackViewFixture.createVueWatchView({ activate(action) { window.subscriptionActions.push(action); }, closePanel() {}, styles: { watch: styles },
      controllerStyle: { badge() {}, hint() {}, bind() {} } });
    window.view.host.hidden = false; window.view.presentation.visible(true);
    window.pageInfo = { key: '/watch?v=first', isWatch: true, title: 'Video', channel: 'Creator', description: '', recommendations: [], subscribed: true, notificationPreference: 'ALL' };
    window.view.presentation.page(window.pageInfo, {});
  }, styles);
  const button = page.locator('#ytg-watch [data-action="subscribe"]');
  assert.equal(await button.textContent().then(text => text.trim()), '已订阅');
  assert.equal(await button.locator('.subscription-bell').count(), 1);
  assert.equal(await button.locator('.subscription-chevron').count(), 1);
  assert.equal(await button.getAttribute('aria-haspopup'), 'dialog');
  assert.equal(await button.getAttribute('aria-pressed'), null);
  assert.equal(await button.evaluate(node => getComputedStyle(node, '::after').content), 'none');
  await button.click();
  assert.deepEqual(await page.evaluate(() => window.subscriptionActions), ['subscribe']);
  mkdirSync(new URL('../output/playwright/', import.meta.url), { recursive: true });
  await button.screenshot({ path: 'output/playwright/subscribed-button.png' });
  await page.evaluate(() => window.view.presentation.page({ ...window.pageInfo, subscribed: false }, {}));
  assert.equal(await button.locator('.subscription-bell, .subscription-chevron').count(), 0);
  assert.equal(await button.textContent().then(text => text.trim()), '订阅');
});
