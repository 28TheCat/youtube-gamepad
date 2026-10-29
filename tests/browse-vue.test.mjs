import { test } from 'node:test';
import assert from 'node:assert/strict';
import { browserPage } from './helpers/bundles.mjs';
import { mainFixture } from './helpers/main-bundle.mjs';
import { mkdirSync, readFileSync } from 'node:fs';
import { modernVideo } from './helpers/modern-video.mjs';
import { guideData } from './helpers/sidebar-data.mjs';

test('channel page renders API profile inside the scrollable video feed', { timeout: 30000 }, async t => {
  const page = await browserPage(t);
  await page.route('https://www.youtube.com/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/resolve_url')) return route.fulfill({ json: { endpoint: { browseEndpoint: { browseId: 'UCcreator' } } } });
    if (url.pathname.includes('/youtubei/')) return route.fulfill({ json: {
      header: { c4TabbedHeaderRenderer: { title: '王志安',
        avatar: { thumbnails: [{ url: 'https://example.com/avatar.png' }] },
        banner: { thumbnails: [{ url: 'https://example.com/banner.png' }] },
        subscriberCountText: { simpleText: '100万位订阅者' } } },
      contents: { twoColumnBrowseResultsRenderer: { tabs: [{ tabRenderer: { title: '视频', selected: true,
        endpoint: { browseEndpoint: { browseId: 'UCcreator' } },
        content: { richGridRenderer: { contents: [{ videoRenderer: { videoId: 'channel1234', title: { simpleText: '频道视频' } } }] } }
      } }] } }
    } });
    return route.fulfill({ contentType: 'text/html', body: '<html><body><ytd-page-manager></ytd-page-manager></body></html>' });
  });
  await page.route('https://example.com/**', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="200"><rect width="1200" height="200" fill="#738b96"/></svg>' }));
  await page.goto('https://www.youtube.com/@wangzhian');
  await page.evaluate(() => { window.ytcfg = { get: key => key === 'INNERTUBE_CONTEXT' ? { client: { clientName: 'WEB', clientVersion: 'test' } } : undefined }; });
  await mainBundle(page);
  const header = page.locator('[data-ytg-channel-header]');
  await header.waitFor();
  assert.equal(await header.locator('h1').innerText(), '王志安');
  assert.match(await header.innerText(), /100万/);
  await page.locator('[data-browse-id="video:channel1234"]').waitFor();
  assert.equal(await header.locator('.channel-avatar').evaluate(node => getComputedStyle(node).borderRadius), '50%');
  const avatar = header.locator('.channel-avatar');
  assert.equal(await avatar.evaluate(node => getComputedStyle(node).width), '128px');
  await avatar.locator('img').dispatchEvent('error');
  assert.equal(await avatar.locator('[data-view="avatarFallback"]').innerText(), '王');
  assert.equal(await avatar.locator('img').count(), 0);
  await page.setViewportSize({ width: 600, height: 900 });
  assert.equal(await avatar.evaluate(node => getComputedStyle(node).width), '72px');
  mkdirSync('output/playwright', { recursive: true });
  await page.screenshot({ path: 'output/playwright/channel-page.png' });
});

test('subscribed people stay beside videos and switch channels through the API', { timeout: 30000 }, async t => {
  const page = await browserPage(t);
  const guide = guideData();
  const person = guide.items[3].guideSubscriptionsSectionRenderer.items[0].guideEntryRenderer;
  person.navigationEndpoint.browseEndpoint.browseId = 'UCsubscriber';
  person.thumbnail = { thumbnails: [{ url: 'https://yt3.ggpht.com/broken-avatar', width: 40, height: 40 }] };
  const requests = [];
  await page.route('https://yt3.ggpht.com/**', route => route.abort());
  await page.route('https://www.youtube.com/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname.includes('/youtubei/')) {
      const body = route.request().postDataJSON(); requests.push({ path: url.pathname, body });
      if (url.pathname.endsWith('/resolve_url')) return route.fulfill({ json: { endpoint: {
        browseEndpoint: { browseId: 'UCsubscriber', params: 'api-videos-tab' }
      } } });
      if (body.browseId === 'UCsubscriber') return route.fulfill({ json: {
        contents: { twoColumnBrowseResultsRenderer: { tabs: [{ tabRenderer: { title: 'Videos', selected: true,
          endpoint: { browseEndpoint: { browseId: 'UCsubscriber', params: 'api-videos-tab' } },
          content: { richGridRenderer: { contents: [{ videoRenderer: { videoId: 'creator1234', title: { simpleText: 'Creator video' } } }] } }
        } }] } }
      } });
      return route.fulfill({ json: { contents: [{ videoRenderer: {
        videoId: 'subscriptions123', title: { simpleText: 'All subscriptions' }
      } }] } });
    }
    return route.fulfill({ contentType: 'text/html', body: '<html><body><ytd-app></ytd-app><ytd-page-manager></ytd-page-manager></body></html>' });
  });
  await page.goto('https://www.youtube.com/feed/subscriptions');
  await page.evaluate(() => {
    window.ytcfg = { get: key => key === 'INNERTUBE_CONTEXT' ? { client: { clientName: 'WEB', clientVersion: 'test' } } : undefined };
    document.querySelector('ytd-app').navigate_ = endpoint => {
      document.dispatchEvent(new Event('yt-navigate-start'));
      history.pushState({}, '', endpoint.commandMetadata.webCommandMetadata.url);
      document.dispatchEvent(new Event('yt-navigate-finish'));
    };
  });
  await mainBundle(page, guide);
  const channel = page.locator('[data-subscription-id="UCsubscriber"]');
  await channel.waitFor();
  await page.locator('[data-browse-id="video:subscriptions123"]').waitFor();
  await page.waitForFunction(() => {
    const sidebar = window.__pageDOM.querySelector('#ytg-subscription-channels');
    return Math.abs(sidebar.getBoundingClientRect().width - 270) < 1;
  });
  await channel.locator('[data-view="avatarFallback"]').waitFor();
  await channel.click();
  await page.locator('[data-browse-id="video:creator1234"]').waitFor();
  assert.equal(new URL(page.url()).pathname, '/channel/UCsubscriber/videos');
  assert.equal(await channel.getAttribute('aria-current'), 'page');
  assert.ok(requests.some(request => request.body.browseId === 'UCsubscriber' && request.body.params === 'api-videos-tab'));
  mkdirSync('output/playwright', { recursive: true });
  await page.screenshot({ path: 'output/playwright/subscribed-people.png' });
  await page.locator('[data-sidebar-id="subscriptions"]').click();
  await page.locator('[data-browse-id="video:subscriptions123"]').waitFor();
  assert.equal(await channel.getAttribute('aria-current'), null);
  await page.setViewportSize({ width: 500, height: 800 });
  await page.locator('[data-browse-id="video:subscriptions123"]').focus();
  await page.mouse.move(450, 500);
  await page.waitForFunction(() => window.__pageDOM.querySelector('#ytg-browse-sidebar').getBoundingClientRect().width < 100);
});

test('channel badges use Material icons and retain identity across the feed bridge', async t => {
  const items = ['verified', 'artist', 'none'].map(id => modernVideo(id));
  for (const [index, imageName] of [[0, 'CHECK_CIRCLE_FILLED'], [1, 'OFFICIAL_ARTIST_BADGE']]) {
    const text = items[index].lockupViewModel.metadata.lockupMetadataViewModel.metadata.contentMetadataViewModel.metadataRows[0].metadataParts[0].text;
    text.attachmentRuns = [{ startIndex: text.content.length, length: 0, element: { type: { imageType: {
      image: { sources: [{ clientResource: { imageName } }] }
    } } } }];
  }
  const page = await browserPage(t);
  await page.route('https://www.youtube.com/**', route => route.request().url().includes('/youtubei/')
    ? route.fulfill({ json: { contents: items } })
    : route.fulfill({ contentType: 'text/html', body: '<html><body><ytd-page-manager></ytd-page-manager></body></html>' }));
  await page.goto('https://www.youtube.com/');
  await page.evaluate(() => { window.ytcfg = { get: key => key === 'INNERTUBE_CONTEXT' ? { client: { clientVersion: 'test' } } : undefined }; });
  await mainBundle(page);
  for (const badge of ['verified', 'artist']) {
    const icon = page.locator(`[data-browse-id="video:${badge}"] .channel-badge svg`);
    await icon.waitFor();
    assert.equal(await icon.getAttribute('data-icon'), `material:${badge}-fill`);
    assert.equal(await icon.evaluate(node => getComputedStyle(node).width), '14px');
  }
  assert.equal(await page.locator('[data-browse-id="video:none"] .channel-badge').count(), 0);
});

test('mouse card previews use native animated thumbnails across the feed bridge and stop on input changes', { timeout: 45000 }, async t => {
  const page = await browserPage(t);
  let previews = 0, failPreviews = false, embeds = 0;
  const previewUrl = id => 'https://i.ytimg.com/an_webp/' + id + '/mqdefault_6s.webp?signed=keep-me';
  await page.route('https://i.ytimg.com/**', route => {
    if (route.request().url().includes('/an_webp/')) {
      previews++;
      if (failPreviews) return route.abort();
    }
    return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="green"/></svg>' });
  });
  const modern = modernVideo('dQw4w9WgXcQ');
  modern.lockupViewModel.contentImage.thumbnailViewModel.overlays.push({ animatedThumbnailOverlayViewModel: {
    thumbnail: { sources: [{ url: previewUrl('dQw4w9WgXcQ'), width: 320, height: 180 }] }
  } });
  await page.route('https://www.youtube.com/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/embed/')) embeds++;
    return route.fulfill(url.pathname.includes('/youtubei/') ? { json: { contents: [{ videoRenderer: {
      videoId: 'M7lc1UVf-VE', title: { simpleText: 'Native moving thumbnail' },
      richThumbnail: { movingThumbnailRenderer: { movingThumbnailDetails: { thumbnails: [
        { url: previewUrl('M7lc1UVf-VE'), width: 320, height: 180 }
      ] } } }
    } }, modern, { videoRenderer: { videoId: 'no-preview1', title: { simpleText: 'Without preview' } } },
    { videoRenderer: { videoId: 'failpreview', title: { simpleText: 'Broken preview' }, richThumbnail: {
      movingThumbnailRenderer: { movingThumbnailDetails: { thumbnails: [{ url: previewUrl('failpreview'), width: 320, height: 180 }] } }
    } } }] } }
      : { contentType: 'text/html', body: '<html><body><ytd-page-manager></ytd-page-manager></body></html>' });
  });
  await page.goto('https://www.youtube.com/');
  await page.evaluate(() => { window.ytcfg = { get: () => ({ client: { clientName: 'WEB', clientVersion: 'test' } }) }; });
  await mainBundle(page);
  const card = page.locator('[data-browse-id="video:M7lc1UVf-VE"]');
  const second = page.locator('[data-browse-id="video:dQw4w9WgXcQ"]');
  const preview = page.locator('.card-video-preview');
  await card.waitFor();
  const mode = value => page.evaluate(value => {
    document.documentElement.dataset.ytgInputMode = value;
    window.dispatchEvent(new CustomEvent('yt-gamepad-input-mode', { detail: { mode: value } }));
  }, value);
  const enter = node => node.dispatchEvent('pointerenter', { pointerType: 'mouse' });
  await mode('mouse'); await enter(card);
  await page.waitForTimeout(150);
  assert.equal(await preview.count(), 0, 'brief hover does not load a preview');
  await mode('gamepad');
  await page.waitForTimeout(700);
  assert.equal(previews, 0, 'gamepad cancels the pending preview');
  await card.focus(); await enter(card);
  await page.waitForTimeout(700);
  assert.equal(await preview.count(), 0, 'gamepad focus never starts preview');
  await mode('mouse');
  await card.hover();
  await card.locator('img.card-video-preview.ready').waitFor();
  assert.equal(await preview.getAttribute('src'), previewUrl('M7lc1UVf-VE'));
  const geometry = await card.locator('.card-cover').evaluate(node => {
    const cover = node.getBoundingClientRect(), preview = node.querySelector('.card-video-preview').getBoundingClientRect();
    return { width: Math.abs(cover.width - preview.width), height: Math.abs(cover.height - preview.height), pointerEvents: getComputedStyle(node.querySelector('.card-video-preview')).pointerEvents };
  });
  assert.ok(geometry.width < 1 && geometry.height < 1, 'preview fits the original cover');
  assert.equal(geometry.pointerEvents, 'none', 'clicks continue to reach the video card');
  await page.mouse.move(1, 1);
  await mode('gamepad');
  assert.equal(await preview.count(), 0, 'gamepad takeover removes the preview');
  await mode('mouse'); await enter(card); await preview.waitFor();
  await enter(second);
  assert.equal(await preview.count(), 0, 'moving to another card stops the previous preview');
  await second.locator('img.card-video-preview.ready').waitFor();
  assert.equal(await preview.count(), 1);
  assert.equal(await preview.getAttribute('src'), previewUrl('dQw4w9WgXcQ'), 'modern animated thumbnail survives the bridge');
  await second.dispatchEvent('pointerleave', { pointerType: 'mouse' });
  assert.equal(await preview.count(), 0);
  await enter(card); await preview.waitFor();
  await card.evaluate(node => node.getRootNode().querySelector('[data-ytg-browse-grid]').dispatchEvent(new Event('scroll')));
  assert.equal(await preview.count(), 0);
  await enter(card); await preview.waitFor();
  await page.evaluate(() => document.dispatchEvent(new Event('yt-navigate-start')));
  assert.equal(await preview.count(), 0, 'real document navigation stops preview');
  await enter(page.locator('[data-browse-id="video:no-preview1"]'));
  await page.waitForTimeout(700);
  assert.equal(await preview.count(), 0, 'missing preview keeps the cover');
  failPreviews = true;
  const failedCard = page.locator('[data-browse-id="video:failpreview"]');
  const failedRequest = page.waitForRequest('**/an_webp/**');
  await enter(failedCard); await failedRequest;
  await preview.waitFor({ state: 'detached' });
  const beforeRetry = previews;
  await failedCard.dispatchEvent('pointermove', { pointerType: 'mouse' });
  await page.waitForTimeout(700);
  assert.equal(previews, beforeRetry, 'failure does not retry on every mouse movement');
  assert.equal(embeds, 0, 'previews never request the blocked embedded player');
});

