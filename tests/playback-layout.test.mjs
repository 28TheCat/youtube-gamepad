import { build } from 'vite';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { browserPage, settingsPage } from './helpers/bundles.mjs';
import { mainFixture } from './helpers/main-bundle.mjs';

test('settings keep large rows inside a small player and leave windowed recommendations visible', async t => {
  const page = await browserPage(t);
  await page.setViewportSize({ width: 640, height: 480 });
  await page.setContent(`<html class="ytg-watch-layout ytg-watch-active ytg-settings-open" data-ytg-playback-layout="windowed"><body>
    <div id="movie_player"><div class="ytp-settings-menu" style="position:absolute;width:300px;height:350px;bottom:160px;right:25px">
    <div class="ytp-panel-menu"><div class="ytp-menuitem" style="height:40px;font-size:13px">Quality</div><div style="height:400px"></div></div></div></div>
    <div id="ytg-watch" style="position:fixed;inset:56px 0 0;z-index:2147483646"><aside style="position:absolute;right:0;top:0;width:96px;height:200px;background:white">Recommendations</aside></div>
    <div id="yt-gamepad-overlay" style="--ytg-focus-color:black"></div></body></html>`);
  await page.addStyleTag({ content: readFileSync(new URL('../src/app/theater.css', import.meta.url), 'utf8') });
  const geometry = await page.evaluate(() => {
    const player = document.querySelector('#movie_player').getBoundingClientRect();
    const menu = document.querySelector('.ytp-settings-menu').getBoundingClientRect();
    const row = getComputedStyle(document.querySelector('.ytp-menuitem'));
    return { inside: menu.top >= player.top && menu.bottom <= player.bottom && menu.left >= player.left && menu.right <= player.right,
      height: row.height, font: row.fontSize,
      recommendations: getComputedStyle(document.querySelector('#ytg-watch')).visibility,
      sideHit: document.elementFromPoint(630, 80)?.textContent,
      menuHit: !!document.elementFromPoint(menu.left + 20, menu.top + 20)?.closest('.ytp-settings-menu') };
  });
  assert.equal(geometry.inside, true);
  assert.equal(geometry.height, '56px');
  assert.equal(geometry.font, '20px');
  assert.equal(geometry.recommendations, 'visible');
  assert.equal(geometry.sideHit, 'Recommendations');
  assert.equal(geometry.menuHit, true);
});

for (const layout of ['fullscreen', 'windowed']) test(`${layout} keeps its first media frame geometry through preparation and readiness`, async t => {
  const page = await browserPage(t);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.setContent('<html><body style="margin:0"><ytd-watch-flexy style="display:block;margin-left:320px"></ytd-watch-flexy></body></html>');
  await page.addStyleTag({ content: readFileSync(new URL('../src/app/theater.css', import.meta.url), 'utf8') });
  const result = await page.evaluate(async layout => {
    const root = document.documentElement, owner = document.querySelector('ytd-watch-flexy');
    root.dataset.ytgPlaybackLayout = layout;
    const mount = () => {
      const player = document.createElement('div'); player.id = 'movie_player';
      player.style.cssText = 'width:960px;height:540px;background:black'; owner.append(player);
      return player;
    };
    const bounds = player => { const rect = player.getBoundingClientRect(); return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }; };
    const native = mount(), before = bounds(native); native.remove();
    // The destination player may arrive before YouTube changes the URL.
    root.classList.add('ytg-player-primed');
    const player = mount();
    await new Promise(resolve => requestAnimationFrame(resolve));
    const firstFrame = bounds(player);
    root.classList.add('ytg-watch-layout');
    const pending = bounds(player);
    root.classList.remove('ytg-player-primed');
    const playing = bounds(player);
    root.classList.remove('ytg-watch-layout');
    return { before, firstFrame, pending, playing, canceled: bounds(player) };
  }, layout);
  assert.equal(result.before.left, 320, 'native layout reproduces the initial right offset');
  assert.equal(result.firstFrame.left, 0);
  assert.equal(result.firstFrame.top, layout === 'fullscreen' ? 0 : 56);
  const [width, height] = layout === 'fullscreen' ? [1280, 900] : [1088, 612];
  assert.ok(Math.abs(result.firstFrame.width - width) < 0.02);
  assert.ok(Math.abs(result.firstFrame.height - height) < 0.02);
  assert.deepEqual(result.pending, result.firstFrame, 'watch URL handoff keeps the same geometry');
  assert.deepEqual(result.playing, result.firstFrame, 'readiness keeps the first-frame geometry');
  assert.deepEqual(result.canceled, result.before, 'canceling restores native layout');
});

