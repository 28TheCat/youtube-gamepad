import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchExtension, ready, virtualPad } from './helpers/extension.mjs';

async function observeSettings(page) {
  await page.addInitScript(() => {
    window.liveSettings = null;
    window.addEventListener('message', event => {
      if (event.source === window && event.origin === location.origin && event.data?.source === 'yt-gamepad-settings') {
        window.liveSettings = event.data.values;
      }
    });
  });
}

test('live YouTube retains storage bridge after refresh and stays inactive without a controller', { timeout: 90000 }, async t => {
  const { context, options } = await launchExtension(t);
  const page = await context.newPage();
  // No routing, fixture, addScriptTag or virtual controller in live smoke.
  // Observe the real storage bridge on every document, including after refresh.
  await observeSettings(page);
  await page.goto('https://www.youtube.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.locator('ytd-app').waitFor({ timeout: 20000 });
  await ready(page);
  assert.equal(await page.locator('#yt-gamepad-overlay').count(), 1);
  assert.equal(await page.evaluate(() => window.__testConnected), false);
  await options.locator('#enabled').uncheck();
  await page.waitForFunction(() => window.liveSettings?.enabled === false);
  await page.waitForFunction(() => document.documentElement.dataset.ytgAdaptation === 'inactive');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await ready(page);
  await page.waitForFunction(() => window.liveSettings?.enabled === false);
  await page.waitForFunction(() => document.documentElement.dataset.ytgAdaptation === 'inactive');
  await options.locator('#enabled').check();
  await page.waitForFunction(() => window.liveSettings?.enabled === true);
  assert.deepEqual(await page.evaluate(() => ({
    connected: window.__testConnected,
    enabled: (document.documentElement.dataset.ytgAdaptation === 'ready')
  })), { connected: false, enabled: false });
  await page.screenshot({ path: 'output/playwright/youtube-live.png', fullPage: true });
});

test('live Shorts navigate and return with native playback availability diagnostics', { timeout: 90000 }, async t => {
  const { context, worker } = await launchExtension(t);
  await worker.evaluate(() => chrome.storage.local.set({ enabled: true, autoFullscreen: false }));
  const page = await context.newPage();
  // Only the physical controller is simulated; page, player and requests are live.
  const diagnose = async () => {
    if (!page.isClosed()) {
      t.diagnostic(await page.evaluate(() => JSON.stringify({ route: location.pathname, title: document.title,
        reels: [...document.querySelectorAll('ytd-reel-video-renderer')].map(reel => ({ active: reel.getAttribute('is-active'), top: reel.getBoundingClientRect().top, video: !!reel.querySelector('video') })),
        playerMessage: [...document.querySelectorAll('.ytp-error-content-wrap,.ytp-error-content-wrap-reason')].map(node => node.textContent),
        videos: [...document.querySelectorAll('video')].map(video => ({ paused: video.paused, duration: Number.isFinite(video.duration) ? video.duration : null, readyState: video.readyState })) })));
      await page.screenshot({ path: 'output/playwright/shorts-live.png' }).catch(() => {});
    }
  };
  try {
  await page.goto('https://www.youtube.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.goto('https://www.youtube.com/shorts/JnICtQ9VHJ8', { waitUntil: 'domcontentloaded', timeout: 30000 });
  const toolbar = page.locator('#ytg-shorts-controls');
  await toolbar.waitFor({ state: 'visible', timeout: 15000 });
  const playbackStatus = async () => {
    await page.waitForFunction(() => {
      const video = document.querySelector('ytd-reel-video-renderer[is-active] video') || document.querySelector('ytd-reel-video-renderer video');
      return video?.readyState >= 2 || document.querySelector('.ytp-error-content-wrap-reason')?.textContent?.trim();
    }, undefined, { timeout: 20000 });
    return page.evaluate(() => ({ error: document.querySelector('.ytp-error-content-wrap-reason')?.textContent?.trim() || '',
      ready: (document.querySelector('ytd-reel-video-renderer[is-active] video') || document.querySelector('ytd-reel-video-renderer video'))?.readyState >= 2 }));
  };
  const adapted = await playbackStatus();
  if (!adapted.ready) {
    await worker.evaluate(() => chrome.storage.local.set({ enabled: false }));
    await page.reload({ waitUntil: 'domcontentloaded' });
    const native = await playbackStatus();
    await page.screenshot({ path: 'output/playwright/shorts-live-native.png' });
    t.diagnostic(`Playback comparison: ${JSON.stringify({ withExtension: adapted, withoutExtension: native })}`);
    assert.equal(native.ready, false, 'a native-only playable video indicates an adaptation regression');
    assert.equal(native.error, adapted.error, 'native and adapted playback report the same unavailable-video error');
    await worker.evaluate(() => chrome.storage.local.set({ enabled: true }));
    await toolbar.waitFor({ state: 'visible' });
  }
  // Establish trusted activation for browsers that block audible autoplay.
  if (adapted.ready) await page.locator('ytd-reel-video-renderer video').first().click({ force: true });
  const pad = await virtualPad(context, page);
  await page.bringToFront(); await pad({ connected: true }); await page.waitForTimeout(200);
  const press = async button => { await pad({ connected: true, button }); await page.waitForTimeout(150); await pad({ connected: true }); await page.waitForTimeout(150); };
  if (adapted.ready) {
  const paused = () => page.evaluate(() => (document.querySelector('ytd-reel-video-renderer[is-active] video') || document.querySelector('ytd-reel-video-renderer video'))?.paused);
  if (await paused()) await press(0);
  assert.equal(await paused(), false);
  await press(0);
  assert.equal(await paused(), true);
  await press(2);
  assert.equal(await paused(), false);
  } else t.diagnostic('Live pause/resume is unverified because native YouTube also cannot play this video.');
  await press(13);
  await page.waitForURL(url => url.pathname.startsWith('/shorts/') && url.pathname !== '/shorts/JnICtQ9VHJ8', { timeout: 15000 });
  // Back can replace the document, so do not write a neutral pad into its old world.
  await pad({ connected: true, button: 1 });
  await page.waitForURL('https://www.youtube.com/', { timeout: 15000 });
  await toolbar.waitFor({ state: 'hidden' });
  } finally { await diagnose(); }
});