test('video cards size their content and hover surface independently while keeping rows aligned and creator avatars visible', { timeout: 30000 }, async t => {
  const items = Array.from({ length: 6 }, (_, i) => {
    const item = modernVideo(`content-height-${i}`);
    item.lockupViewModel.metadata.lockupMetadataViewModel.title.content = i === 1
      ? 'A long video title that wraps over two lines and is truncated if it continues further'.repeat(3) : 'Short title';
    return item;
  });
  items[0] = { videoRenderer: { videoId: 'content-height-0', title: { simpleText: 'Short title' },
    ownerText: { runs: [{ text: 'Creator', navigationEndpoint: { browseEndpoint: { browseId: 'UCcreator' } } }] },
    channelThumbnailSupportedRenderers: { channelThumbnailWithLinkRenderer: {
      thumbnail: { thumbnails: [{ url: 'https://yt3.ggpht.com/creator=s88', width: 88, height: 88 }] }
    } }, viewCountText: { simpleText: '1,000 views' }, publishedTimeText: { simpleText: '1 day ago' },
    navigationEndpoint: { watchEndpoint: { videoId: 'content-height-0' } } } };
  const page = await browserPage(t);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('https://i.ytimg.com/**', route => route.fulfill({ contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270"><rect width="480" height="270" fill="#39435b"/></svg>' }));
  await page.route('https://yt3.ggpht.com/**', route => route.fulfill({ contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="88" height="88"><rect width="88" height="88" fill="#754bb8"/></svg>' }));
  await page.route('https://www.youtube.com/**', route => route.request().url().includes('/youtubei/')
    ? route.fulfill({ json: { contents: items } })
    : route.fulfill({ contentType: 'text/html', body: '<html><body><ytd-page-manager></ytd-page-manager></body></html>' }));
  await page.goto('https://www.youtube.com/');
  await page.evaluate(() => { window.ytcfg = { get: key => key === 'INNERTUBE_CONTEXT' ? { client: { clientVersion: 'test' } } : undefined }; });
  await mainBundle(page);
  const cards = page.locator('[data-browse-id^="video:content-height-"]');
  await cards.nth(5).waitFor();
  await page.waitForFunction(() => [...window.__pageDOM.querySelectorAll('.card-channel-avatar img')].length === 6);
  const geometry = () => cards.evaluateAll(nodes => nodes.map(node => {
    const bounds = node.getBoundingClientRect(), title = node.querySelector('strong').getBoundingClientRect();
    return { top: bounds.top, height: bounds.height, titleHeight: title.height,
      channelTop: node.querySelector('.channel').getBoundingClientRect().top };
  }));
  const before = await geometry();
  assert.ok(Math.abs(before[0].titleHeight - 22) < .1);
  assert.ok(Math.abs(before[1].titleHeight - 44) < .1);
  assert.ok(Math.abs(before[1].channelTop - before[0].channelTop - 22) < .1);
  assert.ok(Math.abs(before[1].height - before[2].height - 22) < .1);
  assert.equal(before[3].top, before[4].top);
  assert.equal(before[4].top, before[5].top);
  for (const index of [0, 1]) {
    assert.equal(await cards.nth(index).locator('.card-channel-avatar img').getAttribute('src'), 'https://yt3.ggpht.com/creator=s88');
  }
  await cards.nth(2).hover();
  await page.evaluate(() => document.documentElement.setAttribute('data-ytg-input-mode', 'mouse'));
  const hover = await cards.nth(2).evaluate(node => {
    const style = getComputedStyle(node, '::after');
    return { opacity: style.opacity, height: parseFloat(style.height), shadow: style.boxShadow };
  });
  assert.equal(hover.opacity, '1');
  assert.ok(Math.abs(hover.height - before[2].height) < .1);
  assert.notEqual(hover.shadow, 'none');
  assert.deepEqual(await geometry(), before, 'hover must not move card contents or the next row');
  mkdirSync('output/playwright', { recursive: true });
  await page.screenshot({ path: 'output/playwright/video-card-content-height.png', animations: 'disabled' });
});

test('modern video cards show creator avatars, view counts, publication time and duration across the feed bridge', { timeout: 30000 }, async t => {
  const inlineCard = modernVideo('metadata-one', 45);
  const inlineMetadata = inlineCard.lockupViewModel.metadata.lockupMetadataViewModel.metadata.contentMetadataViewModel;
  inlineMetadata.metadataRows = [{ metadataParts: inlineMetadata.metadataRows.flatMap(row => row.metadataParts) }];
  const channelCard = modernVideo('metadata-two');
  channelCard.lockupViewModel.metadata.lockupMetadataViewModel.metadata.contentMetadataViewModel.metadataRows.shift();
  const page = await browserPage(t);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('https://i.ytimg.com/**', route => route.fulfill({ contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270"><rect width="480" height="270" fill="#39435b"/><path d="m205 92 80 44-80 44Z" fill="white"/></svg>' }));
  await page.route('https://yt3.ggpht.com/**', route => route.fulfill({ contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="88" height="88"><rect width="88" height="88" fill="#754bb8"/><circle cx="44" cy="32" r="16" fill="white"/><ellipse cx="44" cy="81" rx="29" ry="28" fill="white"/></svg>' }));
  await page.route('https://www.youtube.com/**', route => route.request().url().includes('/youtubei/')
    ? route.fulfill({ json: { contents: [inlineCard, channelCard] } })
    : route.fulfill({ contentType: 'text/html', body: '<html><body><ytd-page-manager></ytd-page-manager></body></html>' }));
  await page.goto('https://www.youtube.com/');
  await page.evaluate(() => { window.ytcfg = { get: key => key === 'INNERTUBE_CONTEXT' ? { client: { clientVersion: 'test' } } : undefined }; });
  await mainBundle(page);
  const card = page.locator('[data-browse-id="video:metadata-one"]');
  await card.waitFor();
  assert.equal(await card.locator('.card-channel-avatar img').getAttribute('src'), 'https://yt3.ggpht.com/creator=s88');
  assert.equal(await card.locator('.channel').textContent(), 'JaidenAnimations');
  assert.equal(await card.locator('.channel .view-count-icon').count(), 0);
  assert.equal(await card.locator('.card-view-count').textContent(), '1694万次观看');
  assert.equal(await card.locator('.card-view-count .view-count-icon').count(), 1);
  assert.equal(await card.locator('.card-stats').textContent(), '1694万次观看 9年前');
  assert.equal(await card.locator('.card-duration').textContent(), '8:47');
  assert.equal(await card.locator('.card-watch-progress>span').evaluate(node => node.style.width), '45%');
  assert.equal(await card.locator('.card-watch-progress>span').evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(255, 0, 51)');
  const channel = page.locator('[data-browse-id="video:metadata-two"]');
  assert.equal(await channel.locator('.card-watch-progress').count(), 0);
  assert.equal(await channel.locator('.card-stats').textContent(), '1694万次观看 9年前');
  assert.equal(await channel.locator('.channel').textContent(), '');
  mkdirSync('output/playwright', { recursive: true });
  await card.screenshot({ path: 'output/playwright/video-card-metadata.png', animations: 'disabled' });
  await card.locator('.card-channel-avatar img').dispatchEvent('error');
  assert.equal(await card.locator('.card-channel-avatar').textContent(), 'J');
  await page.setViewportSize({ width: 480, height: 820 });
  await page.evaluate(() => window.postMessage({ source: 'yt-gamepad-settings', values: { gridLayout: 'oneColumn' } }, location.origin));
  await page.locator('.cards[data-horizontal=true]').waitFor();
  assert.equal(await card.locator('.card-stats').isVisible(), true);
  assert.equal(await card.evaluate(el => el.scrollWidth <= el.clientWidth), true);
});

test('browse resize and unrelated page classes do not reinitialize data or restore focus', { timeout: 30000 }, async t => {
  const page = await browserPage(t);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.route('https://www.youtube.com/**', route => route.request().url().includes('/youtubei/')
    ? route.fulfill({ json: { contents: Array.from({ length: 60 }, (_, i) => ({ videoRenderer: {
      videoId: `refresh${i}`, title: { simpleText: `Refresh ${i}` }
    } })) } })
    : route.fulfill({ contentType: 'text/html', body: '<html><body><ytd-page-manager></ytd-page-manager></body></html>' }));
  await page.goto('https://www.youtube.com/');
  await page.evaluate(() => { window.ytcfg = { get: key => key === 'INNERTUBE_CONTEXT' ? { client: { clientVersion: 'test' } } : undefined }; });
  await mainBundle(page);
  await page.locator('[data-browse-id="video:refresh0"]').waitFor();
  await page.waitForTimeout(250);
  await page.evaluate(() => {
    window.surfaceCounts = { categories: 0, headerReads: 0, focus: 0, refresh: 0 };
    document.addEventListener('ytg-page-request-v1', event => {
      if (JSON.parse(event.detail).operation === 'readBrowseCategories') window.surfaceCounts.categories++;
    });
    const rect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function () {
      if (this.id === 'ytg-browse-top') window.surfaceCounts.headerReads++;
      return rect.call(this);
    };
    for (const operation of ['focus', 'refresh']) {
      const original = window.YTGamepad[operation];
      window.YTGamepad[operation] = function (...args) { window.surfaceCounts[operation]++; return original.apply(this, args); };
    }
    document.documentElement.classList.add('unrelated-page-state');
  });
  await page.waitForTimeout(250);
  assert.deepEqual(await page.evaluate(() => window.surfaceCounts), { categories: 0, headerReads: 0, focus: 0, refresh: 0 });
  await page.evaluate(() => { for (let i = 0; i < 20; i++) window.dispatchEvent(new Event('resize')); });
  await page.waitForTimeout(200);
  const resized = await page.evaluate(() => window.surfaceCounts);
  assert.equal(resized.categories, 0);
  assert.equal(resized.focus, 0);
  assert.equal(resized.refresh, 0);
  assert.equal(resized.headerReads, 1, 'a burst of resize events shares one header measurement');
  // Header geometry changes still update the grid inset without touching data/focus.
  const before = await page.locator('#ytg-browse-grid').evaluate(node => parseFloat(node.style.getPropertyValue('--ytg-browse-top')));
  await page.locator('#ytg-browse-top').evaluate(node => { node.style.height = '100px'; });
  await page.waitForFunction(before => parseFloat(window.__pageDOM.querySelector('#ytg-browse-grid').style.getPropertyValue('--ytg-browse-top')) > before, before);
  assert.equal(await page.evaluate(() => window.surfaceCounts.categories), 0);
  assert.equal(await page.evaluate(() => window.surfaceCounts.focus), 0);
  // Disposal must stop layout scheduling as well as data/focus work.
  await page.evaluate(() => { window.YTGamepadRuntime.destroy(); window.surfaceCounts.headerReads = 0; window.dispatchEvent(new Event('resize')); });
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => window.surfaceCounts.headerReads), 0);
});

for (const size of [60, 400]) {
  test(`indexed feed navigation avoids peer measurements with ${size} cards`, { timeout: 30000 }, async t => {
    const page = await browserPage(t);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.route('https://www.youtube.com/**', route => route.request().url().includes('/youtubei/')
      ? route.fulfill({ json: { contents: Array.from({ length: size }, (_, i) => ({ videoRenderer: {
        videoId: `indexed${i}`, title: { simpleText: `Indexed ${i}` }
      } })) } })
      : route.fulfill({ contentType: 'text/html', body: '<html><body><ytd-page-manager></ytd-page-manager></body></html>' }));
    await page.goto('https://www.youtube.com/');
    await page.evaluate(() => { window.ytcfg = { get: key => key === 'INNERTUBE_CONTEXT' ? { client: { clientVersion: 'test' } } : undefined }; });
    await mainBundle(page);
    const grid = page.locator('[data-ytg-indexed-feed]');
    await grid.locator('[data-browse-id="video:indexed0"]').waitFor();
    await page.waitForTimeout(200);
    const { columns, steps } = await page.evaluate(() => {
      const grid = window.__pageDOM.querySelector('[data-ytg-indexed-feed]');
      const columns = getComputedStyle(grid.querySelector('.cards')).gridTemplateColumns.split(' ').length;
      window.YTGamepad.focus(grid.querySelector('[data-browse-id="video:indexed0"]'));
      window.__cardReads = [];
      const rect = Element.prototype.getBoundingClientRect;
      Element.prototype.getBoundingClientRect = function () {
        if (this.hasAttribute('data-browse-id')) window.__cardReads.push(this.getAttribute('data-browse-id'));
        return rect.call(this);
      };
      // Several repeats in one turn must advance from the pending ID.
      const steps = Math.min(3, columns - 1);
      for (let i = 0; i < steps; i++) window.YTGamepad.act('right');
      return { columns, steps };
    });
    assert.ok(columns >= 2);
    await page.waitForFunction(id => window.__pageDOM.activeElement?.dataset.browseId === id, `video:indexed${steps}`);
    await page.evaluate(() => window.YTGamepad.act('down'));
    await page.waitForFunction(id => window.__pageDOM.activeElement?.dataset.browseId === id, `video:indexed${steps + columns}`);
    await page.evaluate(() => window.YTGamepad.act('up'));
    await page.waitForFunction(id => window.__pageDOM.activeElement?.dataset.browseId === id, `video:indexed${steps}`);
    const measured = await page.evaluate(() => [...new Set(window.__cardReads)]);
    assert.ok(measured.length <= 4, `only source/destination cards may be measured: ${measured}`);
    t.diagnostic(`${size} items: ${measured.length} distinct cards measured during ${steps + 2} direction inputs`);
    await page.evaluate(() => {
      const grid = window.__pageDOM.querySelector('[data-ytg-indexed-feed]');
      window.YTGamepad.focus(grid.querySelector('[data-browse-id="video:indexed0"]'));
      window.YTGamepad.act('left');
    });
    assert.equal(await page.evaluate(() => window.YTGamepad.section), 'sidebar');
    await page.evaluate(() => window.YTGamepad.act('right'));
    await page.waitForFunction(() => window.__pageDOM.activeElement?.dataset.browseId === 'video:indexed0');
  });
}

test('row height caching preserves the visible anchor and measured rows across recycling', { timeout: 30000 }, async t => {
  const page = await browserPage(t);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.route('https://i.ytimg.com/**', route => route.fulfill({ status: 204 }));
  await page.route('https://www.youtube.com/**', route => route.fulfill(route.request().url().includes('/youtubei/')
    ? { json: { contents: Array.from({ length: 240 }, (_, i) => ({ videoRenderer: {
      videoId: `height${i}`, title: { simpleText: i % 2 ? 'A longer title that can wrap to another line '.repeat(4) : 'Short title' }
    } })) } }
    : { contentType: 'text/html', body: '<html><body></body></html>' }));
  await page.goto('https://www.youtube.com/');
  await page.evaluate(() => { window.ytcfg = { get: key => key === 'INNERTUBE_CONTEXT' ? { client: { clientVersion: 'test' } } : undefined }; });
  await mainBundle(page);
  const grid = page.locator('[data-ytg-virtual-feed]');
  await grid.locator('[data-row-id="video:height0"]').waitFor();
  const settle = () => page.evaluate(async () => {
    for (let i = 0; i < 8; i++) await new Promise(requestAnimationFrame);
  });
  const columns = await grid.evaluate(node => {
    const columns = getComputedStyle(node.querySelector('.cards')).gridTemplateColumns.split(' ').length;
    const style = document.createElement('style');
    style.textContent = [410, 520, 350].map((height, i) =>
      `.virtual-row[data-row-id="video:height${i * columns}"]{min-height:${height}px}`).join('\n');
    node.getRootNode().append(style);
    return columns;
  });
  await settle();
  await grid.evaluate(node => { node.scrollTop = 2000; node.dispatchEvent(new Event('scroll')); });
  await settle();
  const anchor = await grid.evaluate(node => {
    const top = node.getBoundingClientRect().top;
    const row = [...node.querySelectorAll('.virtual-row')].find(row => row.getBoundingClientRect().top >= top);
    return row ? { id: row.dataset.rowId, top: row.getBoundingClientRect().top - top } : {
      rows: [...node.querySelectorAll('.virtual-row')].map(row => ({ id: row.dataset.rowId, top: row.getBoundingClientRect().top, height: row.getBoundingClientRect().height })),
      top, height: node.clientHeight, scrollTop: node.scrollTop
    };
  });
  assert.ok(anchor.id, JSON.stringify(anchor));
  await grid.locator('[data-row-id="video:height0"]').evaluate(node => { node.style.minHeight = '510px'; });
  await settle();
  const after = await grid.locator(`[data-row-id="${anchor.id}"]`).evaluate(node =>
    node.getBoundingClientRect().top - node.closest('[data-ytg-browse-grid]').getBoundingClientRect().top);
  assert.ok(Math.abs(after - anchor.top) <= 1, `a row growing above the viewport keeps its anchor (${anchor.top} -> ${after})`);
  await grid.locator(`[data-row-id="${anchor.id}"] [data-browse-id]`).first().evaluate(node => node.focus({ preventScroll: true }));
  // The stylesheet retains the new height when the first row is remounted.
  await grid.evaluate(node => {
    const style = document.createElement('style');
    style.textContent = '.virtual-row[data-row-id="video:height0"]{min-height:510px}';
    node.getRootNode().append(style);
    node.scrollTop = 7000;
    node.dispatchEvent(new Event('scroll'));
  });
  await settle();
  assert.equal(await grid.locator('[data-row-id="video:height0"]').count(), 0, 'the measured first row is recycled');
  await grid.evaluate(node => { node.scrollTop = 0; node.dispatchEvent(new Event('scroll')); });
  await settle();
  const geometry = await grid.evaluate((node, columns) => {
    const first = node.querySelector('[data-row-id="video:height0"]');
    const third = node.querySelector(`[data-row-id="video:height${columns * 2}"]`);
    return { firstHeight: first.getBoundingClientRect().height,
      thirdOffset: third.getBoundingClientRect().top - first.getBoundingClientRect().top,
      gap: parseFloat(getComputedStyle(first).marginBottom) };
  }, columns);
  assert.equal(geometry.firstHeight, 510);
  assert.ok(Math.abs(geometry.thirdOffset - (510 + 520 + geometry.gap * 2)) <= 1);
  assert.ok(await grid.locator('[data-browse-id]').count() < 100);
  await grid.evaluate(async node => {
    const detail = { scrollTop: 2000 };
    node.dispatchEvent(new CustomEvent('ytg-browse-restore', { detail }));
    await detail.ready;
  });
  await settle();
  assert.ok(Math.abs(await grid.evaluate(node => node.scrollTop) - 2000) <= 1, 'restoration keeps the requested offset');
  await page.setViewportSize({ width: 900, height: 900 });
  await settle();
  assert.ok(await grid.evaluate(node => {
    const bounds = node.getBoundingClientRect();
    return [...node.querySelectorAll('.virtual-row')].some(row => {
      const rect = row.getBoundingClientRect();
      return rect.bottom > bounds.top && rect.top < bounds.bottom;
    });
  }), 'resizing into a new layout keeps visible rows mounted');
});

test('long feeds bound mounted cards, mount offscreen gamepad neighbours and restore after reload', { timeout: 30000 }, async t => {
  const page = await browserPage(t);
  let requests = 0;
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.route('https://i.ytimg.com/**', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="blue"/></svg>' }));
  await page.route('https://www.youtube.com/**', route => {
    if (!route.request().url().includes('/youtubei/')) return route.fulfill({ contentType: 'text/html', body: '<html><body></body></html>' });
    requests++;
    return route.fulfill({ json: { contents: Array.from({ length: 400 }, (_, i) => ({ videoRenderer: {
      videoId: `long${i}`, title: { simpleText: `Long video ${i}` }
    } })) } });
  });
  const configure = () => page.evaluate(() => { window.ytcfg = { get: key => key === 'INNERTUBE_CONTEXT' ? { client: { clientVersion: 'test' } } : undefined }; });
  await page.goto('https://www.youtube.com/'); await configure(); await mainBundle(page);
  const grid = page.locator('[data-ytg-virtual-feed]');
  await grid.locator('[data-browse-id="video:long0"]').waitFor();
  await page.waitForTimeout(150);
  assert.ok(await grid.locator('[data-browse-id]').count() < 100);
  const move = await page.evaluate(() => {
    const grid = window.__pageDOM.querySelector('[data-ytg-virtual-feed]');
    const nodes = [...grid.querySelectorAll('[data-browse-id]')];
    const last = nodes.at(-1), columns = getComputedStyle(grid.querySelector('.cards')).gridTemplateColumns.split(' ').length;
    const next = Number(last.dataset.browseId.slice('video:long'.length)) + columns;
    window.YTGamepad.focus(last);
    const absent = !grid.querySelector(`[data-browse-id="video:long${next}"]`);
    window.YTGamepad.act('down');
    return { absent, next, columns };
  });
  assert.equal(move.absent, true, 'the requested neighbour starts outside the mounted window');
  await page.waitForFunction(id => window.__pageDOM.activeElement?.getAttribute('data-browse-id') === id, `video:long${move.next}`);
  for (let step = 1; step <= 12; step++) {
    await page.evaluate(() => window.YTGamepad.act('down'));
    await page.waitForFunction(id => window.__pageDOM.activeElement?.getAttribute('data-browse-id') === id, `video:long${move.next + step * move.columns}`);
  }
  const selected = `video:long${move.next + 12 * move.columns}`;
  await page.waitForFunction(() => window.__pageDOM.querySelector('[data-ytg-virtual-feed]').scrollTop > 0);
  await page.evaluate(async () => {
    const grid = window.__pageDOM.querySelector('[data-ytg-virtual-feed]');
    let previous = -1, stable = 0;
    while (stable < 5) { await new Promise(requestAnimationFrame); const next = grid.scrollTop; stable = Math.abs(next - previous) < .5 ? stable + 1 : 0; previous = next; }
  });
  const before = await grid.evaluate(node => node.scrollTop);
  assert.ok(before > 0);
  assert.ok(await grid.locator('[data-browse-id]').count() < 100);
  await page.evaluate(id => window.__pageDOM.querySelector(`[data-browse-id="${id}"]`).click(), selected);
  await page.waitForURL('**/watch?*');
  const count = requests;
  await page.goBack(); await page.reload(); await configure(); await mainBundle(page);
  await grid.locator(`[data-browse-id="${selected}"]`).waitFor();
  await page.waitForFunction(id => window.__pageDOM.activeElement?.getAttribute('data-browse-id') === id, selected);
  assert.equal(requests, count, 'return restores all loaded data without fetching');
  await page.waitForFunction(top => Math.abs(window.__pageDOM.querySelector('[data-ytg-virtual-feed]').scrollTop - top) <= 1, before);
  const restoredScroll = await grid.evaluate(node => node.scrollTop);
  assert.ok(Math.abs(restoredScroll - before) <= 1, `scroll ${before} -> ${restoredScroll}`);
  assert.ok(await grid.locator('[data-browse-id]').count() < 100);
  assert.equal(await grid.locator('img').first().getAttribute('loading'), 'lazy');
  assert.equal(await grid.locator('img').first().getAttribute('decoding'), 'async');
  await grid.evaluate(node => { node.scrollTop = node.scrollHeight; });
  await grid.locator('[data-browse-id="video:long399"]').waitFor();
  assert.ok(await grid.locator('[data-browse-id]').count() < 100, 'wheel/scroll jumps also replace the mounted window');
});

test('windowed Shorts shelves cross unmounted neighbours and keep regular playlist navigation', { timeout: 30000 }, async t => {
  const page = await browserPage(t);
  await page.route('https://i.ytimg.com/**', route => route.fulfill({ status: 204 }));
  await page.route('https://www.youtube.com/**', route => route.request().url().includes('/youtubei/') ? route.fulfill({ json: { contents: [
    { playlistRenderer: { playlistId: 'PLtest', title: { simpleText: 'Playlist item' }, thumbnail: { thumbnails: [] }, navigationEndpoint: { watchEndpoint: { videoId: 'playlist', playlistId: 'PLtest' } } } },
    ...['before1', 'before2'].map(videoId => ({ videoRenderer: { videoId, title: { simpleText: videoId } } })),
    ...Array.from({ length: 70 }, (_, i) => ({ reelItemRenderer: { videoId: `short${i}`, headline: { simpleText: `Short ${i}` } } })),
    { videoRenderer: { videoId: 'after', title: { simpleText: 'After Shorts' } } }
  ] } }) : route.fulfill({ contentType: 'text/html', body: '<html><body></body></html>' }));
  await page.goto('https://www.youtube.com/');
  await page.evaluate(() => { window.ytcfg = { get: key => key === 'INNERTUBE_CONTEXT' ? { client: { clientVersion: 'test' } } : undefined }; });
  await mainBundle(page);
  const grid = page.locator('[data-ytg-virtual-feed]');
  await grid.locator('[data-browse-id="short:short0"]').waitFor();
  await grid.locator('[data-browse-id="playlist:PLtest:playlist"]').waitFor({ state: 'attached' });
  assert.ok(await grid.locator('.shorts-card').count() < 30);
  const target = await page.evaluate(() => {
    const grid = window.__pageDOM.querySelector('[data-ytg-virtual-feed]');
    const last = [...grid.querySelectorAll('.shorts-card')].at(-1);
    const next = Number(last.dataset.browseId.slice('short:short'.length)) + 1;
    window.YTGamepad.focus(last); window.YTGamepad.act('right'); return next;
  });
  await page.waitForFunction(id => window.__pageDOM.activeElement?.getAttribute('data-browse-id') === id, `short:short${target}`);
  await page.evaluate(() => window.YTGamepad.act('down'));
  await page.waitForFunction(() => window.__pageDOM.activeElement?.getAttribute('data-browse-id') === 'video:after');
  assert.ok(await grid.locator('.shorts-card').count() < 30);
  // Offscreen rows may be unmounted; navigating back must mount their data again.
  await page.evaluate(() => window.YTGamepad.act('up'));
  await page.waitForFunction(() => window.__pageDOM.activeElement?.getAttribute('data-browse-id')?.startsWith('short:'));
  await page.evaluate(() => window.YTGamepad.act('up'));
  await page.waitForFunction(() => ['playlist:PLtest:playlist', 'video:before1', 'video:before2'].includes(window.__pageDOM.activeElement?.getAttribute('data-browse-id')));
  await page.evaluate(() => {
    for (let i = 0; i < 2 && window.__pageDOM.activeElement?.getAttribute('data-browse-id') !== 'playlist:PLtest:playlist'; i++) window.YTGamepad.act('left');
  });
  await page.waitForFunction(() => window.__pageDOM.activeElement?.getAttribute('data-browse-id') === 'playlist:PLtest:playlist');
});

for (const count of [12, 70]) test(`Shorts shelf with ${count} cards scrolls and cycles in both directions`, { timeout: 30000 }, async t => {
  const page = await browserPage(t);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.route('https://i.ytimg.com/**', route => route.fulfill({ status: 204 }));
  await page.route('https://www.youtube.com/**', route => route.fulfill(route.request().url().includes('/youtubei/')
    ? { json: { contents: Array.from({ length: count }, (_, i) => ({ reelItemRenderer: {
      videoId: `cycle${i}`, headline: { simpleText: `Short ${i}` }
    } })) } }
    : { contentType: 'text/html', body: '<html><body></body></html>' }));
  await page.goto('https://www.youtube.com/');
  await page.evaluate(() => { window.ytcfg = { get: key => key === 'INNERTUBE_CONTEXT' ? { client: { clientVersion: 'test' } } : undefined }; });
  await mainBundle(page);
  await page.locator('[data-browse-id="short:cycle0"]').waitFor();
  await page.evaluate(() => window.YTGamepad.focus(window.__pageDOM.querySelector('[data-browse-id="short:cycle0"]')));
  const move = async (direction, index) => {
    await page.evaluate(direction => window.YTGamepad.act(direction), direction);
    await page.waitForFunction(id => {
      const node = window.__pageDOM.activeElement;
      if (node?.getAttribute('data-browse-id') !== id) return false;
      const card = node.getBoundingClientRect(), row = node.closest('.shorts-row').getBoundingClientRect();
      return card.left >= row.left && card.right <= row.right;
    }, `short:cycle${index}`);
  };
  // Cross the visible edge, then wrap at each logical end (including unmounted ends).
  for (let index = 1; index <= 8; index++) await move('right', index);
  assert.ok(await page.locator('.shorts-row').evaluate(node => node.scrollLeft) > 0);
  for (let index = 7; index >= 0; index--) await move('left', index);
  await move('left', count - 1);
  await move('right', 0);
  assert.equal(await page.locator('.shorts-row').evaluate(node => node.scrollLeft), 0);
  const next = page.locator('[data-shorts-scroll="next"]'), previous = page.locator('[data-shorts-scroll="previous"]');
  assert.equal(await previous.locator('svg').getAttribute('data-icon'), 'mingcute:left-line');
  assert.equal(await next.locator('svg').getAttribute('data-icon'), 'mingcute:right-line');
  await next.click();
  await page.waitForFunction(() => window.__pageDOM.querySelector('.shorts-row').scrollLeft > 0);
  await previous.click();
  await page.waitForFunction(() => window.__pageDOM.querySelector('.shorts-row').scrollLeft === 0);
  await previous.click();
  await page.waitForFunction(() => {
    const row = window.__pageDOM.querySelector('.shorts-row');
    return row.scrollLeft >= row.scrollWidth - row.clientWidth - 1;
  });
  await next.click();
  await page.waitForFunction(() => window.__pageDOM.querySelector('.shorts-row').scrollLeft === 0);
  assert.ok(await page.locator('.shorts-card').count() < 30);
});

for (const height of [600, 900]) test(`mouse wheel stops at the entire Shorts shelf from either side and its cards remain clickable at height ${height}`, { timeout: 30000 }, async t => {
  const feedFixture = { contents: [
      ...Array.from({ length: 12 }, (_, i) => ({ videoRenderer: { videoId: `before${i}`, title: { simpleText: `before${i}` } } })),
      ...Array.from({ length: 12 }, (_, i) => ({ reelItemRenderer: { videoId: `mouse${i}`, headline: { simpleText: `Short ${i}` } } })),
      ...Array.from({ length: 12 }, (_, i) => ({ videoRenderer: { videoId: `after${i}`, title: { simpleText: `after${i}` } } }))
    ] };


  const page = await browserPage(t);
  await page.setViewportSize({ width: 1280, height });
  await page.route('https://i.ytimg.com/**', route => route.fulfill({ status: 204 }));
  await page.route('https://www.youtube.com/**', route => { if (route.request().url().includes('/youtubei/v1/browse')) return route.fulfill({ json: feedFixture });
 return route.fulfill({ contentType: 'text/html', body: '<html><body><ytd-app></ytd-app></body></html>' }); });
  await page.goto('https://www.youtube.com/');
  await page.evaluate(() => {
    window.ytcfg = { get: key => key === 'INNERTUBE_CONTEXT' ? { client: { clientVersion: 'test' } } : undefined };

  });
  await mainBundle(page);
  const shelf = page.locator('.shorts-shelf'), grid = page.locator('[data-ytg-browse-grid]');
  await shelf.waitFor({ state: 'attached' });
  assert.equal(await grid.evaluate(node => getComputedStyle(node).scrollSnapType), 'y mandatory');
  assert.equal(await shelf.evaluate(node => getComputedStyle(node).scrollSnapAlign), 'start');
  assert.equal(await shelf.locator('.shorts-card').first().evaluate(node => getComputedStyle(node).scrollSnapAlign), 'none');
  const aligned = async () => {
    await page.waitForFunction(() => {
      const grid = window.__pageDOM.querySelector('[data-ytg-browse-grid]');
      const shelf = grid.querySelector('.shorts-shelf');
      return Math.abs(shelf.getBoundingClientRect().top - grid.getBoundingClientRect().top - parseFloat(getComputedStyle(grid).scrollPaddingTop)) < 2;
    });
  };
  const scrollFrom = async (id, delta) => {
    await page.locator(`[data-browse-id="video:${id}"]`).evaluate(node => node.scrollIntoView({ block: 'start', behavior: 'instant' }));
    const bounds = await grid.boundingBox();
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.mouse.wheel(0, delta);
    await aligned();
    await page.waitForTimeout(250);
    await aligned();
  };
  await scrollFrom('after0', -600);
  await scrollFrom('before11', 200);
  const short = shelf.locator('.shorts-card').first();
  const bounds = await short.locator('.card-cover').boundingBox();
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + 80);
  await page.waitForURL('**/shorts/mouse0');
});

test('Shorts open their canonical page even when the native router cannot open a reel', { timeout: 30000 }, async t => {
  const feedFixture = { contents: [{ reelItemRenderer: { videoId: 'JnICtQ9VHJ8', headline: { simpleText: 'Open this Short' } } }] };


  const page = await browserPage(t);
  let shortLoads = 0;
  await page.route('https://i.ytimg.com/**', route => route.fulfill({ status: 204 }));
  await page.route('https://www.youtube.com/**', route => {if (route.request().url().includes('/youtubei/v1/browse')) return route.fulfill({ json: feedFixture });

    const shorts = new URL(route.request().url()).pathname === '/shorts/JnICtQ9VHJ8';
    if (shorts && route.request().isNavigationRequest()) shortLoads++;
    return route.fulfill({ contentType: 'text/html', body: shorts
      ? '<html><body><ytd-app><ytd-page-manager><ytd-reel-video-renderer style="display:block;height:600px">Native Shorts player</ytd-reel-video-renderer></ytd-page-manager></ytd-app></body></html>'
      : '<html><body><ytd-app></ytd-app></body></html>' });
  });
  await page.goto('https://www.youtube.com/');
  await page.evaluate(() => {
    window.ytcfg = { get: key => key === 'INNERTUBE_CONTEXT' ? { client: { clientVersion: 'test' } } : undefined };

    document.querySelector('ytd-app').navigate_ = () => { throw new Error('Incomplete reel endpoint'); };
  });
  await mainBundle(page);
  await page.locator('[data-browse-id="short:JnICtQ9VHJ8"]').click();
  await page.waitForURL('**/shorts/JnICtQ9VHJ8');
  assert.equal(shortLoads, 1, 'Shorts use a document navigation, independent of private reel parameters');
  await mainBundle(page);
  await page.locator('ytd-reel-video-renderer').waitFor({ state: 'visible' });
  assert.equal(await page.locator('[data-ytg-browse-grid]').isVisible(), false);
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('ytg-custom-browse')), false);
});

test('pagination stays single-flight and retains focus when the feed becomes windowed', { timeout: 30000 }, async t => {
  const page = await browserPage(t);
  let requests = 0, release;
  const gate = new Promise(resolve => { release = resolve; });
  t.after(() => release());
  await page.route('https://i.ytimg.com/**', route => route.fulfill({ status: 204 }));
  await page.route('https://www.youtube.com/**', async route => {
    if (!route.request().url().includes('/youtubei/')) return route.fulfill({ contentType: 'text/html', body: '<html><body></body></html>' });
    const body = route.request().postDataJSON(); requests++;
    if (body.continuation) await gate;
    return route.fulfill({ json: { contents: [
      ...Array.from({ length: 100 }, (_, i) => ({ videoRenderer: { videoId: `paged${i + (body.continuation ? 100 : 0)}`, title: { simpleText: `Paged ${i}` } } })),
      ...(!body.continuation ? [{ continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: 'page-two' } } } }] : [])
    ] } });
  });
  await page.goto('https://www.youtube.com/');
  await page.evaluate(() => { window.ytcfg = { get: key => key === 'INNERTUBE_CONTEXT' ? { client: { clientVersion: 'test' } } : undefined }; });
  await mainBundle(page);
  await page.locator('[data-browse-id="video:paged99"]').waitFor({ state: 'attached' });
  await page.evaluate(() => {
    const grid = window.__pageDOM.querySelector('[data-ytg-browse-grid]');
    window.YTGamepad.focus(grid.querySelector('[data-browse-id="video:paged99"]'));
    for (let i = 0; i < 5; i++) grid.querySelector('[data-browse-more]').click();
  });
  await page.waitForFunction(() => window.__pageDOM.querySelector('[data-browse-more]')?.disabled);
  assert.equal(requests, 2);
  release();
  await page.locator('[data-ytg-virtual-feed]').waitFor();
  await page.waitForFunction(() => window.__pageDOM.activeElement?.getAttribute('data-browse-id') === 'video:paged99');
  const columns = await page.locator('.cards').evaluate(node => getComputedStyle(node).gridTemplateColumns.split(' ').length);
  await page.evaluate(() => window.YTGamepad.act('down'));
  await page.waitForFunction(id => window.__pageDOM.activeElement?.getAttribute('data-browse-id') === id, `video:paged${99 + columns}`);
  assert.ok(await page.locator('[data-browse-id]').count() < 100);
  assert.equal(requests, 2);
});

test('native feed churn does not rescan shell regions or measure hidden cards', { timeout: 30000 }, async t => {
  const page = await browserPage(t);
  await page.route('https://www.youtube.com/**', route => route.request().url().includes('/youtubei/') ?
    route.fulfill({ json: { contents: [{ videoRenderer: { videoId: 'api', title: { simpleText: 'API video' } } }] } }) :
    route.fulfill({ contentType: 'text/html', body: '<html><body><ytd-masthead><a href="/signin">Sign in</a></ytd-masthead><ytd-guide-renderer></ytd-guide-renderer><ytd-page-manager><ytd-browse></ytd-browse></ytd-page-manager></body></html>' }));
  await page.route('https://i.ytimg.com/**', route => route.fulfill({ status: 204 }));
  await page.goto('https://www.youtube.com/');
  await page.evaluate(() => {
    window.ytcfg = { get: key => key === 'INNERTUBE_CONTEXT' ? { client: { clientVersion: 'test' } } : undefined };
    const query = Document.prototype.querySelector, queryAll = Document.prototype.querySelectorAll;
    const rect = Element.prototype.getBoundingClientRect;
    window.__nativeReads = { shell: 0, rects: 0 };
    Document.prototype.querySelector = function(selector) {
      if (selector.startsWith('ytd-masthead #avatar-btn')) window.__nativeReads.shell++;
      return query.call(this, selector);
    };
    Document.prototype.querySelectorAll = function(selector) {
      if (selector === 'ytd-guide-renderer,ytd-mini-guide-renderer') window.__nativeReads.shell++;
      return queryAll.call(this, selector);
    };
    Element.prototype.getBoundingClientRect = function() {
      if (this.closest('ytd-page-manager')) window.__nativeReads.rects++;
      return rect.call(this);
    };
  });
  await mainBundle(page);
  await page.locator('[data-browse-id="video:api"]').waitFor();
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    window.__nativeReads = { shell: 0, rects: 0 };
    const feed = document.querySelector('ytd-browse');
    for (let i = 0; i < 100; i++) {
      const card = document.createElement('ytd-rich-item-renderer');
      card.innerHTML = `<a href="/watch?v=native${i}">Native ${i}</a>`;
      feed.append(card);
    }
  });
  await page.waitForTimeout(200);
  await page.evaluate(() => { window.YTGamepad.refresh(); window.YTGamepad.act('down'); });
  assert.deepEqual(await page.evaluate(() => window.__nativeReads), { shell: 0, rects: 0 });
  // Region replacement still refreshes the account action without a page scan.
  await page.evaluate(() => document.querySelector('ytd-masthead').remove());
  await page.waitForTimeout(50);
  await page.evaluate(() => {
    const header = document.createElement('ytd-masthead');
    header.innerHTML = '<a href="/signin">Sign in again</a>'; document.body.prepend(header);
  });
  await page.locator('.client-account').waitFor();
});

test('Shorts occupy their own row across the feed bridge and open the Shorts route', { timeout: 30000 }, async t => {
  const feedFixture = { contents: [
      { reelItemRenderer: { videoId: 'short-one', headline: { simpleText: 'A portrait short' }, shortBylineText: { simpleText: 'Creator' }, viewCountText: { simpleText: '12K views' } } },
      { videoRenderer: { videoId: 'normal', title: { simpleText: 'A normal video' } } },
      { reelItemRenderer: { videoId: 'short-two', headline: { simpleText: 'Another short' } } }
    ] };


  const page = await browserPage(t);
  await page.route('https://i.ytimg.com/**', route => route.fulfill({ contentType: 'image/svg+xml', body:
    '<svg xmlns="http://www.w3.org/2000/svg" width="360" height="640"><rect width="360" height="640" fill="#367"/></svg>' }));
  await page.route('https://www.youtube.com/**', route => { if (route.request().url().includes('/youtubei/v1/browse')) return route.fulfill({ json: feedFixture });
 return route.fulfill({ contentType: 'text/html', body: '<html><body><ytd-app></ytd-app></body></html>' }); });
  await page.goto('https://www.youtube.com/');
  await page.evaluate(() => {
    window.ytcfg = { get: key => key === 'INNERTUBE_CONTEXT' ? { client: { clientVersion: 'test' } } : undefined };

    document.querySelector('ytd-app').navigate_ = endpoint => {
      window.__shortOpen = endpoint;
      history.pushState({}, '', endpoint.commandMetadata.webCommandMetadata.url);
    };
  });
  await mainBundle(page);
  const short = page.locator('[data-browse-id="short:short-one"]');
  await short.waitFor();
  assert.equal(await page.locator('.shorts-heading h2').textContent(), 'Shorts');
  assert.equal(await short.locator('.shorts-badge, .card-channel-avatar').count(), 0);
  assert.equal(await short.locator('.shorts-view-count').textContent(), '12K views');
  assert.equal(await short.getAttribute('href'), '/shorts/short-one');
  const ratio = card => card.locator('.card-cover').evaluate(el => { const r = el.getBoundingClientRect(); return r.width / r.height; });
  assert.ok(Math.abs(await ratio(short) - 9 / 16) < .01);
  assert.ok(Math.abs(await ratio(page.locator('[data-browse-id="video:normal"]')) - 16 / 9) < .01);
  assert.equal(await page.locator('.shorts-shelf').count(), 1);
  assert.equal(await page.locator('.shorts-row .shorts-card').count(), 2);
  assert.equal(await page.locator('.shorts-shelf [data-browse-id="video:normal"]').count(), 0);
  const firstBounds = await short.boundingBox();
  const secondBounds = await page.locator('[data-browse-id="short:short-two"]').boundingBox();
  const videoBounds = await page.locator('[data-browse-id="video:normal"]').boundingBox();
  assert.equal(firstBounds.y, secondBounds.y, 'all Shorts share one row');
  assert.ok(videoBounds.y >= firstBounds.y + firstBounds.height, 'normal videos stay below the Shorts row');
  for (const width of [1920, 1280, 800, 420]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForFunction(() => {
      const row = window.__pageDOM.querySelector('.shorts-row'), card = row.querySelector('.shorts-card');
      const available = row.clientWidth - 20, actual = card.getBoundingClientRect().width;
      const regular = Math.max(1, Math.min(6, Math.floor((available + 16) / 326)));
      const limit = regular === 1 ? 2 : regular % 2 === 0 ? regular / 2 * 3 : regular + 2;
      const columns = Math.max(1, Math.min(limit, Math.floor((available + 16) / 256)));
      const previous = (available - (columns - 1) * 16) / columns;
      return Math.abs(actual - Math.min(available, previous * 1.2)) < 1;
    });
    const geometry = await short.evaluate(node => {
      const row = node.closest('.shorts-row'), box = node.getBoundingClientRect();
      return { width: box.width, available: row.clientWidth - 20, gap: getComputedStyle(row).gap };
    });
    assert.ok(geometry.width >= Math.min(288, geometry.available) - 1);
    assert.equal(geometry.gap, '16px');
    assert.ok(Math.abs(await ratio(short) - 9 / 16) < .01);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  mkdirSync('output/playwright', { recursive: true });
  await page.locator('[data-ytg-browse-grid]').evaluate(el => { el.scrollTop = 0; });
  await page.screenshot({ path: 'output/playwright/shorts-card.png' });
  await page.evaluate(() => window.postMessage({ source: 'yt-gamepad-settings', values: { gridLayout: 'oneColumn' } }, location.origin));
  await page.locator('.cards[data-horizontal=true]').waitFor();
  assert.ok(Math.abs(await ratio(short) - 9 / 16) < .01);
  assert.equal(await short.evaluate(el => getComputedStyle(el).flexDirection), 'column');
  await short.focus();
  await short.press('Enter');
  await page.waitForURL('**/shorts/short-one');
});

test('playlist stack uses native theme colors across the page bridge with a missing-color fallback', { timeout: 30000 }, async t => {
  const feedFixture = { contents: ['tinted', 'fallback'].map(id => ({ lockupViewModel: {
      contentId: `PL${id}`, contentType: 'LOCKUP_CONTENT_TYPE_PLAYLIST',
      metadata: { lockupMetadataViewModel: { title: { content: id } } },
      rendererContext: { commandContext: { onTap: { innertubeCommand: { watchEndpoint: { videoId: id, playlistId: `PL${id}` } } } } },
      contentImage: { collectionThumbnailViewModel: { stackColor: id === 'tinted' ? { lightTheme: 0xc6a1a1, darkTheme: 0x805858 } : undefined } }
    } })) };


  const page = await browserPage(t);
  await page.route('https://i.ytimg.com/**', route => route.fulfill({ contentType: 'image/svg+xml', body:
    '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#963"/></svg>' }));
  await page.route('https://www.youtube.com/**', route => { if (route.request().url().includes('/youtubei/v1/browse')) return route.fulfill({ json: feedFixture });
 return route.fulfill({ contentType: 'text/html', body: '<html><body></body></html>' }); });
  await page.goto('https://www.youtube.com/');
  await page.evaluate(() => {
    window.ytcfg = { get: key => key === 'INNERTUBE_CONTEXT' ? { client: { clientVersion: 'test' } } : undefined };

  });
  await mainBundle(page);
  const card = page.locator('[data-browse-id="playlist:PLtinted:tinted"]');
  const fallback = page.locator('[data-browse-id="playlist:PLfallback:fallback"]');
  await card.waitFor();
  const color = node => node.evaluate(el => getComputedStyle(el, '::before').backgroundColor);
  assert.equal(await color(card), 'rgb(198, 161, 161)');
  assert.equal(await color(fallback), 'rgb(96, 96, 96)');
  await page.evaluate(() => document.documentElement.setAttribute('dark', ''));
  assert.equal(await color(card), 'rgb(128, 88, 88)');
  assert.equal(await color(fallback), 'rgb(170, 170, 170)');
  assert.equal(await card.evaluate(el => getComputedStyle(el, '::after').opacity), '0', 'the independent hover surface stays hidden during controller selection');
  await page.evaluate(() => document.documentElement.removeAttribute('dark'));
  await card.focus();
  const spacing = await card.evaluate(el => {
    const cover = el.querySelector('.card-cover'), image = cover.querySelector('img');
    const outer = cover.getBoundingClientRect(), inner = image.getBoundingClientRect();
    const scale = parseFloat(getComputedStyle(el).scale) || 1;
    return [(inner.left - outer.left) / scale, (inner.top - outer.top) / scale, inner.width / inner.height, getComputedStyle(image).scale, parseFloat(getComputedStyle(el, '::before').top) - 4];
  });
  assert.ok(Math.abs(spacing[0] - 8) < .01 && Math.abs(spacing[1] - 16) < .01, 'the image stays inset from the focus frame while the whole card scales');
  assert.ok(Math.abs(spacing[2] - 16 / 9) < 0.01, 'the inset image retains 16:9');
  assert.equal(spacing[3], '1', 'selection cannot enlarge the image over the stack');
  assert.ok(spacing[4] > 0, 'both stack edges stay inside the focus frame');
  mkdirSync('output/playwright', { recursive: true });
  const selectedBounds = await card.boundingBox();
  await page.screenshot({ path: 'output/playwright/playlist-stack-selected.png', clip: { x: selectedBounds.x - 6, y: selectedBounds.y - 6, width: selectedBounds.width + 12, height: selectedBounds.height + 12 } });
  await page.evaluate(() => { window.__browsePad.connected = false; });
  await page.mouse.click(1000, 85);
  await card.evaluate(el => el.blur());
  const bounds = await card.boundingBox();
  await page.screenshot({ path: 'output/playwright/playlist-stack.png', clip: bounds });
});

test('playlist template keeps mixed-card navigation and aligns its stack with horizontal covers', { timeout: 30000 }, async t => {
  const feedFixture = { contents: [
      { playlistRenderer: { playlistId: 'PLmix', title: { simpleText: 'My playlist' }, thumbnail: { thumbnails: [] }, navigationEndpoint: { watchEndpoint: { videoId: 'first', playlistId: 'PLmix' } } } },
      { videoRenderer: { videoId: 'saved', title: { simpleText: 'Saved video' }, navigationEndpoint: { watchEndpoint: { videoId: 'saved', playlistId: 'WL' } } } }
    ] };


  const page = await browserPage(t);
  await page.route('https://i.ytimg.com/**', route => route.fulfill({ contentType: 'image/svg+xml', body:
    '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#963"/></svg>' }));
  await page.route('https://www.youtube.com/**', route => { if (route.request().url().includes('/youtubei/v1/browse')) return route.fulfill({ json: feedFixture });
 return route.fulfill({ contentType: 'text/html', body: `<html><body>
    <ytd-page-manager><ytd-browse>
      <ytd-playlist-renderer><a id="thumbnail" href="/watch?v=first&list=PLmix">My playlist</a></ytd-playlist-renderer>
      <ytd-video-renderer><a id="thumbnail" href="/watch?v=saved&list=WL">Saved video</a></ytd-video-renderer>
    </ytd-browse></ytd-page-manager></body></html>` }); });
  await page.goto('https://www.youtube.com/');
  await page.evaluate(() => {
    window.ytcfg = { get: key => key === 'INNERTUBE_CONTEXT' ? { client: { clientVersion: 'test' } } : undefined };

  });
  await mainBundle(page);
  const playlist = page.locator('[data-browse-id="playlist:PLmix:first"]');
  const video = page.locator('[data-browse-id="playlist:WL:saved"]');
  await playlist.waitFor();
  assert.equal(await playlist.locator('.playlist-badge').textContent(), '合集');
  assert.equal(await video.locator('.playlist-badge').count(), 0, 'an individual queued video keeps the video template');
  assert.equal(await playlist.getAttribute('href'), '/watch?v=first&list=PLmix');
  await page.evaluate(() => window.postMessage({ source: 'yt-gamepad-settings', values: { gridLayout: 'oneColumn' } }, location.origin));
  await page.locator('.cards[data-horizontal=true]').waitFor();
  const widths = await playlist.evaluate(node => [parseFloat(getComputedStyle(node, '::before').width), node.querySelector('.card-cover').getBoundingClientRect().width]);
  assert.ok(Math.abs(widths[0] - (widths[1] - 32)) < 1, 'stack edges follow the inset cover width, excluding metadata');
  await playlist.focus();
  await playlist.press('Enter');
  await page.waitForURL('**/watch?v=first&list=PLmix');
});

test('subscriptions, channels and playlists share API loading, pagination and return restoration without native cards', { timeout: 30000 }, async t => {
  const page = await browserPage(t);
  const calls = [];
  await page.route('https://i.ytimg.com/**', route => route.fulfill({ status: 204 }));
  await page.route('https://www.youtube.com/**', route => {
    const url = route.request().url();
    if (!url.includes('/youtubei/')) return route.fulfill({ contentType: 'text/html', body: '<html><body></body></html>' });
    const body = route.request().postDataJSON(); calls.push({ url, body });
    if (url.endsWith('/resolve_url')) return route.fulfill({ json: { endpoint: { browseEndpoint: { browseId: 'UCcreator', params: 'videos-tab' } } } });
    const topic = body.browseId || body.continuation?.split(':')[0];
    return route.fulfill({ json: { contents: [
      ...Array.from({ length: body.continuation ? 1 : 30 }, (_, i) => ({ videoRenderer: {
        videoId: body.continuation ? `${topic}-next` : `${topic}-${i}`, title: { simpleText: `${topic} ${i}` }
      } })),
      ...(!body.continuation ? [{ continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: `${topic}:next` } } } }] : [])
    ] } });
  });
  await page.goto('https://www.youtube.com/feed/subscriptions');
  await mainBundle(page);
  // Session config may arrive after the interface, without a page event or DOM mutation.
  await page.evaluate(() => { window.ytcfg = { get: key => key === 'INNERTUBE_CONTEXT' ? { client: { clientVersion: 'test' } } : undefined }; });
  const navigate = route => page.evaluate(route => {
    document.dispatchEvent(new Event('yt-navigate-start'));
    history.pushState({}, '', route);
    document.dispatchEvent(new Event('yt-navigate-finish'));
  }, route);
  for (const [route, id] of [['/feed/subscriptions', 'FEsubscriptions'], ['/@creator/videos', 'UCcreator'], ['/playlist?list=PLordinary', 'VLPLordinary']]) {
    if (id !== 'FEsubscriptions') await navigate(route);
    await page.locator(`[data-browse-id="video:${id}-29"]`).waitFor({ state: 'attached' });
    await page.locator('[data-browse-more]').dispatchEvent('click');
    await page.locator(`[data-browse-id="video:${id}-next"]`).waitFor({ state: 'attached' });
    await page.locator(`[data-browse-id="video:${id}-0"]`).focus();
    const count = calls.length;
    await navigate('/watch?v=temporary');
    await navigate(route);
    await page.locator(`[data-browse-id="video:${id}-next"]`).waitFor({ state: 'attached' });
    assert.equal(calls.length, count, 'return must reuse the loaded API list');
  }
  const channelRequest = calls.find(call => call.body.browseId === 'UCcreator');
  assert.equal(channelRequest.body.params, 'videos-tab');
  assert.equal(await page.locator('ytd-rich-item-renderer,ytd-video-renderer').count(), 0);
});

test('dedicated Explore page reuses its layout for music, movies and live with isolated feeds and return state', { timeout: 30000 }, async t => {
  const page = await browserPage(t);
  await page.setViewportSize({ width: 1280, height: 900 });
  const calls = [];
  await page.route('https://i.ytimg.com/**', route => route.fulfill({ contentType: 'image/svg+xml', body:
    '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#315c70"/></svg>' }));
  await page.route('https://www.youtube.com/**', route => {
    if (!route.request().url().includes('/youtubei/')) return route.fulfill({ contentType: 'text/html', body: '<html><body></body></html>' });
    const body = route.request().postDataJSON(); calls.push(body);
    const topic = body.browseId === 'FEstorefront' ? 'movies' : body.browseId === 'UC4R8DWoMoI7CAwX8_LjQHig' ? 'live' : 'music';
    return route.fulfill({ json: { contents: [
      ...Array.from({ length: body.continuation ? 1 : 24 }, (_, i) => ({ videoRenderer: {
        videoId: body.continuation ? 'music-next' : `${topic}-${i}`, title: { simpleText: `${topic} ${i}` }
      } })),
      ...(!body.continuation && topic === 'music' ? [{ continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: 'music-page-two' } } } }] : [])
    ] } });
  });
  await page.goto('https://www.youtube.com/channel/UC-9-kyTW8ZkZNDHQJ6FgpwQ');
  await page.evaluate(() => { window.ytcfg = { get: key => key === 'INNERTUBE_CONTEXT' ? { client: { clientVersion: 'test' } } : undefined }; });
  await mainBundle(page);
  await page.locator('[data-ytg-explore-page="music"] h1').waitFor();
  assert.equal(await page.locator('[data-ytg-explore-page] h1').textContent(), '音乐');
  await page.locator('[data-browse-id="video:music-23"]').waitFor({ state: 'attached' });
  assert.equal(await page.locator('#ytg-sidebar-explore').getAttribute('aria-expanded'), 'true');
  assert.equal(await page.locator('#ytg-sidebar-explore-links a[aria-current="page"]').textContent().then(value => value.trim()), '音乐');
  await page.locator('[data-browse-more]').dispatchEvent('click');
  await page.locator('[data-browse-id="video:music-next"]').waitFor({ state: 'attached' });
  assert.equal(calls[1].continuation, 'music-page-two');
  const navigate = route => page.evaluate(route => {
    document.dispatchEvent(new Event('yt-navigate-start'));
    history.pushState({}, '', route);
    document.dispatchEvent(new Event('yt-navigate-finish'));
  }, route);
  for (const [route, id, title] of [['/feed/storefront', 'movies', '电影'], ['/channel/UC4R8DWoMoI7CAwX8_LjQHig', 'live', '直播']]) {
    await navigate(route);
    await page.locator(`[data-ytg-explore-page="${id}"] h1`).waitFor();
    await page.locator(`[data-browse-id="video:${id}-23"]`).waitFor({ state: 'attached' });
    assert.equal(await page.locator('[data-ytg-explore-page] h1').textContent(), title);
    assert.equal(await page.locator('[data-browse-id="video:music-next"]').count(), 0);
  }
  const count = calls.length;
  await navigate('/channel/UC-9-kyTW8ZkZNDHQJ6FgpwQ');
  await page.locator('[data-browse-id="video:music-next"]').waitFor({ state: 'attached' });
  assert.equal(calls.length, count, 'return restores the topic snapshot and loaded continuation');
  await page.locator('.client-brand').focus();
  await page.locator('[data-ytg-browse-grid]').evaluate(node => { node.scrollTop = 0; });
  await page.waitForTimeout(150);
  const headingBounds = await page.locator('[data-ytg-explore-page] h1').boundingBox();
  assert.ok(headingBounds && headingBounds.y >= 56 && headingBounds.y < 400, 'the page heading remains visible at the top instead of snapping straight to the first video');
  await page.waitForFunction(() => window.__pageDOM.querySelector('[data-browse-id="video:music-0"] img')?.dataset.loaded === 'true');
  mkdirSync('output/playwright', { recursive: true });
  await page.screenshot({ path: 'output/playwright/explore-music.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(150);
  assert.equal(await page.locator('[data-ytg-browse-grid]').evaluate(node => node.scrollWidth <= node.clientWidth), true);
});

test('scroll pagination uses API continuation, locks requests and retries the same page without native scrolling', { timeout: 30000 }, async t => {
  const page = await browserPage(t);
  const requests = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  t.after(() => release());
  let attempts = 0;
  await page.route('https://i.ytimg.com/**', route => route.fulfill({ status: 204 }));
  await page.route('https://www.youtube.com/**', async route => {
    if (!route.request().url().includes('/youtubei/')) return route.fulfill({ contentType: 'text/html', body:
      '<html><body><ytd-page-manager><ytd-continuation-item-renderer><button>Native more</button></ytd-continuation-item-renderer></ytd-page-manager></body></html>' });
    const body = route.request().postDataJSON(); requests.push(body);
    // A non-transient error reaches the UI; 503 is retried by the request layer.
    if (body.continuation && ++attempts === 1) { await gate; return route.fulfill({ status: 500 }); }
    return route.fulfill({ json: { contents: [
      ...Array.from({ length: body.continuation ? 2 : 36 }, (_, i) => ({ videoRenderer: {
        videoId: body.continuation && i ? 'new' : `video${i}`, title: { simpleText: `Video ${i}` }
      } })),
      ...(!body.continuation ? [{ continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: 'page-two' } } } }] : [])
    ] } });
  });
  await page.goto('https://www.youtube.com/');
  await page.evaluate(() => {
    window.ytcfg = { get: key => key === 'INNERTUBE_CONTEXT' ? { client: { clientVersion: 'test' } } : undefined };
    window.__nativeLoads = 0;
    const native = document.querySelector('ytd-continuation-item-renderer');
    native.scrollIntoView = () => { window.__nativeLoads++; };
    native.querySelector('button').onclick = () => { window.__nativeLoads++; };
  });
  await mainBundle(page);
  const grid = page.locator('[data-ytg-browse-grid]');
  await grid.locator('[data-browse-id="video:video35"]').waitFor({ state: 'attached' });
  assert.equal(requests.length, 1);
  const immediateReads = await grid.evaluate(node => {
    node.scrollTop = node.scrollHeight;
    const scrollHeight = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollHeight').get;
    window.__pagingGeometryReads = 0;
    Object.defineProperty(node, 'scrollHeight', { configurable: true, get() {
      window.__pagingGeometryReads++;
      return scrollHeight.call(this);
    } });
    for (let i = 0; i < 8; i++) node.dispatchEvent(new Event('scroll'));
    return window.__pagingGeometryReads;
  });
  assert.equal(immediateReads, 0, 'scroll bursts defer geometry reads until after the frame');
  await page.waitForFunction(() => window.__pageDOM.querySelector('[data-ytg-browse-grid]')?.getAttribute('aria-busy') === 'true');
  await page.waitForTimeout(150);
  assert.equal(requests.length, 2);
  assert.equal(await page.evaluate(() => window.__pagingGeometryReads), 1, 'scroll and observer checks share one geometry read before loading');
  assert.equal(requests[1].continuation, 'page-two');
  assert.ok(await grid.locator('.feed-skeleton').count() > 0, 'pagination displays card skeletons in the existing grid');
  assert.equal(await grid.locator('.feed-skeleton [data-browse-id],.feed-skeleton a,.feed-skeleton button').count(), 0, 'placeholders cannot enter gamepad navigation');
  release();
  await grid.getByRole('alert').waitFor();
  assert.equal(await grid.locator('.feed-skeleton').count(), 0, 'failed requests remove loading placeholders');
  assert.equal(await grid.locator('[data-browse-id]').count(), 36);
  await grid.getByRole('alert').getByRole('button').click();
  await grid.locator('[data-browse-id="video:new"]').waitFor();
  assert.equal(requests.length, 3);
  assert.equal(requests[2].continuation, 'page-two');
  assert.equal(await grid.locator('[data-browse-id]').count(), 37);
  assert.equal(await grid.locator('[data-browse-more]').count(), 0);
  assert.equal(await page.evaluate(() => window.__nativeLoads), 0);
  assert.equal(await page.evaluate(() => window.scrollY), 0);
});