test('windowed media maximizes its area and shares remaining width with the side panel', async t => {
  const page = await browserPage(t);
  await page.setContent('<html class="ytg-watch-layout" data-ytg-playback-layout="windowed"><body><div id="movie_player"></div></body></html>');
  await page.addStyleTag({ content: readFileSync(new URL('../src/app/theater.css', import.meta.url), 'utf8') });
  for (const [width, height] of [[1920, 1080], [1280, 900], [960, 720], [640, 480]]) {
    await page.setViewportSize({ width, height });
    for (const ratio of [16 / 9, 21 / 9, 4 / 3, 9 / 16]) {
      const bounds = await page.evaluate(ratio => {
        document.documentElement.style.setProperty('--ytg-video-ratio', String(ratio));
        const rect = document.querySelector('#movie_player').getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      }, ratio);
      const expectedWidth = Math.min(width * .85, (height - 56 - 96) * ratio);
      assert.ok(Math.abs(bounds.width - expectedWidth) < .1, `maximal video width at ${width}, ratio ${ratio}`);
      assert.ok(Math.abs(bounds.height - bounds.width / ratio) < .1, 'frame matches media without added letterboxing');
      assert.ok(bounds.height + 56 + 96 <= height + .1, 'metadata and controls retain their space');
    }
  }
});

test('settings offer only the two gamepad layouts and retain the saved choice', async t => {
  const page = await settingsPage(t, { hash: '#display' });
  assert.deepEqual(await page.locator('#playbackLayout option').evaluateAll(options => options.map(option => option.value)), ['fullscreen', 'windowed']);
  assert.equal(await page.locator('#playbackLayout').inputValue(), 'fullscreen');
  await page.locator('#playbackLayout').selectOption('windowed');
  await page.waitForFunction(() => window.testStorage.playbackLayout === 'windowed');
  const stored = await page.evaluate(() => ({ ...window.testStorage }));
  const reopened = await settingsPage(t, { hash: '#display', stored });
  assert.equal(await reopened.locator('#playbackLayout').inputValue(), 'windowed');
});

for (const [legacy, expected] of [['normal', 'windowed'], ['wide', 'windowed'], ['page', 'fullscreen']])
  test(`settings migrate the legacy ${legacy} layout to ${expected}`, async t => {
    const page = await settingsPage(t, { hash: '#display', stored: { playbackLayout: legacy } });
    assert.equal(await page.locator('#playbackLayout').inputValue(), expected);
  });

