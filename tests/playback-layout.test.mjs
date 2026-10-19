import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { browserPage, settingsPage } from './helpers/bundles.mjs';
import { mainFixture } from './helpers/main-bundle.mjs';

test('prepared immersive playback positions a late native player before the watch URL changes', async t => {
  const page = await browserPage(t);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.setContent('<html><body style="margin:0"><ytd-watch-flexy style="display:block;margin-left:320px"></ytd-watch-flexy></body></html>');
  await page.addStyleTag({ content: readFileSync(new URL('../src/app/theater.css', import.meta.url), 'utf8') });
  const result = await page.evaluate(async () => {
    const root = document.documentElement, owner = document.querySelector('ytd-watch-flexy');
    const mount = () => {
      const player = document.createElement('div'); player.id = 'movie_player';
      player.style.cssText = 'width:960px;height:540px;background:black'; owner.append(player);
      return player;
    };
    const bounds = player => { const rect = player.getBoundingClientRect(); return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }; };
    const native = mount(), before = bounds(native); native.remove();
    // PREPARE_VIDEO runs before YouTube inserts the destination player or URL.
    root.classList.add('ytg-player-primed');
    const player = mount();
    await new Promise(resolve => requestAnimationFrame(resolve));
    const firstFrame = bounds(player);
    root.classList.remove('ytg-player-primed'); root.classList.add('ytg-player-pending');
    const pending = bounds(player);
    root.classList.remove('ytg-player-pending');
    return { before, firstFrame, pending, canceled: bounds(player) };
  });
  assert.equal(result.before.left, 320, 'native layout reproduces the initial right offset');
  assert.deepEqual(result.firstFrame, { left: 0, top: 48, width: 1280, height: 852 });
  assert.deepEqual(result.pending, result.firstFrame, 'watch URL handoff keeps the same geometry');
  assert.deepEqual(result.canceled, result.before, 'canceling restores native layout');
});

test('default playback layout saves and survives reopening settings', async t => {
  const page = await settingsPage(t, { hash: '#display' });
  assert.equal(await page.locator('#playbackLayout').inputValue(), 'page');
  await page.locator('#playbackLayout').selectOption('wide');
  await page.waitForFunction(() => window.testStorage.playbackLayout === 'wide');
  await page.evaluate(() => { window.reopenSettings = { ...window.testStorage }; });
  const stored = await page.evaluate(() => window.reopenSettings);
  const reopened = await settingsPage(t, { hash: '#display', stored });
  assert.equal(await reopened.locator('#playbackLayout').inputValue(), 'wide');
});

test('playback layouts switch controls, respect manual changes and apply on SPA navigation', { timeout: 30000 }, async t => {
  const page = await browserPage(t);
  await page.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html', body: `
    <html><body><ytd-masthead>Header</ytd-masthead><ytd-watch-flexy>
    <div id="movie_player"><video class="html5-main-video"></video><div class="ytp-chrome-bottom">
    <button class="ytp-size-button">Theater</button><button class="ytp-play-button">Play</button></div></div>
    <div id="below">Metadata</div><div id="secondary">Recommendations</div></ytd-watch-flexy>
    <script>
    const player = document.querySelector('#movie_player'), video = player.querySelector('video');
    Object.defineProperties(video, { paused:{get:()=>false},duration:{get:()=>120},readyState:{get:()=>4},videoWidth:{get:()=>1280} });
    player.getPlayerResponse=()=>({videoDetails:{videoId:new URL(location.href).searchParams.get('v'),title:'Test video'}});
    document.querySelector('.ytp-size-button').onclick=()=>document.querySelector('ytd-watch-flexy').toggleAttribute('theater');
    </script></body></html>` }));
  await page.goto('https://www.youtube.com/watch?v=first');
  for (const file of ['src/ui/theme.css', 'src/app/browse.css', 'src/app/theater.css'])
    await page.addStyleTag({ content: readFileSync(new URL(`../${file}`, import.meta.url), 'utf8') });
  await page.addScriptTag({ content: await mainFixture() });
  const configure = layout => page.evaluate(playbackLayout => window.postMessage({ source: 'yt-gamepad-settings',
    values: { enabled: true, theater: true, playbackLayout } }, location.origin), layout);
  await configure('wide');
  await page.waitForFunction(() => document.querySelector('ytd-watch-flexy').hasAttribute('theater'));
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('ytg-watch-layout')), false);
  assert.equal(await page.locator('#ytg-watch').isVisible(), false);
  assert.equal(await page.locator('#below').isVisible(), true);
  assert.equal(await page.locator('.ytp-chrome-bottom').isVisible(), true);
  await page.locator('#ytg-browse-top').waitFor();
  assert.equal(await page.locator('ytd-masthead').isVisible(), false, 'wide playback uses the shared custom banner');
  assert.equal(await page.locator('[data-ytg-browse-grid]').isVisible(), false, 'only the banner is shown over the watch page');
  // The native controls must still be reachable from the gamepad action path.
  await page.evaluate(() => window.YTGamepad.act('up'));
  assert.equal(await page.evaluate(() => document.documentElement.dataset.ytgMode), 'controls');

  // A default is applied once per route; it must not fight a manual mode change.
  await page.locator('.ytp-size-button').click();
  await page.evaluate(() => window.YTGamepadCoordinator.checkAdaptation());
  assert.equal(await page.locator('ytd-watch-flexy').getAttribute('theater'), null);
  await page.evaluate(() => { history.pushState({}, '', '/watch?v=second'); document.dispatchEvent(new Event('yt-navigate-finish')); });
  await page.waitForFunction(() => document.querySelector('ytd-watch-flexy').hasAttribute('theater'));
  assert.equal(await page.locator('#ytg-browse-top').isVisible(), true, 'SPA video navigation keeps the custom banner');

  await configure('page');
  await page.waitForFunction(() => document.documentElement.classList.contains('ytg-watch-layout'));
  await page.locator('#ytg-browse-top').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('#below').evaluate(node => { const style = getComputedStyle(node); return style.display === 'none' || style.opacity === '0'; }), true);
  await configure('normal');
  await page.waitForFunction(() => !document.documentElement.classList.contains('ytg-watch-layout') && !document.querySelector('ytd-watch-flexy').hasAttribute('theater'));
  await page.locator('#ytg-browse-top').waitFor();
  assert.equal(await page.locator('ytd-masthead').isVisible(), false, 'normal playback uses the shared custom banner');
  assert.equal(await page.locator('#below').isVisible(), true);
  assert.equal(await page.locator('#below').evaluate(node => getComputedStyle(node).opacity), '1');
  assert.equal(await page.locator('.ytp-chrome-bottom').isVisible(), true);
  await page.evaluate(() => { window.lateSizeButton = document.querySelector('.ytp-size-button'); window.lateSizeButton.remove(); });
  await configure('wide');
  await page.evaluate(() => document.querySelector('#movie_player').append(window.lateSizeButton));
  await page.waitForFunction(() => document.querySelector('ytd-watch-flexy').hasAttribute('theater'));
  await page.evaluate(() => window.postMessage({ source: 'yt-gamepad-settings', values: { enabled: false, playbackLayout: 'wide' } }, location.origin));
  await page.waitForFunction(() => !document.querySelector('ytd-watch-flexy').hasAttribute('theater'));
  await page.locator('#ytg-browse-top').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('ytd-masthead').isVisible(), true, 'disabling the extension restores the native banner');
});