for (const initialCount of [35, 155]) {
  test(`pagination skeletons fill the partial row in ${initialCount > 120 ? 'virtual' : 'ordinary'} grids`, { timeout: 30000 }, async t => {
    const page = await browserPage(t);
    await page.setViewportSize({ width: 1280, height: 900 });
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    t.after(() => release());
    await page.route('https://i.ytimg.com/**', route => route.fulfill({ status: 204 }));
    await page.route('https://www.youtube.com/**', async route => {
      if (!route.request().url().includes('/youtubei/')) return route.fulfill({ contentType: 'text/html', body: '<html><body></body></html>' });
      const continuation = route.request().postDataJSON().continuation;
      if (continuation) await gate;
      return route.fulfill({ json: { contents: [
        ...Array.from({ length: continuation ? 4 : initialCount }, (_, i) => ({ videoRenderer: {
          videoId: `skeleton-test-${i + (continuation ? initialCount : 0)}`, title: { simpleText: `Video ${i}` },
          ownerText: { simpleText: 'Creator' }
        } })),
        ...(!continuation ? [{ continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: 'next' } } } }] : [])
      ] } });
    });
    await page.goto('https://www.youtube.com/');
    await page.evaluate(() => { window.ytcfg = { get: key => key === 'INNERTUBE_CONTEXT' ? { client: { clientVersion: 'test' } } : undefined }; });
    await mainBundle(page);
    const grid = page.locator('[data-ytg-browse-grid]');
    await grid.locator('[data-browse-id="video:skeleton-test-0"]').waitFor();
    await grid.evaluate(node => { window.__retainedFirstCard = node.querySelector('[data-browse-id="video:skeleton-test-0"]'); });
    await grid.locator('[data-browse-more]').dispatchEvent('click');
    await grid.evaluate(node => { node.scrollTop = node.scrollHeight; node.dispatchEvent(new Event('scroll')); });
    const skeleton = grid.locator(`[data-skeleton-id="skeleton:${initialCount}"]`);
    await skeleton.waitFor({ state: 'attached' });
    const last = grid.locator(`[data-browse-id="video:skeleton-test-${initialCount - 1}"]`);
    await last.waitFor({ state: 'attached' });
    const alignment = await grid.evaluate((node, count) => {
      const last = node.querySelector(`[data-browse-id="video:skeleton-test-${count - 1}"]`).getBoundingClientRect();
      const skeleton = node.querySelector(`[data-skeleton-id="skeleton:${count}"]`).getBoundingClientRect();
      return { last: last.toJSON(), skeleton: skeleton.toJSON(), columns: getComputedStyle(node.querySelector('.cards')).gridTemplateColumns.split(' ').length };
    }, initialCount);
    assert.equal(alignment.columns, 3);
    assert.ok(Math.abs(alignment.last.top - alignment.skeleton.top) < 1, 'the placeholder fills the existing partial row');
    assert.ok(Math.abs(alignment.last.width - alignment.skeleton.width) < 1, 'real and skeleton cards share column widths');
    assert.equal(await skeleton.getAttribute('aria-hidden'), 'true');
    if (initialCount === 35) {
      mkdirSync('output/playwright', { recursive: true });
      await page.screenshot({ path: 'output/playwright/pagination-skeletons.png' });
    }
    release();
    await grid.locator(`[data-browse-id="video:skeleton-test-${initialCount + 3}"]`).waitFor({ state: 'attached' });
    assert.equal(await grid.locator('.feed-skeleton').count(), 0);
    assert.equal(await grid.evaluate(node => node.querySelector('[data-browse-id="video:skeleton-test-0"]') === window.__retainedFirstCard), true, 'appending keeps the selected real card mounted');
  });
}