test('mouse and gamepad share custom controls while choosing the correct layout across settings and navigation', { timeout: 45000 }, async t => {
  const page = await browserPage(t);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.addInitScript(() => {
    window.testPad = { connected: false, button: -1 };
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => window.testPad.connected ? [{
      id: 'Test gamepad', connected: true, mapping: 'standard', index: 0, axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, (_, index) => ({ pressed: window.testPad.button === index, value: window.testPad.button === index ? 1 : 0 }))
    }] : [] });
  });
  await page.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html', body: `
    <html><body style="margin:0"><ytd-masthead>Header</ytd-masthead><ytd-watch-flexy style="display:block;margin-left:320px">
    <div id="movie_player" style="width:960px;height:540px;background:#111"><div class="html5-video-container"><video class="html5-main-video"></video></div><div class="ytp-chrome-bottom">
    <button class="ytp-size-button">Theater</button><button class="ytp-play-button">Play</button></div></div>
    <div id="below">Metadata</div><div id="secondary">Recommendations</div></ytd-watch-flexy>
    <script>
    window.nativeSizeClicks = 0;
    const player = document.querySelector('#movie_player'), video = player.querySelector('video');
    Object.defineProperties(video, { paused:{get:()=>false},duration:{get:()=>120},readyState:{get:()=>4},videoWidth:{get:()=>1280} });
    player.getPlayerResponse=()=>({videoDetails:{videoId:new URL(location.href).searchParams.get('v'),title:'Test video'}});
    document.querySelector('.ytp-size-button').onclick=()=>{window.nativeSizeClicks++;document.querySelector('ytd-watch-flexy').toggleAttribute('theater');};
    </script></body></html>` }));
  await page.goto('https://www.youtube.com/watch?v=first');
  for (const file of ['src/ui/theme.css', 'src/app/browse.css', 'src/app/theater.css'])
    await page.addStyleTag({ content: readFileSync(new URL(`../${file}`, import.meta.url), 'utf8') });
  await page.addScriptTag({ content: await mainFixture() });
  const configure = layout => page.evaluate(playbackLayout => window.postMessage({ source: 'yt-gamepad-settings',
    values: { enabled: true, theater: true, playbackLayout } }, location.origin), layout);
  const effective = layout => page.waitForFunction(layout => document.documentElement.dataset.ytgPlaybackLayout === layout, layout);
  const mediaBounds = () => page.locator('#movie_player').evaluate(node => { const r = node.getBoundingClientRect(); return { width: r.width, height: r.height }; });
  await configure('fullscreen');
  await effective('windowed');
  await page.locator('#ytg-watch').waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('ytg-watch-layout')), true);
  assert.equal(await page.locator('.ytp-chrome-bottom').isVisible(), false, 'mouse uses custom gamepad playback controls');
  assert.equal(await page.locator('#below').isVisible(), false);
  assert.ok(Math.abs((await mediaBounds()).width - 1088) < 0.02);
  const banner = page.locator('#ytg-browse-top');
  await banner.waitFor();
  const bannerBounds = await banner.boundingBox();
  const playerBounds = await page.locator('#movie_player').boundingBox();
  const tabsBounds = await page.locator('#ytg-watch .watch-tabs').boundingBox();
  assert.equal(bannerBounds.y, 0);
  assert.equal(bannerBounds.height, 56);
  assert.equal(playerBounds.y, bannerBounds.y + bannerBounds.height, 'windowed video starts below the banner');
  assert.equal(tabsBounds.y, playerBounds.y, 'recommendations start below the same banner');
  assert.equal(tabsBounds.height, bannerBounds.height, 'side tabs match the banner height');
  assert.equal(await page.locator('#ytg-watch .watch-tabs').evaluate(node => getComputedStyle(node).backgroundColor),
    await banner.evaluate(node => getComputedStyle(node).backgroundColor), 'side tabs match the banner background');
  await banner.locator('input').click();
  assert.equal(await banner.locator('input').evaluate(node => node === node.getRootNode().activeElement), true, 'banner search remains reachable');
  await banner.locator('.client-account').click();
  await page.locator('#ytg-account-page').waitFor();
  await page.locator('#ytg-account-page [data-account-close]').click();
  await page.locator('#ytg-account-page').waitFor({ state: 'hidden' });
  await page.evaluate(() => window.YTGamepadCoordinator.setMode('controls'));
  const progress = page.locator('#ytg-watch .progress');
  await progress.waitFor();
  await page.evaluate(() => {
    const clock = Date.now;
    Date.now = () => clock() + 60000;
    try { window.YTGamepadWatch.checkIdle(); } finally { Date.now = clock; }
  });
  assert.equal(await page.evaluate(() => document.documentElement.dataset.ytgMode), 'controls', 'windowed controls remain visible while idle');
  assert.equal(await progress.evaluate(node => getComputedStyle(node).opacity), '1');
  const descriptionColors = await page.locator('#ytg-watch [data-action="description"]').evaluate(node => ({
    text: getComputedStyle(node).color,
    expected: getComputedStyle(node.getRootNode().host).color
  }));
  assert.equal(descriptionColors.text, descriptionColors.expected, 'windowed buttons use readable page-theme text');
  const enterFullscreen = page.locator('#ytg-watch [data-action="fullscreen"]');
  assert.equal(await page.locator('#ytg-watch .transport-group').isVisible(), false);
  await enterFullscreen.click();
  await page.waitForFunction(() => document.fullscreenElement === document.documentElement);
  await effective('fullscreen');
  assert.equal(await enterFullscreen.isVisible(), false);
  await page.mouse.move(300, 200);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.ytgPlaybackLayout), 'fullscreen', 'mouse activity preserves explicitly entered fullscreen');
  const fullBounds = await mediaBounds();
  assert.equal(fullBounds.width, await page.evaluate(() => innerWidth));
  assert.equal(fullBounds.height, await page.evaluate(() => innerHeight));
  await page.evaluate(() => document.exitFullscreen());
  await effective('windowed');
  assert.equal(await enterFullscreen.isVisible(), true);
  assert.equal(await page.locator('#ytg-watch .transport-group').isVisible(), false);
  mkdirSync(new URL('../output/playwright/', import.meta.url), { recursive: true });
  await page.screenshot({ path: fileURLToPath(new URL('../output/playwright/layout-windowed.png', import.meta.url)) });

  await page.bringToFront();
  await page.evaluate(() => { window.testPad.connected = true; });
  await page.waitForFunction(() => window.YTGamepadInput.connected);
  await page.waitForTimeout(80);
  await page.evaluate(() => { window.testPad.button = 12; });
  await page.waitForFunction(() => window.YTGamepadInput.mode === 'gamepad');
  await page.evaluate(() => { window.testPad.button = -1; });
  await effective('fullscreen');
  await banner.waitFor({ state: 'hidden' });
  assert.deepEqual(await mediaBounds(), { width: 1280, height: 900 });
  assert.equal(await page.locator('#ytg-watch').isVisible(), true);
  await page.evaluate(() => window.YTGamepadCoordinator.setMode('controls'));
  await page.screenshot({ path: fileURLToPath(new URL('../output/playwright/layout-fullscreen.png', import.meta.url)) });

  await configure('windowed');
  await effective('windowed');
  await banner.waitFor();
  assert.equal(await page.evaluate(() => window.YTGamepadInput.mode), 'gamepad');
  assert.ok(Math.abs((await mediaBounds()).width - 1088) < 0.02, 'saved windowed layout also applies to gamepad input');
  await page.evaluate(() => { history.pushState({}, '', '/watch?v=second'); document.dispatchEvent(new Event('yt-navigate-finish')); });
  await effective('windowed');
  await page.locator('#ytg-watch').waitFor();
  await banner.waitFor();
  assert.equal(await page.locator('.ytp-chrome-bottom').isVisible(), false);

  await configure('fullscreen');
  await effective('fullscreen');
  await page.mouse.wheel(0, 1);
  await page.waitForFunction(() => window.YTGamepadInput.mode === 'mouse');
  await effective('windowed');
  assert.ok(Math.abs((await mediaBounds()).width - 1088) < 0.02);
  assert.equal(await page.evaluate(() => window.nativeSizeClicks), 0, 'custom layouts never toggle the removed native theater layout');
  await page.evaluate(() => window.postMessage({ source: 'yt-gamepad-settings', values: { enabled: false } }, location.origin));
  await page.waitForFunction(() => !document.documentElement.classList.contains('ytg-watch-layout'));
  await page.locator('#ytg-watch').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('ytd-masthead').isVisible(), true);
  assert.equal(await page.locator('#below').isVisible(), true);
  assert.equal(await page.locator('.ytp-chrome-bottom').isVisible(), true);
  assert.deepEqual(await mediaBounds(), { width: 960, height: 540 });
});


for (const layout of ['windowed', 'fullscreen']) test(`${layout} transition covers native details and releases on destination frame or playing`, async t => {
  const page = await browserPage(t);
  await page.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html', body: '<html><body><div id="movie_player"><video></video></div><div id="below">Native details</div></body></html>' }));
  await page.goto('https://www.youtube.com/watch?v=old');
  await page.addStyleTag({ content: readFileSync(new URL('../src/app/theater.css', import.meta.url), 'utf8') });
  const result = await build({ configFile: false, publicDir: false, logLevel: 'silent',
    build: { write: false, minify: false, lib: { entry: fileURLToPath(new URL('../src/ui/watch-transition.ts', import.meta.url)), formats: ['iife'], name: 'WatchTransitionFixture' } } });
  const source = (Array.isArray(result) ? result[0] : result).output.find(item => item.type === 'chunk').code;
  await page.addScriptTag({ content: source + ';window.makeTransition = WatchTransitionFixture.createWatchTransition;' });
  const geometry = await page.evaluate(layout => {
    document.documentElement.classList.add('ytg-watch-layout');
    document.documentElement.dataset.ytgPlaybackLayout = layout;
    const media = document.querySelector('video');
    for (const [name, value] of Object.entries({ readyState: 2, videoWidth: 640, videoHeight: 360, paused: false }))
      Object.defineProperty(media, name, { configurable: true, value });
    media.requestVideoFrameCallback = fn => { window.destinationFrame = fn; return 1; };
    media.cancelVideoFrameCallback = () => { window.destinationFrame = undefined; };
    window.playerIdentity = 'old';
    window.transition = window.makeTransition(() => window.playerIdentity);
    window.transition.sync(true, '/watch?v=old', false);
    window.transition.sync(true, '/watch?v=new', true);
    const mask = document.querySelector('#ytg-watch-transition').getBoundingClientRect();
    const mediaCover = document.querySelector('#ytg-watch-transition :is(img,canvas):not([hidden])').getBoundingClientRect();
    const player = document.querySelector('#movie_player').getBoundingClientRect();
    history.pushState({}, '', '/watch?v=new'); window.playerIdentity = 'new';
    return { mask: [mask.width, mask.height], media: [mediaCover.x, mediaCover.y, mediaCover.width, mediaCover.height], player: [player.x, player.y, player.width, player.height], viewport: [innerWidth, innerHeight] };
  }, layout);
  assert.deepEqual(geometry.mask, geometry.viewport);
  for (let i = 0; i < 4; i++) assert.ok(Math.abs(geometry.media[i] - geometry.player[i]) < 1);
  await page.waitForFunction(() => !!window.destinationFrame);
  assert.equal(await page.locator('#ytg-watch-transition').count(), 1);
  await page.evaluate(() => window.destinationFrame());
  assert.equal(await page.locator('#ytg-watch-transition').count(), 0);
  await page.evaluate(() => {
    window.transition.sync(true, '/watch?v=third', true);
    history.pushState({}, '', '/watch?v=third'); window.playerIdentity = undefined;
    document.querySelector('video').dispatchEvent(new Event('playing', { bubbles: true }));
  });
  assert.equal(await page.locator('#ytg-watch-transition').count(), 0, 'playing releases cover without waiting on metadata');
  await page.evaluate(() => window.transition.destroy());
});
