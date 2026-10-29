import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchExtension, fixture, ready, extensionRoot } from './helpers/extension.mjs';

test('extension reload reattaches to open YouTube tabs without replacing their documents or players', { timeout: 90000 }, async t => {
  const previous = process.env.YTG_EXTENSION_CDP_LOAD;
  process.env.YTG_EXTENSION_CDP_LOAD = '1';
  t.after(() => { if (previous === undefined) delete process.env.YTG_EXTENSION_CDP_LOAD; else process.env.YTG_EXTENSION_CDP_LOAD = previous; });
  const { context, worker } = await launchExtension(t);
  await worker.evaluate(() => chrome.storage.local.set({ enabled: true, autoFullscreen: false }));
  await context.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html',
    body: fixture.replace('</body>', '<div id="movie_player"><video></video></div></body>') }));
  const page = await context.newPage();
  await page.goto('https://www.youtube.com/watch?v=first');
  await ready(page);
  await page.evaluate(() => {
    window.originalDocument = document;
    window.originalVideo = document.querySelector('video');
    window.originalVideo.dataset.retained = 'yes';
    window.originalApp = document.querySelector('#ytg-app-shell');
    window.handoffs = 0;
    document.addEventListener('ytg-extension-handoff', () => window.handoffs++);
  });
  let navigations = 0;
  page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations++; });
  const browser = await context.browser().newBrowserCDPSession();
  for (let i = 0; i < 2; i++) {
    await browser.send('Extensions.loadUnpacked', { path: extensionRoot });
    await page.waitForFunction(count => window.handoffs >= count, i + 1);
    await ready(page);
    await page.waitForFunction(() => !document.documentElement.hasAttribute('data-ytg-boot'));
    assert.deepEqual(await page.evaluate(() => ({ document: document === window.originalDocument,
      video: document.querySelector('video') === window.originalVideo,
      marker: document.querySelector('video').dataset.retained,
      shells: document.querySelectorAll('#ytg-app-shell').length,
      oldShellRemoved: !window.originalApp.isConnected })),
      { document: true, video: true, marker: 'yes', shells: 1, oldShellRemoved: true });
  }
  assert.equal(navigations, 0);
});