test('short API pages fill the viewport but repeated empty results stop automatic paging', { timeout: 30000 }, async t => {
  const page = await browserPage(t);
  const requests = [];
  await page.route('https://i.ytimg.com/**', route => route.fulfill({ status: 204 }));
  await page.route('https://www.youtube.com/**', route => {
    if (!route.request().url().includes('/youtubei/')) return route.fulfill({ contentType: 'text/html', body: '<html><body></body></html>' });
    requests.push(route.request().postDataJSON());
    return route.fulfill({ json: { contents: [
      { videoRenderer: { videoId: requests.length > 3 ? 'manual' : 'same', title: { simpleText: 'Video' } } },
      ...(requests.length <= 3 ? [{ continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: `next-${requests.length}` } } } }] : [])
    ] } });
  });
  await page.goto('https://www.youtube.com/');
  await page.evaluate(() => { window.ytcfg = { get: key => key === 'INNERTUBE_CONTEXT' ? { client: { clientVersion: 'test' } } : undefined }; });
  await mainBundle(page);
  const more = page.locator('[data-browse-more]');
  await page.waitForFunction(() => window.__pageDOM.querySelector('[data-ytg-browse-grid]')?.getAttribute('aria-busy') === 'false' &&
    window.__pageDOM.querySelector('[data-browse-id="video:same"]'));
  await page.waitForTimeout(500);
  assert.equal(requests.length, 3, 'two pages with no new identities stop automatic requests');
  await more.click();
  await page.locator('[data-browse-id="video:manual"]').waitFor();
  assert.equal(requests.length, 4);
  assert.equal(requests[3].continuation, 'next-3');
});

for (const [routePath, endpoint] of [['/', 'browse'], ['/results?search_query=music&sp=original', 'search']]) {
  test(`${endpoint} ignores native cards before session readiness and uses API filters and pagination`, { timeout: 30000 }, async t => {
    const page = await browserPage(t);
    const calls = [];
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.route('https://i.ytimg.com/**', route => route.fulfill({ status: 204 }));
    await page.route('https://www.youtube.com/**', route => {
      if (!route.request().url().includes('/youtubei/')) return route.fulfill({ contentType: 'text/html', body:
        '<html><body><ytd-page-manager><ytd-browse><ytd-rich-item-renderer><a id="thumbnail" href="/watch?v=native">Native</a></ytd-rich-item-renderer></ytd-browse></ytd-page-manager><yt-chip-cloud-chip-renderer>Native filter</yt-chip-cloud-chip-renderer></body></html>' });
      const body = route.request().postDataJSON(); calls.push({ url: route.request().url(), body });
      const filtered = body.params === 'filtered';
      return route.fulfill({ json: { contents: [
        ...Array.from({ length: body.continuation ? 1 : 36 }, (_, i) => ({ videoRenderer: {
          videoId: body.continuation ? 'second-page' : `${filtered ? 'filtered' : 'first'}-${i}`, title: { simpleText: 'API video' }
        } })),
        { chipCloudChipRenderer: { text: { simpleText: 'Music' }, navigationEndpoint: endpoint === 'browse' ?
          { browseEndpoint: { browseId: 'music', params: 'filtered' } } :
          { searchEndpoint: { query: 'music', params: 'filtered' } } } },
        ...(!body.continuation ? [{ continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: 'next-page' } } } }] : [])
      ] } });
    });
    await page.goto(`https://www.youtube.com${routePath}`);
    await mainBundle(page);
    const grid = page.locator('[data-ytg-browse-grid]');
    await grid.waitFor();
    assert.equal(await grid.locator('[data-browse-id]').count(), 0, 'session wait must not display native cards');
    assert.equal(calls.length, 0);
    await page.evaluate(() => {
      window.ytcfg = { get: key => key === 'INNERTUBE_CONTEXT' ? { client: { clientVersion: 'test' } } : undefined };
    });
    await grid.locator('[data-browse-id="video:first-35"]').waitFor({ state: 'attached' });
    assert.ok(calls[0].url.endsWith(`/youtubei/v1/${endpoint}`));
    if (endpoint === 'search') {
      assert.equal(calls[0].body.query, 'music');
      assert.equal(calls[0].body.params, 'original');
    }
    await page.evaluate(() => {
      document.querySelector('ytd-rich-item-renderer a').textContent = 'Changed native card';
      document.querySelector('yt-chip-cloud-chip-renderer').textContent = 'Changed native filter';
    });
    assert.equal(await grid.locator('[data-browse-id="video:native"]').count(), 0);
    await page.locator('[data-browse-more]').dispatchEvent('click');
    await grid.locator('[data-browse-id="video:second-page"]').waitFor({ state: 'attached' });
    assert.equal(calls[1].body.continuation, 'next-page');
    await page.locator('#ytg-browse-categories button').filter({ hasText: 'Music' }).click();
    await grid.locator('[data-browse-id="video:filtered-35"]').waitFor({ state: 'attached' });
    assert.equal(calls[2].body.params, 'filtered');
    assert.equal(await grid.locator('[data-browse-id="video:first-0"]').count(), 0);
  });
}

test('home loads from late session config without native cards, page data or navigation events', { timeout: 30000 }, async t => {
  const page = await browserPage(t);
  const bodies = [];
  await page.route('https://i.ytimg.com/**', route => route.fulfill({ status: 204 }));
  await page.route('https://www.youtube.com/**', route => {
    if (!route.request().url().includes('/youtubei/')) return route.fulfill({ contentType: 'text/html', body: '<html><body></body></html>' });
    const body = route.request().postDataJSON(); bodies.push(body);
    return route.fulfill({ json: { contents: [
      { videoRenderer: { videoId: body.browseId === 'music' ? 'music' : 'early', title: { simpleText: 'API video' } } },
      { chipCloudChipRenderer: { text: { simpleText: 'Music' },
        navigationEndpoint: { browseEndpoint: { browseId: 'music' } } } }
    ] } });
  });
  await page.goto('https://www.youtube.com/');
  await mainBundle(page);
  await page.locator('[data-ytg-browse-grid]').waitFor();
  assert.equal(bodies.length, 0, 'wait for session config rather than sending an invalid request');
  await page.evaluate(() => {
    window.ytcfg = { get: key => key === 'INNERTUBE_CONTEXT' ? { client: { clientName: 'WEB', clientVersion: 'test' } } : undefined };
  });
  await page.locator('[data-browse-id="video:early"]').waitFor();
  assert.equal(bodies.length, 1);
  assert.equal(bodies[0].browseId, 'FEwhat_to_watch');
  assert.equal(await page.evaluate(() => !Object.getOwnPropertyDescriptor(window, 'ytInitialData')?.get || !!document.querySelector('ytd-page-manager')), false);
  await page.locator('#ytg-browse-categories button').filter({ hasText: 'Music' }).click();
  await page.locator('[data-browse-id="video:music"]').waitFor();
  assert.equal(bodies[1].browseId, 'music');
});

for (const reducedMotion of ['no-preference', 'reduce']) {
  test(`browse motion preserves focus geometry, loading and folded navigation (${reducedMotion})`, { timeout: 30000 }, async t => {
  const feedFixture = { chips: ['All', 'Music'].map((label, i) => ({ chipCloudChipRenderer: {
        text: { simpleText: label }, isSelected: i === 0,
        navigationEndpoint: { browseEndpoint: { browseId: i ? 'music' : 'FEwhat_to_watch' } }
      } })) };

    const page = await browserPage(t);
    await page.emulateMedia({ reducedMotion });
    await page.setViewportSize({ width: 1280, height: 900 });
    let releaseFeed, releaseImages, releaseMusic;
    const feedGate = new Promise(resolve => { releaseFeed = resolve; });
    const imageGate = new Promise(resolve => { releaseImages = resolve; });
    const musicGate = new Promise(resolve => { releaseMusic = resolve; });
    t.after(() => { releaseFeed(); releaseImages(); releaseMusic(); });
    await page.route('https://i.ytimg.com/**', async route => {
      await imageGate;
      await route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270"><rect width="480" height="270" fill="#315c70"/></svg>' });
    });
    await page.route('https://www.youtube.com/**', async route => {
      if (!route.request().url().includes('/youtubei/')) return route.fulfill({ contentType: 'text/html', body: '<html><body><ytd-page-manager></ytd-page-manager></body></html>' });
      await feedGate;
      const body = route.request().postDataJSON();
      const category = body.browseId || 'more';
      if (category === 'music') await musicGate;
      return route.fulfill({ json: { ...feedFixture,  contents: [
        ...feedFixture.chips,
        ...Array.from({ length: 18 }, (_, i) => ({ videoRenderer: { videoId: `${category}-${i}`, title: { simpleText: `${category} ${i}` } } })),
        { continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: 'more' } } } }
      ]  } });
    });
    await page.goto('https://www.youtube.com/');
    await page.evaluate(() => {
      window.ytcfg = { get: () => ({ client: { clientName: 'WEB', clientVersion: 'test' } }) };

      window.__motionCalls = [];
      const animate = Element.prototype.animate;
      Element.prototype.animate = function(frames, options) {
        window.__motionCalls.push(options?.id);
        return animate.call(this, frames, options);
      };
    });
    await mainBundle(page);
    const grid = page.locator('[data-ytg-browse-grid]');
    await grid.locator('.feed-skeleton').first().waitFor();
    assert.equal(await grid.getAttribute('aria-busy'), 'true');
    assert.equal(await grid.locator('.feed-skeleton').first().getAttribute('aria-hidden'), 'true');
    assert.ok(await grid.locator('.feed-skeleton .card-channel-avatar').count() > 0);
    releaseFeed();
    const card = grid.locator('[data-browse-id="video:FEwhat_to_watch-0"]');
    await card.waitFor();
    assert.equal(await grid.locator('.feed-skeleton').count(), 0);
    assert.equal(await grid.getAttribute('aria-busy'), 'false');
    const cover = card.locator('.card-cover');
    const before = await cover.evaluate(node => ({ width: node.offsetWidth, height: node.offsetHeight }));
    assert.equal(await cover.getAttribute('data-loading'), 'true');
    assert.equal(await card.locator('strong').textContent(), 'FEwhat_to_watch 0', 'metadata does not wait for the thumbnail');
    const coverStyle = await cover.evaluate(node => ({ background: getComputedStyle(node).backgroundColor, animation: getComputedStyle(node).animationName,
      duration: getComputedStyle(node.querySelector('img')).transitionDuration }));
    assert.equal(coverStyle.animation, 'none', 'the thumbnail backdrop stays stable while the image loads');
    assert.equal(coverStyle.duration, reducedMotion === 'reduce' ? '0s' : '0.28s');
    releaseImages();
    await page.waitForFunction(() => window.__pageDOM.querySelector('[data-browse-id="video:FEwhat_to_watch-0"] img')?.dataset.loaded === 'true');
    assert.equal(await cover.evaluate(node => getComputedStyle(node).backgroundColor), coverStyle.background);
    await card.focus();
    await page.evaluate(() => { document.documentElement.classList.add('ytg-gamepad-input'); document.documentElement.dataset.ytgInputMode = 'gamepad'; window.YTGamepad.refresh(); });
    await page.waitForTimeout(220);
    const focusedCover = await cover.boundingBox();
    const focusScale = reducedMotion === 'reduce' ? 1 : 1.04;
    assert.ok(Math.abs(focusedCover.width / before.width - focusScale) < .005, 'focus enlarges the entire cover');
    assert.ok(Math.abs(focusedCover.height / before.height - focusScale) < .005, 'focus preserves the thumbnail aspect ratio');
    assert.equal(await card.evaluate(node => getComputedStyle(node).scale), reducedMotion === 'reduce' ? 'none' : '1.04');
    assert.equal(await card.locator('img').evaluate(node => getComputedStyle(node).scale), 'none', 'the image is not cropped by an additional zoom');
    const calls = await page.evaluate(() => window.__motionCalls.filter(id => id === 'ytg-feed-enter').length);
    assert.equal(calls, reducedMotion === 'reduce' ? 0 : 1);
    await page.evaluate(() => { window.YTGamepad.act('right'); window.YTGamepad.act('left'); });
    await grid.locator('[data-browse-more]').dispatchEvent('click');
    await grid.locator('[data-browse-id="video:more-0"]').waitFor();
    assert.equal(await page.evaluate(() => window.__motionCalls.filter(id => id === 'ytg-feed-enter').length), calls, 'navigation and appending never replay the feed entrance');
    await page.locator('#ytg-browse-categories button').last().click();
    await grid.locator('.feed-skeleton').first().waitFor();
    await page.locator('.client-brand').evaluate(node => window.YTGamepad.focus(node));
    releaseMusic();
    await grid.locator('[data-browse-id="video:music-0"]').waitFor();
    assert.equal(await page.evaluate(() => window.__pageDOM.activeElement.classList.contains('client-brand')), true, 'a late category response must not steal focus from the header');
    assert.equal(await page.evaluate(() => window.__motionCalls.filter(id => id === 'ytg-feed-enter').length), reducedMotion === 'reduce' ? 0 : 2);
    const toggle = page.locator('#ytg-sidebar-explore');
    await toggle.click();
    await page.locator('#ytg-sidebar-explore-links a').first().waitFor();
    await toggle.click();
    assert.equal(await page.locator('#ytg-sidebar-explore-links').evaluate(node => node.inert), true);
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
    await page.evaluate(() => window.YTGamepad.act('down'));
    assert.equal(await page.evaluate(() => !!window.__pageDOM.activeElement.closest('#ytg-sidebar-explore-links')), false);
    await page.locator('#ytg-sidebar-explore-links').waitFor({ state: 'hidden' });
    await toggle.click(); await toggle.click(); await toggle.click();
    await page.locator('#ytg-sidebar-explore-links a').first().waitFor();
    assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
    assert.equal(await page.locator('#ytg-sidebar-explore-links').evaluate(node => node.inert), false);
    mkdirSync('output/playwright', { recursive: true });
    await page.screenshot({ path: `output/playwright/browse-motion-${reducedMotion}.png` });
  });
}

async function mainBundle(page, guide = { items: [] }) {
  await page.route('https://www.youtube.com/youtubei/v1/guide**', route => route.fulfill({ json: guide }));
  // Playback metadata and recommendations use separate endpoints from the feed.
  // Keep those requests out of browse pagination and restoration assertions.
  await page.route('https://www.youtube.com/youtubei/v1/next**', route => route.fulfill({ json: {} }));
  await page.route('https://www.youtube.com/youtubei/v1/player**', route => route.fulfill({ json: { playabilityStatus: { status: 'ERROR' } } }));
  for (const stylesheet of ['src/ui/theme.css', 'src/app/browse.css'])
    await page.addStyleTag({ content: readFileSync(new URL('../' + stylesheet, import.meta.url), 'utf8') });
  await page.evaluate(() => {
    if (!Object.getOwnPropertyDescriptor(window, 'ytInitialData'))
      Object.defineProperty(window, 'ytInitialData', { get() { throw Error('Startup JSON read'); } });
    // Match YouTube's page containers, which the adapter uses to exclude stale pages.
    const manager = window.__pageDOM.querySelector('ytd-page-manager');
    if (manager && !manager.querySelector('ytd-browse,ytd-search')) {
      const browse = document.createElement('ytd-browse');
      browse.append(...manager.childNodes); manager.append(browse);
    }
    document.documentElement.setAttribute('data-ytg-language', 'zh-CN');
    const pad = { connected: true, mapping: 'standard', index: 0, id: 'test', axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0, touched: false })) };
    window.__browsePad = pad;
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [pad] });
  });
  await page.addScriptTag({ content: await mainFixture() });
  await page.waitForFunction(() => !!window.YTGamepadCoordinator);
  await page.evaluate(() => { document.documentElement.setAttribute('data-ytg-language', 'zh-CN'); });
  await page.evaluate(() => window.postMessage({ source: 'yt-gamepad-settings',
    values: { enabled: true, theater: true, uiLanguage: 'zh-CN' } }, location.origin));
}

test('header and sidebar icons preserve theme and current-page variants', { timeout: 30000 }, async t => {
  const page = await browserPage(t);
  await page.route('https://www.youtube.com/**', route => route.request().url().includes('/youtubei/')
    ? route.fulfill({ json: { contents: [] } })
    : route.fulfill({ contentType: 'text/html', body: '<html><body><ytd-masthead></ytd-masthead><ytd-page-manager></ytd-page-manager></body></html>' }));
  await page.goto('https://www.youtube.com/');
  await page.evaluate(() => {
    window.ytcfg = { get: () => ({ client: { clientName: 'WEB', clientVersion: 'test' } }) };

  });
  await mainBundle(page);
  await page.locator('.client-account').waitFor();
  const homeIcon = page.locator('[data-sidebar-id="home"] svg');
  assert.equal(await homeIcon.getAttribute('data-icon'), 'mingcute:home-fill');
  assert.equal(await page.locator('[data-sidebar-id="subscriptions"] svg').getAttribute('data-icon'), 'material:subscriptions-line');
  assert.ok(await homeIcon.locator('path').count() > 0);
  const badge = page.locator('[data-ytg-page-mode] [data-ytg-icon="true"]');
  const prompt = await badge.evaluate(node => ({
    background: getComputedStyle(node).backgroundColor,
    image: getComputedStyle(node).backgroundImage,
  }));
  assert.equal(prompt.background, 'rgba(0, 0, 0, 0)');
  // Face buttons use their own artwork; they do not use the monochrome mask.
  assert.notEqual(prompt.image, 'none', 'the controller prompt has button artwork');
  const promptLoaded = await badge.evaluate(async node => {
    const image = new Image();
    image.src = getComputedStyle(node).backgroundImage.match(/^url\(["']?(.*?)["']?\)$/)?.[1] || '';
    try { await image.decode(); return image.naturalWidth > 0 && image.naturalHeight > 0; }
    catch { return false; }
  });
  assert.ok(promptLoaded, 'the controller prompt artwork can be decoded');
  assert.equal(await badge.isVisible(), true);
  const accountIcon = page.locator('.client-account svg');
  assert.equal(await accountIcon.getAttribute('data-icon'), 'mingcute:person-line');
  async function checkIcons() {
    const colors = [];
    for (const icon of [accountIcon, homeIcon, page.locator('[data-sidebar-id="subscriptions"] svg')]) {
      assert.equal(await icon.isVisible(), true);
      const appearance = await icon.evaluate(node => {
        const style = getComputedStyle(node), bounds = node.getBoundingClientRect();
        const shapes = [...node.querySelectorAll('path,circle,rect,polygon,polyline,line,ellipse')]
          .filter(shape => {
            const box = shape.getBBox(), shapeStyle = getComputedStyle(shape);
            return box.width + box.height > 0 && shapeStyle.display !== 'none'
              && shapeStyle.visibility === 'visible' && Number(shapeStyle.opacity) > 0
              && (shapeStyle.fill !== 'none' || shapeStyle.stroke !== 'none');
          });
        return { width: bounds.width, height: bounds.height, color: style.color,
          parentColor: getComputedStyle(node.parentElement).color,
          paints: shapes.map(shape => {
            const style = getComputedStyle(shape);
            return style.fill !== 'none' ? style.fill : style.stroke;
          }) };
      });
      assert.ok(appearance.width > 0 && appearance.height > 0, 'the SVG has visible dimensions');
      assert.equal(appearance.color, appearance.parentColor, 'the SVG inherits its control color');
      assert.ok(appearance.paints.length > 0, 'the SVG contains painted shapes');
      for (const paint of appearance.paints) assert.equal(paint, appearance.color, 'the SVG artwork follows the theme color');
      colors.push(appearance.color);
    }
    return colors;
  }
  const lightColors = await checkIcons();
  await page.locator('[data-sidebar-id="subscriptions"]').focus();
  assert.equal(await homeIcon.getAttribute('data-icon'), 'mingcute:home-fill', 'focus must not replace the current-page fill variant');
  mkdirSync('output/playwright', { recursive: true });
  await page.screenshot({ path: 'output/playwright/mingcute-icons-light.png' });
  await page.evaluate(() => document.documentElement.setAttribute('dark', ''));
  const darkColors = await checkIcons();
  assert.notEqual(darkColors[0], lightColors[0], 'the header icon adapts to the dark theme');
  assert.equal(await homeIcon.getAttribute('data-icon'), 'mingcute:home-fill');
  assert.equal(await page.locator('[data-sidebar-id="subscriptions"] svg').getAttribute('data-icon'), 'material:subscriptions-line');
  await page.screenshot({ path: 'output/playwright/mingcute-icons-dark.png' });
});

test('explicit focus regions connect cards, sidebar, categories, search and settings', { timeout: 30000 }, async t => {
  const feedFixture = { chips: ['All', 'Music'].map((label, i) => ({ chipCloudChipRenderer: {
      text: { simpleText: label }, isSelected: i === 0, navigationEndpoint: { browseEndpoint: { browseId: i ? 'music' : 'FEwhat_to_watch' } }
    } })) };

  const page = await browserPage(t);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.route('https://i.ytimg.com/**', route => route.abort());
  await page.route('https://www.youtube.com/**', route => {
    if (route.request().url().includes('/youtubei/')) return route.fulfill({ json: { ...feedFixture,  contents: Array.from({ length: 8 }, (_, i) => ({
      videoRenderer: { videoId: `focus${i}`, title: { simpleText: `Video ${i}` } }
    }))  } });
    return route.fulfill({ contentType: 'text/html', body: '<html><body><ytd-masthead style="display:block;height:56px"><input id="search"></ytd-masthead><ytd-page-manager></ytd-page-manager></body></html>' });
  });
  await page.goto('https://www.youtube.com/');
  await page.evaluate(() => {
    window.ytcfg = { get: () => ({ client: { clientName: 'WEB', clientVersion: 'test' } }) };

  });
  for (const stylesheet of ['src/ui/theme.css', 'src/app/browse.css'])
    await page.addStyleTag({ content: readFileSync(new URL(`../${stylesheet}`, import.meta.url), 'utf8') });
  await mainBundle(page);
  const cards = page.locator('#ytg-browse-grid a[data-browse-id]'); await cards.first().waitFor();
  const section = () => page.evaluate(() => {
    const el = window.YTGamepad.current;
    return el?.closest('[data-ytg-category]') ? 'categories'
      : el?.closest('#ytg-browse-sidebar') ? 'sidebar' : el?.closest('ytd-masthead,#ytg-browse-top') ? 'header' : 'content';
  });
  const input = action => page.keyboard.press({ left: 'ArrowLeft', right: 'ArrowRight', up: 'ArrowUp', down: 'ArrowDown', confirm: 'Enter', back: 'Escape' }[action]);
  await cards.first().focus(); await input('left'); assert.equal(await section(), 'sidebar');
  await input('right'); assert.equal(await section(), 'content');
  await input('up'); assert.equal(await section(), 'categories');
  const categoryFocus = await page.evaluate(() => {
    const category = window.__pageDOM.activeElement;
    const button = category.querySelector('button');
    return { wrapperOutline: getComputedStyle(category).outlineStyle,
      buttonOutline: getComputedStyle(button).outlineStyle,
      buttonShadow: getComputedStyle(button).boxShadow };
  });
  assert.equal(categoryFocus.wrapperOutline, 'none');
  assert.equal(categoryFocus.buttonOutline, 'none');
  assert.notEqual(categoryFocus.buttonShadow, 'none', 'category navigation uses the shared hover shadow');
  await input('up'); assert.equal(await section(), 'header');
  // Search inputs own physical editing keys; exercise the header's directional
  // exit from a non-editing control rather than its newly focusable text field.
  await page.locator('#ytg-browse-top .client-brand').evaluate(node => window.YTGamepad.focus(node));
  await input('down'); assert.equal(await section(), 'categories');
  await input('confirm'); assert.equal(await section(), 'categories');
  await input('down'); assert.equal(await section(), 'content');
  await page.locator('#ytg-sidebar-settings').focus();
  assert.equal(await section(), 'sidebar');
  await input('confirm');
  await page.waitForFunction(() => document.querySelector('#yt-gamepad-menu')?.hasAttribute('data-settings'));

});

test('full document return restores API category, loaded cards, focus and scroll without refetching', { timeout: 30000 }, async t => {
  const feedFixture = { chips: ['All', 'Music'].map((label, i) => ({ chipCloudChipRenderer: {
      text: { simpleText: label }, isSelected: i === 0,
      navigationEndpoint: { browseEndpoint: { browseId: i ? 'music' : 'FEwhat_to_watch' } }
    } })) };

  const page = await browserPage(t);
  const requests = [];
  await page.route('https://i.ytimg.com/**', route => route.abort());
  await page.route('https://www.youtube.com/**', route => {
    if (!route.request().url().includes('/youtubei/')) return route.fulfill({ contentType: 'text/html',
      body: '<html><body><ytd-page-manager></ytd-page-manager></body></html>' });
    const body = route.request().postDataJSON();
    const key = body.continuation || body.browseId; requests.push(key);
    return route.fulfill({ json: { ...feedFixture,  contents: [
      ...Array.from({ length: 40 }, (_, i) => ({ videoRenderer: { videoId: `${key}-${i}`, title: { simpleText: `${key} ${i}` } } })),
      { continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: key === 'music' ? 'next' : 'third' } } } }
    ]  } });
  });
  await page.goto('https://www.youtube.com/');
  await page.evaluate(() => {
    history.replaceState({ youtube: 'preserved' }, '');
    window.ytcfg = { get: name => ({ INNERTUBE_CONTEXT: { client: { clientName: 'WEB', clientVersion: 'test' } } })[name] };

  });
  await mainBundle(page);
  const grid = page.locator('#ytg-browse-grid');
  await grid.locator('[data-browse-id="video:FEwhat_to_watch-0"]').waitFor();
  await grid.getByRole('button', { name: 'Music', exact: true }).click();
  await grid.locator('[data-browse-id="video:music-0"]').waitFor();
  await grid.getByRole('button', { name: /^(Load more videos|加载更多视频)$/ }).dispatchEvent('click');
  const card = grid.locator('[data-browse-id="video:next-20"]');
  await card.waitFor();
  await card.focus();
  // Invoke the card without Playwright changing its scroll position first.
  const scrollTop = await page.evaluate(() => {
    const grid = window.__pageDOM.querySelector('[data-ytg-browse-grid]');
    return grid.scrollTop;
  });
  assert.ok(scrollTop > 0);
  await page.evaluate(() => window.__pageDOM.querySelector('[data-browse-id="video:next-20"]').click());
  await page.waitForURL('**/watch?v=next-20');
  const beforeReturn = requests.length;
  await page.goBack();
  // Force a new document even on browsers that preserve the back/forward cache.
  await page.reload();
  await page.evaluate(() => {
    window.ytcfg = { get: name => ({ INNERTUBE_CONTEXT: { client: { clientName: 'WEB', clientVersion: 'test' } } })[name] };
  });
  await mainBundle(page);
  await card.waitFor();
  await page.waitForFunction(() => window.__pageDOM.activeElement?.getAttribute('data-browse-id') === 'video:next-20');
  assert.equal(await grid.locator('[data-browse-id]').count(), 80);
  assert.equal(await grid.locator('#ytg-browse-categories button[aria-pressed="true"]').textContent(), 'Music');
  assert.equal(await grid.locator('[data-ytg-browse-grid]').evaluate(node => node.scrollTop), scrollTop);
  assert.equal(await page.evaluate(() => history.state.youtube), 'preserved');
  assert.equal(requests.length, beforeReturn);
  await grid.getByRole('button', { name: /^(Load more videos|加载更多视频)$/ }).dispatchEvent('click');
  await grid.locator('[data-browse-id="video:third-0"]').waitFor();
  assert.equal(requests.at(-1), 'third');
});

test('sidebar retains the current frame during SPA navigation without native guide links', { timeout: 30000 }, async t => {
  const feedFixture = { videoRenderer: { videoId: 'home-card', title: { simpleText: 'Home' } } };
  let feedUsed = false;

  const page = await browserPage(t);
  let documents = 0;
  await page.route('https://i.ytimg.com/**', route => route.abort());
  await page.route('https://www.youtube.com/**', route => {
    if (route.request().url().includes('/youtubei/')) return route.fulfill({ json: (route.request().postDataJSON()?.browseId === 'FEwhat_to_watch' && !feedUsed ? (feedUsed = true, feedFixture) : { contents: [
      { videoRenderer: { videoId: 'subscriptions-card', title: { simpleText: 'Subscription' } } }
    ] }) });
    documents++;
    return route.fulfill({ contentType: 'text/html', body: '<html><body><ytd-app></ytd-app><ytd-masthead><input id="search"></ytd-masthead><ytd-page-manager></ytd-page-manager></body></html>' });
  });
  await page.goto('https://www.youtube.com/');
  await page.evaluate(() => {
    window.ytcfg = { get: key => key === 'INNERTUBE_CONTEXT' ? { client: { clientVersion: 'test' } } : undefined };

    window.__sidebarNavigations = 0;
    document.querySelector('ytd-app').navigate_ = endpoint => {
      window.__sidebarNavigations++;
      document.dispatchEvent(new Event('yt-navigate-start'));
      history.pushState({}, '', endpoint.commandMetadata.webCommandMetadata.url);
    };
  });
  await mainBundle(page);
  const oldCard = page.locator('[data-browse-id="video:home-card"]');
  await oldCard.waitFor();
  await page.evaluate(() => { window.__retainedCard = window.__pageDOM.querySelector('[data-browse-id="video:home-card"]'); });
  await page.locator('[data-sidebar-id="home"]').click();
  assert.equal(await page.evaluate(() => window.__sidebarNavigations), 0, 'active entry is a no-op');
  await page.locator('[data-sidebar-id="subscriptions"]').click();
  await page.waitForTimeout(150); // Cover the surface's deferred synchronization.
  assert.equal(await oldCard.isVisible(), true);
  assert.equal(await page.locator('#ytg-browse-categories button').count() > 0, true);
  assert.equal(await page.evaluate(() => window.__retainedCard === window.__pageDOM.querySelector('[data-browse-id="video:home-card"]')), true);
  assert.equal(documents, 1, 'missing guide links must not reload the document');
  assert.equal(await page.evaluate(() => window.__sidebarNavigations), 1);
  await page.evaluate(() => document.dispatchEvent(new Event('yt-navigate-finish')));
  await page.locator('[data-browse-id="video:subscriptions-card"]').waitFor();
  assert.equal(await oldCard.count(), 0);
  await page.locator('[data-sidebar-id="subscriptions"]').click();
  assert.equal(await page.evaluate(() => window.__sidebarNavigations), 1);
  for (const event of ['yt-navigate-cancel', 'yt-navigate-error']) {
    await page.locator('[data-sidebar-id="home"]').click();
    await page.evaluate(event => {
      history.replaceState({}, '', '/feed/subscriptions');
      document.dispatchEvent(new Event(event));
    }, event);
    await page.locator('[data-browse-id="video:subscriptions-card"]').waitFor();
    assert.equal(await page.locator('[data-sidebar-id="subscriptions"]').getAttribute('aria-current'), 'page');
  }
  assert.equal(documents, 1);
});

test('subscriptions uses the YouTube router without clicking guide links and renders API cards', { timeout: 30000 }, async t => {
  const feedFixture = { videoRenderer: { videoId: 'home1234567', title: { simpleText: '首页视频' } } };
  let feedUsed = false;

  const page = await browserPage(t);
  await page.route('https://i.ytimg.com/**', route => route.abort());
  await page.route('https://www.youtube.com/**', route => route.request().url().includes('/youtubei/') ?
    route.fulfill({ json: (route.request().postDataJSON()?.browseId === 'FEwhat_to_watch' && !feedUsed ? (feedUsed = true, feedFixture) : { contents: [{ videoRenderer: { videoId: 'subs1234567', title: { simpleText: 'YouTube 订阅更新' },
      ownerText: { simpleText: '原生订阅频道' } } }] }) }) : route.fulfill({ contentType: 'text/html', body:
    `<html><head><meta charset="utf-8"></head><body>
    <ytd-masthead style="display:block;height:56px"><input id="search"></ytd-masthead>
    <ytd-guide-renderer><a href="/feed/subscriptions">订阅</a></ytd-guide-renderer>
    <ytd-page-manager><ytd-rich-item-renderer><a id="thumbnail" href="/watch?v=home1234567"><h3>首页视频</h3></a></ytd-rich-item-renderer></ytd-page-manager>
    </body></html>` }));
  await page.goto('https://www.youtube.com/');
  await page.evaluate(() => {
    window.ytcfg = { get: key => key === 'INNERTUBE_CONTEXT' ? { client: { clientVersion: 'test' } } : undefined };

    const app = document.createElement('ytd-app'); document.body.append(app);
    app.navigate_ = endpoint => {
      window.__subscriptionClicks = (window.__subscriptionClicks || 0) + 1;
      document.dispatchEvent(new Event('yt-navigate-start'));
      history.pushState({}, '', endpoint.commandMetadata.webCommandMetadata.url);
      window.__pageDOM.querySelector('ytd-page-manager').innerHTML =
        '<ytd-browse><ytd-rich-item-renderer><a id="thumbnail" href="/watch?v=subs1234567"><h3>YouTube 订阅更新</h3></a><span id="channel-name">原生订阅频道</span></ytd-rich-item-renderer></ytd-browse>';
      document.dispatchEvent(new Event('yt-navigate-finish'));
    };
  });
  await mainBundle(page);
  await page.locator('[data-browse-id="video:home1234567"]').waitFor();
  await page.locator('#ytg-browse-sidebar [data-sidebar-id="subscriptions"]').click();
  const card = page.locator('#ytg-browse-grid [data-browse-id="video:subs1234567"]');
  await card.waitFor();
  assert.equal(new URL(page.url()).pathname, '/feed/subscriptions');
  assert.equal(await page.evaluate(() => window.__subscriptionClicks), 1);
  assert.equal(await card.locator('strong').textContent(), 'YouTube 订阅更新');
  assert.equal(await card.locator('.channel').textContent(), '原生订阅频道');
  assert.equal(await page.locator('[data-browse-id="video:home1234567"]').count(), 0);
  assert.equal(await page.locator('#ytg-browse-sidebar [data-sidebar-id="subscriptions"]').getAttribute('aria-current'), 'page');
});

test('sidebar has API sections, expands Explore and retains focus despite native card changes', { timeout: 30000 }, async t => {
  const feedFixture = { contents: Array.from({ length: 16 }, (_, i) => ({ videoRenderer: {
      videoId: `sidebar${i}`, title: { simpleText: `视频 ${i + 1}` }, ownerText: { simpleText: '频道名称' }
    } })) };


  const guide = guideData();
  guide.items[2] = { guideSectionRenderer: { items: [{ guideCollapsibleEntryRenderer: {
    expanderItem: { guideEntryRenderer: { formattedTitle: { simpleText: '探索' } } },
    expandableItems: [['游戏', '/gaming'], ['新闻', '/feed/news']].map(([label, href]) => ({
      guideEntryRenderer: { formattedTitle: { simpleText: label },
        navigationEndpoint: { commandMetadata: { webCommandMetadata: { url: href } }, browseEndpoint: { browseId: 'FEfixture' } } }
    }))
  } }] } };
  const page = await browserPage(t);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.route('https://i.ytimg.com/**', route => route.abort());
  await page.route('https://www.youtube.com/**', route => {
    if (route.request().url().includes('/youtubei/v1/browse')) return route.fulfill({ json: feedFixture });
 return route.fulfill({ contentType: 'text/html', body:
    `<html><head><meta charset="utf-8"></head><body><ytd-masthead style="display:block;height:56px"><input id="search" placeholder="搜索"></ytd-masthead>
    <ytd-guide-renderer><ytd-guide-section-renderer><div id="guide-section-title">探索</div>
    <ytd-guide-entry-renderer><a href="/gaming"><yt-formatted-string>游戏</yt-formatted-string></a></ytd-guide-entry-renderer>
    <ytd-guide-entry-renderer><a href="/feed/news"><yt-formatted-string>新闻</yt-formatted-string></a></ytd-guide-entry-renderer>
    </ytd-guide-section-renderer></ytd-guide-renderer><ytd-mini-guide-renderer>Native mini guide</ytd-mini-guide-renderer>
    <ytd-page-manager>${Array.from({ length: 16 }, (_, i) => `<ytd-rich-item-renderer><a id="thumbnail" href="/watch?v=sidebar${i}"><h3>视频 ${i + 1}</h3></a><span id="channel-name">频道名称</span></ytd-rich-item-renderer>`).join('')}</ytd-page-manager></body></html>` }); });
  await page.goto('https://www.youtube.com/');
  await page.evaluate(() => {
    window.ytcfg = { get: key => key === 'INNERTUBE_CONTEXT' ? { client: { clientVersion: 'test' } } : undefined };

  });
  for (const stylesheet of ['src/ui/theme.css', 'src/app/browse.css'])
    await page.addStyleTag({ content: readFileSync(new URL(`../${stylesheet}`, import.meta.url), 'utf8') });
  await mainBundle(page, guide);
  const sidebar = page.locator('#ytg-browse-sidebar');
  await sidebar.waitFor();
  await sidebar.locator('[data-sidebar-id="home"]').waitFor();
  assert.equal(await sidebar.locator('[data-sidebar-section]').count(), 4);
  assert.equal(await sidebar.locator('[data-sidebar-id="history"]').getAttribute('href'), '/feed/history');
  assert.equal(await sidebar.locator('[data-sidebar-id="home"]').getAttribute('aria-current'), 'page');
  const expand = sidebar.getByRole('button', { name: '探索', exact: true });
  assert.equal(await expand.getAttribute('aria-expanded'), 'false');
  await expand.focus();
  await page.evaluate(() => window.YTGamepad.act('confirm'));
  await sidebar.getByRole('link', { name: '游戏', exact: true }).waitFor();
  assert.equal(await expand.getAttribute('aria-expanded'), 'true');
  assert.equal(await sidebar.getByRole('link', { name: '游戏', exact: true }).getAttribute('href'), '/gaming');
  await page.evaluate(() => window.YTGamepad.act('down'));
  assert.equal(await page.evaluate(() => window.__pageDOM.activeElement.textContent.trim()), '游戏');
  await page.evaluate(() => {
    const app = document.createElement('ytd-app'); document.body.append(app);
    app.navigate_ = endpoint => { window.__exploreClicks = (window.__exploreClicks || 0) + 1; window.__exploreTarget = endpoint.browseEndpoint.browseId; };
    window.YTGamepad.act('confirm');
  });
  assert.equal(await page.evaluate(() => window.__exploreClicks), 1);
  assert.equal(await page.evaluate(() => window.__exploreTarget), 'UCOpNcN46UbXVtpKMrmU4Abg');
  await page.evaluate(() => {
    const item = document.createElement('ytd-rich-item-renderer');
    const link = document.createElement('a'); link.id = 'thumbnail'; link.href = '/watch?v=appended'; link.textContent = 'Appended'; item.append(link);
    window.__pageDOM.querySelector('ytd-page-manager ytd-browse').append(item);
  });
  assert.equal(await page.locator('[data-browse-id="video:appended"]').count(), 0, 'native changes cannot overwrite the API list');
  assert.equal(await page.evaluate(() => window.__pageDOM.activeElement.textContent.trim()), '游戏');
  await expand.focus(); await page.evaluate(() => window.YTGamepad.act('confirm'));
  const exploreLinks = sidebar.locator(`[id="${await expand.getAttribute('aria-controls')}"]`);
  assert.equal(await exploreLinks.getAttribute('aria-hidden'), 'true');
  assert.equal(await exploreLinks.evaluate(node => node.inert), true);
  await exploreLinks.waitFor({ state: 'hidden' });
  assert.equal(await expand.getAttribute('aria-expanded'), 'false');
  await sidebar.locator('[data-sidebar-id="home"]').focus();
  await page.evaluate(() => window.YTGamepad.act('right'));
  assert.ok(await page.evaluate(() => window.__pageDOM.activeElement.hasAttribute('data-browse-id')));
  // Custom cards paint one frame on the thumbnail in either theme.
  for (const dark of [false, true]) {
    await page.evaluate(dark => {
      document.documentElement.toggleAttribute('dark', dark);
      document.documentElement.classList.add('ytg-gamepad-input');
      document.documentElement.dataset.ytgInputMode = 'gamepad';
      window.YTGamepad.refresh();
    }, dark);
    const selection = await page.evaluate(() => {
      const card = window.__pageDOM.activeElement;
      const thumbnail = card.querySelector('.card-cover');
      const ring = window.__pageDOM.querySelector('#yt-gamepad-overlay').shadowRoot.querySelector('#ring');
      const style = getComputedStyle(thumbnail);
      const color = document.createElement('span').style;
      color.color = getComputedStyle(document.documentElement).getPropertyValue('--ytg-focus-color').trim();
      return { display: getComputedStyle(ring).display, color: style.outlineColor,
        focusColor: color.color,
        outline: style.outlineStyle, width: parseFloat(style.outlineWidth),
        focusWidth: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ytg-focus-width')) };
    });
    assert.equal(selection.display, 'none', 'no duplicate floating ring');
    assert.equal(selection.color, selection.focusColor);
    assert.equal(selection.outline, 'solid');
    assert.equal(selection.width, selection.focusWidth);
  }
  assert.equal(await page.locator('ytd-guide-renderer').evaluate(node => getComputedStyle(node).display), 'none');
  // The theme checks above set the DOM mode directly; restore it before real mouse input.
  await page.evaluate(() => { document.documentElement.dataset.ytgInputMode = 'mouse'; });
  await expand.click();
  await page.waitForFunction(() => {
    const grid = window.__pageDOM.querySelector('#ytg-browse-grid');
    return Math.abs(grid.getBoundingClientRect().left - parseFloat(getComputedStyle(grid).getPropertyValue('--ytg-sidebar-expanded-width'))) < 1;
  });
  mkdirSync('output/playwright', { recursive: true });
  await page.screenshot({ path: 'output/playwright/browse-sidebar.png' });
  const bounds = await page.evaluate(() => ({ sidebar: window.__pageDOM.querySelector('#ytg-browse-sidebar').getBoundingClientRect().right,
    grid: window.__pageDOM.querySelector('#ytg-browse-grid').getBoundingClientRect().left }));
  assert.ok(bounds.grid > 80, 'the feed moves aside for the expanded sidebar');
  assert.ok(Math.abs(bounds.sidebar - bounds.grid) < 1, 'expanded sidebar stays beside the content');
  const contentBounds = await page.evaluate(() => ({
    card: window.__pageDOM.querySelector('[data-browse-id]').getBoundingClientRect().left
  }));
  assert.ok(contentBounds.card >= bounds.sidebar, 'the first card is fully outside the sidebar');
  await page.mouse.move(1000, 700);
  await page.waitForFunction(() => window.__pageDOM.querySelector('#ytg-browse-grid').getBoundingClientRect().left === 80);
  assert.equal(await expand.evaluate(node => node === window.__pageDOM.activeElement), true,
    'mouse leave collapses the sidebar even when the clicked button keeps focus');
  await expand.hover();
  await page.waitForFunction(() => window.__pageDOM.querySelector('#ytg-browse-grid').getBoundingClientRect().left > 80);
  await page.mouse.move(1000, 700);
  await page.waitForFunction(() => window.__pageDOM.querySelector('#ytg-browse-grid').getBoundingClientRect().left === 80);
  await page.keyboard.press('ArrowDown');
  await page.waitForFunction(() => {
    const grid = window.__pageDOM.querySelector('#ytg-browse-grid');
    return Math.abs(grid.getBoundingClientRect().left - parseFloat(getComputedStyle(grid).getPropertyValue('--ytg-sidebar-expanded-width'))) < 1;
  });
  await page.evaluate(() => window.postMessage({ source: 'yt-gamepad-settings', values: { enabled: false } }, location.origin));
  await sidebar.waitFor({ state: 'hidden' });
  assert.notEqual(await page.locator('ytd-guide-renderer').evaluate(node => getComputedStyle(node).display), 'none');
});

test('category bar survives fullscreen-sized viewports, masthead backing and late header resizing', { timeout: 30000 }, async t => {
  const feedFixture = { chips: ['All', 'Music', 'Gaming'].map((label, i) => ({ chipCloudChipRenderer: {
      text: { simpleText: label }, isSelected: i === 0,
      navigationEndpoint: { browseEndpoint: { browseId: 'FEwhat_to_watch' } }
    } })) };

  const page = await browserPage(t);
  await page.route('https://i.ytimg.com/**', route => route.abort());
  await page.route('https://www.youtube.com/**', route => route.request().url().includes('/youtubei/')
    ? route.fulfill({ json: { ...feedFixture,  contents: [{ videoRenderer: { videoId: 'layout', title: { simpleText: 'Layout card' } } }]  } })
    : route.fulfill({ contentType: 'text/html', body: `<html><head><style>
      body{margin:0}#masthead-container{position:fixed;inset:0 0 auto;z-index:2020;background:white}
      ytd-masthead{display:block;height:56px;background:white}
      #masthead-container::after{content:'';position:absolute;top:100%;left:0;right:0;height:48px;background:white}
      </style></head><body><div id="masthead-container"><ytd-masthead>Search header</ytd-masthead></div><ytd-page-manager></ytd-page-manager></body></html>` }));
  await page.goto('https://www.youtube.com/');
  await page.evaluate(() => {
    window.ytcfg = { get: () => ({ client: { clientName: 'WEB', clientVersion: 'test' } }) };

  });
  await mainBundle(page);
  const buttons = page.locator('#ytg-browse-categories button');
  await buttons.first().waitFor();
  for (const [width, height, headerHeight] of [[1280, 720, 56], [1920, 1080, 72], [800, 600, 64], [1280, 720, 56]]) {
    await page.setViewportSize({ width, height });
    // Header layout settles after the window's resize event, without new data.
    await page.waitForTimeout(150);
    await page.locator('ytd-masthead').evaluate((node, size) => { node.style.height = `${size}px`; }, headerHeight);
    await page.waitForTimeout(250);
    const layout = await buttons.evaluateAll(nodes => nodes.map(button => {
      const r = button.getBoundingClientRect(), bar = button.closest('nav').getBoundingClientRect();
      const header = window.__pageDOM.querySelector('#ytg-browse-top').getBoundingClientRect();
      return { belowHeader: bar.top >= header.bottom, inside: r.top >= bar.top && r.bottom <= bar.bottom,
        uncovered: [0.1, 0.5, 0.9].every(y => button.contains(window.__pageDOM.elementFromPoint(r.left + r.width / 2, r.top + r.height * y))) };
    }));
    assert.ok(layout.every(item => item.belowHeader && item.inside && item.uncovered), JSON.stringify({ width, height, headerHeight, layout }));
  }
  await page.evaluate(() => {
    document.dispatchEvent(new Event('yt-navigate-start'));
    history.pushState({}, '', '/watch?v=layout');
    document.dispatchEvent(new Event('yt-navigate-finish'));
  });
  await page.locator('#ytg-browse-grid').waitFor({ state: 'hidden' });
  await page.evaluate(() => {
    document.dispatchEvent(new Event('yt-navigate-start'));
    history.replaceState({}, '', '/');
    const old = window.__pageDOM.querySelector('ytd-masthead');
    const header = document.createElement('ytd-masthead'); header.textContent = 'Restored search header'; old.replaceWith(header);
    const backing = document.createElement('div'); backing.id = 'frosted-glass';
    backing.style.cssText = 'position:absolute;inset:0 0 auto;height:160px;background:white;pointer-events:none';
    window.__pageDOM.querySelector('#masthead-container').prepend(backing);
    document.dispatchEvent(new Event('yt-navigate-finish'));
    document.dispatchEvent(new Event('fullscreenchange'));
  });
  await buttons.first().waitFor();
  await page.waitForTimeout(150);
  await page.locator('ytd-masthead').evaluate(node => { node.style.height = '88px'; });
  await page.waitForTimeout(250);
  assert.equal(await buttons.first().evaluate(button => {
    const r = button.getBoundingClientRect();
    return button.closest('nav').getBoundingClientRect().top >= window.__pageDOM.querySelector('#ytg-browse-top').getBoundingClientRect().bottom
      && button.contains(window.__pageDOM.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
  }), true, 'return from playback must track the replaced header and its late size change');
  await buttons.nth(1).click();
  await page.waitForFunction(() => window.__pageDOM.querySelector('#ytg-browse-categories button[aria-pressed=true]')?.textContent === 'Music');
  mkdirSync('output/playwright', { recursive: true });
  await page.screenshot({ path: 'output/playwright/categories-fullscreen-layout.png' });
  await page.evaluate(() => {
    const dialog = document.createElement('div'); dialog.id = 'layout-dialog'; dialog.setAttribute('role', 'dialog');
    dialog.style.cssText = 'position:fixed;inset:0;z-index:2200;background:white'; document.body.append(dialog);
  });
  assert.equal(await buttons.first().evaluate(button => {
    const r = button.getBoundingClientRect();
    return window.__pageDOM.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.id;
  }), 'layout-dialog', 'native dialogs must still appear above the browse surface');
});

test('SPA return keeps category, continuation cards, video identity and inner scroll with content-sized card titles', { timeout: 30000 }, async t => {
  const feedFixture = { chips: ['All', 'Music'].map((label, i) => ({ chipCloudChipRenderer: {
      text: { simpleText: label }, isSelected: i === 0,
      navigationEndpoint: { browseEndpoint: { browseId: i ? 'music' : 'FEwhat_to_watch' } }
    } })) };

  const page = await browserPage(t);
  const requests = [];
  await page.route('https://i.ytimg.com/**', route => route.abort());
  await page.route('https://www.youtube.com/**', route => {
    if (!route.request().url().includes('/youtubei/')) return route.fulfill({ contentType: 'text/html', body: '<html><head><style>body{margin:0}ytd-masthead{position:fixed;top:0;left:0;right:0;height:56px;background:white;z-index:2000}</style></head><body><ytd-masthead></ytd-masthead><ytd-page-manager></ytd-page-manager></body></html>' });
    const body = route.request().postDataJSON();
    const key = body.continuation || body.browseId; requests.push(key);
    const videos = Array.from({ length: 40 }, (_, i) => ({ videoRenderer: {
      videoId: `${key}-${i}`, title: { simpleText: i % 2 ? 'Long video title '.repeat(30) : 'Short' },
      ownerText: { simpleText: 'Channel name '.repeat(30) }
    } }));
    return route.fulfill({ json: { ...feedFixture,  onResponseReceivedActions: [{ reloadContinuationItemsCommand: { continuationItems: [
      ...videos, ...(key === 'music' ? [{ continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: 'next' } } } }] : [])
    ] } }]  } });
  });
  await page.goto('https://www.youtube.com/');
  await page.evaluate(() => {
    window.ytcfg = { get: name => ({ INNERTUBE_CONTEXT: { client: { clientName: 'WEB', clientVersion: 'test' } } })[name] };

  });
  await mainBundle(page);
  const grid = page.locator('#ytg-browse-grid');
  await grid.locator('[data-browse-id="video:FEwhat_to_watch-0"]').waitFor();
  // API categories must remain below the masthead without a native chip bar.
  const categoryLayout = await grid.locator('#ytg-browse-categories button').first().evaluate(button => {
    const bar = button.closest('nav').getBoundingClientRect();
    const bounds = button.getBoundingClientRect();
    const masthead = window.__pageDOM.querySelector('ytd-masthead').getBoundingClientRect();
    return { belowHeader: bar.top >= masthead.bottom,
      contained: bounds.top >= bar.top && bounds.bottom <= bar.bottom,
      margin: getComputedStyle(button).marginTop,
      hit: button.contains(window.__pageDOM.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)) };
  });
  assert.deepEqual(categoryLayout, { belowHeader: true, contained: true, margin: '0px', hit: true });
  // YouTube mounts an opaque, higher-layer chip wrapper after initial data.
  await page.evaluate(() => {
    const nativeBar = document.createElement('ytd-feed-filter-chip-bar-renderer');
    nativeBar.style.cssText = 'position:fixed;top:56px;left:0;right:0;height:56px;background:white;z-index:2000';
    nativeBar.innerHTML = '<div id="chips-wrapper" style="height:56px;background:white"><yt-chip-cloud-chip-renderer>Native</yt-chip-cloud-chip-renderer></div>';
    window.__pageDOM.querySelector('ytd-page-manager').append(nativeBar);
  });
  await page.waitForTimeout(250);
  assert.equal(await grid.locator('#ytg-browse-categories button').first().evaluate(button => {
    const bounds = button.getBoundingClientRect();
    return button.contains(window.__pageDOM.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2));
  }), true, 'native category wrapper must not cover the custom category buttons');
  await grid.getByRole('button', { name: 'Music', exact: true }).click();
  await grid.locator('[data-browse-id="video:music-0"]').waitFor();
  // Scrolling this button into view can auto-load the final page and remove it before the click.
  await grid.getByRole('button', { name: /^(Load more videos|加载更多视频)$/ }).dispatchEvent('click');
  const target = grid.locator('[data-browse-id="video:next-20"]');
  await target.waitFor(); await target.focus();
  const before = await page.evaluate(() => {
    const scroller = window.__pageDOM.querySelector('#ytg-browse-grid [data-ytg-browse-grid]');
    const cards = [...window.__pageDOM.querySelectorAll('#ytg-browse-grid a[data-browse-id]')];
    return { scroll: scroller.scrollTop, heights: cards.slice(0, 2).map(card => card.getBoundingClientRect().height),
      titles: cards.slice(0, 2).map(card => card.querySelector('strong').getBoundingClientRect().height),
      clamp: getComputedStyle(cards[1].querySelector('strong')).webkitLineClamp,
      channel: getComputedStyle(cards[0].querySelector('.channel')).textOverflow };
  });
  assert.ok(before.scroll > 0);
  assert.ok(Math.abs(before.titles[1] - before.titles[0] - 22) < .1);
  assert.ok(Math.abs(before.heights[1] - before.heights[0] - 22) < .1);
  assert.equal(before.clamp, '2'); assert.equal(before.channel, 'ellipsis');
  const count = requests.length;
  await page.evaluate(() => {
    document.dispatchEvent(new Event('yt-navigate-start'));
    history.pushState({}, '', '/watch?v=next-20');
    document.dispatchEvent(new Event('yt-navigate-finish'));
  });
  await grid.waitFor({ state: 'hidden' });
  await page.evaluate(() => {
    document.dispatchEvent(new Event('yt-navigate-start'));
    history.replaceState({}, '', '/');
    document.dispatchEvent(new Event('yt-navigate-finish'));
  });
  await target.waitFor();
  await page.waitForFunction(() => window.__pageDOM.activeElement?.getAttribute('data-browse-id') === 'video:next-20');
  assert.equal(await grid.getByRole('button', { name: 'Music', exact: true }).getAttribute('aria-pressed'), 'true');
  const after = await grid.locator('[data-ytg-browse-grid]').evaluate(node => node.scrollTop);
  assert.ok(Math.abs(after - before.scroll) <= 1, `scroll ${before.scroll} -> ${after}`);
  assert.equal(requests.length, count, 'return reuses the loaded category and continuation');
  await page.evaluate(() => window.postMessage({ source: 'yt-gamepad-settings', values: { enabled: false } }, location.origin));
  await grid.waitFor({ state: 'hidden' });
  assert.equal(await page.locator('ytd-feed-filter-chip-bar-renderer').evaluate(node => getComputedStyle(node).visibility), 'visible');
  assert.equal(await page.locator('#chips-wrapper').evaluate(node => getComputedStyle(node).visibility), 'visible');
});

for (const [path, browseId, sidebarId] of [
  ['/', 'FEwhat_to_watch', 'home'],
  ['/feed/subscriptions', 'FEsubscriptions', 'subscriptions'],
  ['/feed/history', 'FEhistory', 'history'],
  ['/playlist?list=WL', 'VLWL', 'later']
]) {
test(`opening an API card and returning restores ${browseId}`, { timeout: 30000 }, async t => {
  const feedFixture = { chipCloudChipRenderer: { text: { simpleText: 'All' }, isSelected: true,
      navigationEndpoint: { browseEndpoint: { browseId } } } };

  const page = await browserPage(t);
  let documents = 0, requests = 0;
  await page.route('https://i.ytimg.com/**', route => route.abort());
  await page.route('https://www.youtube.com/**', route => {
    if (route.request().url().includes('/youtubei/')) {
      requests++;
      assert.equal(route.request().postDataJSON().browseId, browseId);
      const renderer = browseId === 'VLWL' ? 'playlistVideoRenderer' : 'videoRenderer';
      return route.fulfill({ json: { ...feedFixture,  contents: ['cached', 'other'].map(videoId => ({ [renderer]: {
        videoId, title: { simpleText: `Video ${videoId}` },
        ...(browseId === 'VLWL' ? { navigationEndpoint: { watchEndpoint: { videoId, playlistId: 'WL' } } } : {})
      } }))  } });
    }
    documents++;
    return route.fulfill({ contentType: 'text/html', body: '<html><body><ytd-app><ytd-page-manager></ytd-page-manager></ytd-app></body></html>' });
  });
  await page.goto('https://www.youtube.com' + path);
  await page.evaluate(browseId => {
    window.__documentIdentity = 'original';
    window.ytcfg = { get: () => ({ client: { clientVersion: 'test' } }) };

    window.__pageDOM.querySelector('ytd-app').navigate_ = endpoint => {
      document.dispatchEvent(new Event('yt-navigate-start'));
      history.pushState({}, '', endpoint.commandMetadata.webCommandMetadata.url);
      document.dispatchEvent(new Event('yt-navigate-finish'));
    };
    window.addEventListener('popstate', () => {
      document.dispatchEvent(new Event('yt-navigate-start'));
      document.dispatchEvent(new Event('yt-navigate-finish'));
    });
  }, browseId);
  await mainBundle(page);
  const identity = browseId === 'VLWL' ? 'playlist:WL:cached' : 'video:cached';
  const card = page.locator(`[data-browse-id="${identity}"]`);
  await card.waitFor();
  assert.equal(await page.locator(`#ytg-browse-sidebar [data-sidebar-id="${sidebarId}"]`).getAttribute('aria-current'), 'page');
  await card.focus();
  await page.evaluate(direction => window.YTGamepad.act(direction), ['FEhistory', 'VLWL'].includes(browseId) ? 'down' : 'right');
  assert.ok((await page.evaluate(() => window.__pageDOM.activeElement?.getAttribute('data-browse-id'))).endsWith(':other'));
  await page.evaluate(direction => window.YTGamepad.act(direction), ['FEhistory', 'VLWL'].includes(browseId) ? 'up' : 'left');
  assert.equal(await page.evaluate(() => window.__pageDOM.activeElement?.getAttribute('data-browse-id')), identity);
  await card.click();
  await page.waitForURL(browseId === 'VLWL' ? '**/watch?v=cached&list=WL' : '**/watch?v=cached');
  await page.locator('#ytg-browse-grid').waitFor({ state: 'hidden' });
  await page.evaluate(() => history.back());
  await page.waitForURL('https://www.youtube.com' + path);
  await card.waitFor();
  await page.waitForFunction(id => window.__pageDOM.activeElement?.getAttribute('data-browse-id') === id, identity);
  assert.equal(await page.evaluate(() => window.__documentIdentity), 'original');
  assert.equal(documents, 1);
  assert.equal(requests, 1, 'back navigation restores without refetching');
});
}

test('category navigation and hover wait for controller confirmation or a mouse click', { timeout: 30000 }, async t => {
  const page = await browserPage(t);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const calls = [];
  const chips = ['All', 'Music', 'Gaming'].map((label, index) => ({ chipCloudChipRenderer: {
    text: { simpleText: label }, isSelected: index === 0,
    navigationEndpoint: { browseEndpoint: { browseId: index ? label.toLowerCase() : 'FEwhat_to_watch' } }
  } }));
  await page.route('https://i.ytimg.com/**', route => route.abort());
  await page.route('https://www.youtube.com/**', route => {
    if (!route.request().url().includes('/youtubei/')) return route.fulfill({ contentType: 'text/html',
      body: '<html><body><ytd-masthead></ytd-masthead><ytd-page-manager></ytd-page-manager></body></html>' });
    const body = route.request().postDataJSON(); calls.push(body.browseId);
    return route.fulfill({ json: { contents: [...chips,
      { videoRenderer: { videoId: body.browseId, title: { simpleText: body.browseId } } }
    ] } });
  });
  await page.goto('https://www.youtube.com/');
  await page.evaluate(() => { window.ytcfg = { get: key => key === 'INNERTUBE_CONTEXT' ? { client: { clientVersion: 'test' } } : undefined }; });
  await mainBundle(page);
  const bar = page.locator('#ytg-browse-categories');
  const active = bar.locator('button[aria-pressed="true"]');
  await page.locator('[data-browse-id="video:FEwhat_to_watch"]').waitFor();
  const press = async button => {
    await page.evaluate(index => { window.__browsePad.buttons[index].pressed = true; }, button);
    await page.waitForTimeout(80);
    await page.evaluate(index => { window.__browsePad.buttons[index].pressed = false; }, button);
    await page.waitForTimeout(50);
  };
  await bar.locator('[data-ytg-category]').first().evaluate(node => window.YTGamepad.focus(node));
  const initialCalls = calls.length;
  await press(15);
  assert.equal(await bar.locator('.ytg-selected button').textContent(), 'Music');
  assert.equal(await active.textContent(), 'All');
  assert.equal(calls.length, initialCalls, 'directional focus does not request a new list');
  assert.equal(await page.locator('[data-browse-id="video:FEwhat_to_watch"]').count(), 1);
  const focused = bar.getByRole('button', { name: 'Music', exact: true });
  assert.equal(await focused.evaluate(node => getComputedStyle(node).outlineStyle), 'none');
  assert.notEqual(await focused.evaluate(node => getComputedStyle(node).boxShadow), 'none');
  mkdirSync('output/playwright', { recursive: true });
  await bar.screenshot({ path: 'output/playwright/category-focus-before-confirm.png' });
  await page.evaluate(() => document.documentElement.setAttribute('dark', ''));
  assert.equal(await focused.evaluate(node => getComputedStyle(node).outlineStyle), 'none');
  assert.notEqual(await focused.evaluate(node => getComputedStyle(node).boxShadow), 'none', 'dark-theme navigation retains the shared shadow');
  await bar.screenshot({ path: 'output/playwright/category-focus-dark.png' });
  await page.evaluate(() => document.documentElement.removeAttribute('dark'));
  await press(0);
  await page.locator('[data-browse-id="video:music"]').waitFor();
  assert.equal(await active.textContent(), 'Music');
  assert.equal(calls.filter(id => id === 'music').length, 1);
  await press(15);
  assert.equal(await bar.locator('.ytg-selected button').textContent(), 'Gaming');
  assert.equal(await active.textContent(), 'Music');
  assert.equal(calls.filter(id => id === 'gaming').length, 0);
  const appearance = node => {
    const style = getComputedStyle(node);
    return { background: style.backgroundColor, color: style.color, shadow: style.boxShadow, outline: style.outlineStyle };
  };
  const gamepadAppearance = await bar.getByRole('button', { name: 'Gaming', exact: true }).evaluate(appearance);
  await page.mouse.move(500, 400);
  const gaming = bar.getByRole('button', { name: 'Gaming', exact: true });
  await gaming.hover();
  await page.waitForFunction(() => window.YTGamepadInput.mode === 'mouse');
  await gaming.focus();
  assert.equal(await active.textContent(), 'Music');
  assert.equal(calls.filter(id => id === 'gaming').length, 0, 'hover and DOM focus do not activate a filter');
  assert.equal(await gaming.evaluate(node => getComputedStyle(node).outlineStyle), 'none');
  assert.deepEqual(await gaming.evaluate(appearance), gamepadAppearance, 'mouse hover and gamepad selection share the same appearance');
  await bar.screenshot({ path: 'output/playwright/category-hover-before-click.png' });
  await gaming.click();
  await page.locator('[data-browse-id="video:gaming"]').waitFor();
  assert.equal(await active.textContent(), 'Gaming');
  assert.equal(calls.filter(id => id === 'gaming').length, 1);
});

test('Vue categories request feed data, discard stale switches, paginate and retry without native clicks', { timeout: 30000 }, async t => {
  const feedFixture = { chips: ['All', 'Music', 'Gaming', 'Error'].map((label, index) => ({ chipCloudChipRenderer: {
      text: { simpleText: label }, isSelected: index === 0,
      navigationEndpoint: { browseEndpoint: { browseId: index === 0 ? 'FEwhat_to_watch' : label.toLowerCase() } }
    } })) };

  const page = await browserPage(t);
  const calls = [];
  let fail = true;
  await page.route('https://i.ytimg.com/**', route => route.abort());
  await page.route('https://www.youtube.com/**', async route => {
    if (!route.request().url().includes('/youtubei/')) return route.fulfill({ contentType: 'text/html', body:
      '<html><body><ytd-feed-filter-chip-bar-renderer><yt-chip-cloud-chip-renderer><button>Native</button></yt-chip-cloud-chip-renderer></ytd-feed-filter-chip-bar-renderer><ytd-page-manager><ytd-rich-item-renderer><a id="thumbnail" href="/watch?v=native">Native video</a></ytd-rich-item-renderer></ytd-page-manager></body></html>' });
    const body = route.request().postDataJSON(); calls.push(body);
    const key = body.continuation || body.browseId;
    if (key === 'music') await new Promise(resolve => setTimeout(resolve, 350));
    if (key === 'error' && fail) return route.fulfill({ status: 500, body: '{}' });
    const video = { videoRenderer: { videoId: key === 'FEwhat_to_watch' ? 'all' : key,
      title: { simpleText: key }, ownerText: { simpleText: 'Channel' } } };
    return route.fulfill({ json: { ...feedFixture,  onResponseReceivedActions: [{ reloadContinuationItemsCommand: { continuationItems: [video,
      ...(key === 'gaming' ? Array.from({ length: 18 }, (_, i) => ({ videoRenderer: {
        videoId: `gaming-${i}`, title: { simpleText: `Gaming ${i}` }
      } })) : []),
      ...(key === 'gaming' ? [{ continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: 'more' } } } }] : [])] } }]  } });
  });
  await page.goto('https://www.youtube.com/');
  await page.evaluate(() => {
    window.ytcfg = { get: name => ({ INNERTUBE_CONTEXT: { client: { clientName: 'WEB', clientVersion: 'test' } } })[name] };

    window.__nativeClicks = 0;
    window.__pageDOM.querySelector('ytd-feed-filter-chip-bar-renderer button').onclick = () => ++window.__nativeClicks;
  });
  await mainBundle(page);
  const grid = page.locator('#ytg-browse-grid');
  const bar = grid.locator('#ytg-browse-categories');
  await grid.locator('[data-browse-id="video:all"]').waitFor();
  await bar.locator('[data-ytg-category]').first().evaluate(node => window.YTGamepad.focus(node));
  await page.evaluate(() => { window.YTGamepad.act('right'); window.YTGamepad.act('confirm'); });
  await page.waitForFunction(() => window.__pageDOM.querySelector('#ytg-browse-categories button[aria-pressed="true"]')?.textContent === 'Music');
  await page.evaluate(() => { window.YTGamepad.act('right'); window.YTGamepad.act('confirm'); });
  await grid.locator('[data-browse-id="video:gaming"]').waitFor();
  assert.equal(await bar.locator('.ytg-selected button').textContent(), 'Gaming');
  assert.equal(await bar.locator('button[aria-pressed="true"]').textContent(), 'Gaming');
  await page.waitForTimeout(450);
  assert.equal(await grid.locator('[data-browse-id="video:music"]').count(), 0);
  assert.equal(await grid.locator('[data-browse-id="video:native"]').count(), 0);
  // Scrolling this footer into view can itself start automatic pagination.
  await grid.getByRole('button', { name: /^(Load more videos|加载更多视频)$/ }).evaluate(node => node.click());
  await grid.locator('[data-browse-id="video:more"]').waitFor();
  assert.equal(await grid.locator('[data-browse-id="video:gaming"]').count(), 1);
  await bar.getByRole('button', { name: 'Error', exact: true }).click();
  await grid.getByRole('alert').waitFor();
  fail = false;
  await grid.getByRole('button', { name: '重试' }).click();
  await grid.locator('[data-browse-id="video:error"]').waitFor();
  assert.equal(await page.evaluate(() => window.__nativeClicks), 0);
  assert.ok(calls.some(body => body.continuation === 'more'));
  assert.ok(calls.every(body => body.context.client.clientName === 'WEB'));
  await page.evaluate(() => window.postMessage({ source: 'yt-gamepad-settings', values: { enabled: false } }, location.origin));
  await grid.waitFor({ state: 'hidden' });
  assert.equal(await page.locator('ytd-feed-filter-chip-bar-renderer yt-chip-cloud-chip-renderer').evaluate(node => getComputedStyle(node).visibility), 'visible');
});

test('unsupported routes stay empty and ignore native cards and mutations', { timeout: 30000 }, async t => {
  const page = await browserPage(t);
  let requests = 0;
  await page.route('https://www.youtube.com/**', route => {
    if (route.request().url().includes('/youtubei/')) { requests++; return route.fulfill({ json: { contents: [] } }); }
    return route.fulfill({ contentType: 'text/html', body:
      '<html><body><ytd-page-manager><ytd-browse><ytd-rich-item-renderer><a id="thumbnail" href="/watch?v=native"><h3>Native video</h3></a></ytd-rich-item-renderer></ytd-browse></ytd-page-manager></body></html>' });
  });
  await page.goto('https://www.youtube.com/feed/custom');
  await page.evaluate(() => {
    window.ytcfg = { get: key => key === 'INNERTUBE_CONTEXT' ? { client: { clientVersion: 'test' } } : undefined };
    Object.defineProperty(window, 'ytInitialData', { get() { throw Error('Startup JSON read'); } });
  });
  await mainBundle(page);
  const grid = page.locator('[data-ytg-browse-grid]');
  await grid.waitFor();
  assert.equal(await grid.locator('[data-browse-id]').count(), 0);
  await page.evaluate(() => {
    document.querySelector('ytd-page-manager h3').textContent = 'Changed native video';
    document.dispatchEvent(new Event('yt-page-data-updated'));
  });
  await page.waitForTimeout(250);
  assert.equal(await grid.locator('[data-browse-id]').count(), 0);
  assert.equal(await grid.locator('.feed-skeleton').count(), 0);
  assert.equal(requests, 0);
});


test('Home sidebar and YouTube brand each request a fresh recommendation batch', async t => {
  const page = await browserPage(t);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  t.after(() => release());
  let batches = 0;
  await page.route('https://www.youtube.com/**', async route => {
    if (route.request().url().includes('/youtubei/')) {
      const body = route.request().postDataJSON();
      if (body?.browseId === 'FEwhat_to_watch') {
        batches++;
        if (batches === 3) await gate;
        return route.fulfill({ json: { contents: [modernVideo('batch' + batches)] } });
      }
      return route.fulfill({ json: {} });
    }
    return route.fulfill({ contentType: 'text/html', body: '<html><body><ytd-page-manager></ytd-page-manager></body></html>' });
  });
  await page.goto('https://www.youtube.com/');
  await page.evaluate(() => { window.ytcfg = { get: key => key === 'INNERTUBE_CONTEXT' ? { client: { clientVersion: 'test' } } : undefined }; });
  await mainBundle(page, guideData());
  await page.locator('[data-browse-id="video:batch1"]').waitFor();
  await page.locator('[data-sidebar-id="home"]').click();
  await page.locator('[data-browse-id="video:batch2"]').waitFor();
  assert.equal(await page.locator('[data-browse-id="video:batch1"]').count(), 0);
  await page.waitForFunction(() => getComputedStyle(window.__pageDOM.querySelector('[data-ytg-browse-grid] .cards')).opacity === '1');
  await page.evaluate(() => {
    window.__retainedHomeCard = window.__pageDOM.querySelector('[data-browse-id="video:batch2"]');
    window.__homeRefreshFrames = [];
    window.__recordHomeRefresh = true;
    const sample = () => {
      if (!window.__recordHomeRefresh) return;
      const cards = window.__pageDOM.querySelector('[data-ytg-browse-grid] .cards');
      const root = window.__pageDOM.querySelector('#ytg-browse-grid');
      window.__homeRefreshFrames.push({ count: cards?.querySelectorAll('[data-browse-id]').length || 0,
        opacity: cards && getComputedStyle(cards).opacity, hidden: !root || root.hidden });
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await page.locator('.client-brand').click();
  await page.locator('.home-loading-line').waitFor();
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => window.__pageDOM.querySelector('[data-browse-id="video:batch2"]') === window.__retainedHomeCard), true);
  assert.equal(await page.locator('.feed-skeleton').count(), 0, 'refresh preserves the current batch instead of displaying a skeleton screen');
  release();
  await page.locator('[data-browse-id="video:batch3"]').waitFor();
  assert.equal(await page.locator('.home-loading-line').count(), 0);
  const frames = await page.evaluate(() => { window.__recordHomeRefresh = false; return window.__homeRefreshFrames; });
  assert.ok(frames.length > 0);
  assert.ok(frames.every(frame => frame.count > 0 && frame.opacity === '1' && !frame.hidden), JSON.stringify(frames));
  assert.equal(batches, 3);
  assert.equal(await page.locator('[data-browse-id="video:batch2"]').count(), 0);
});
