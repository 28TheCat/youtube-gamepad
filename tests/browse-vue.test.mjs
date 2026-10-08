import { test } from 'node:test';
import assert from 'node:assert/strict';
import { browserPage } from './helpers/bundles.mjs';
import { mainFixture } from './helpers/main-bundle.mjs';
import { fixture } from './helpers/extension.mjs';

async function mainBundle(page) {
  await page.evaluate(() => {
    const pad = { connected: true, mapping: 'standard', index: 0, id: 'test', axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0, touched: false })) };
    window.__browsePad = pad;
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [pad] });
  });
  await page.addScriptTag({ content: await mainFixture() });
  await page.evaluate(() => window.postMessage({ source: 'yt-gamepad-settings',
    values: { enabled: true, theater: true } }, location.origin));
}

test('SPA return keeps category, continuation cards, video identity and inner scroll; card text has stable height', { timeout: 30000 }, async t => {
  const page = await browserPage(t);
  const requests = [];
  await page.route('https://i.ytimg.com/**', route => route.abort());
  await page.route('https://www.youtube.com/**', route => {
    if (!route.request().url().includes('/youtubei/')) return route.fulfill({ contentType: 'text/html', body: '<html><body><ytd-page-manager></ytd-page-manager></body></html>' });
    const body = route.request().postDataJSON();
    const key = body.continuation || body.browseId; requests.push(key);
    const videos = Array.from({ length: 40 }, (_, i) => ({ videoRenderer: {
      videoId: `${key}-${i}`, title: { simpleText: i % 2 ? 'Long video title '.repeat(30) : 'Short' },
      ownerText: { simpleText: 'Channel name '.repeat(30) }
    } }));
    return route.fulfill({ json: { onResponseReceivedActions: [{ reloadContinuationItemsCommand: { continuationItems: [
      ...videos, ...(key === 'music' ? [{ continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: 'next' } } } }] : [])
    ] } }] } });
  });
  await page.goto('https://www.youtube.com/');
  await page.evaluate(() => {
    window.ytcfg = { get: name => ({ INNERTUBE_CONTEXT: { client: { clientName: 'WEB', clientVersion: 'test' } } })[name] };
    window.ytInitialData = { chips: ['All', 'Music'].map((label, i) => ({ chipCloudChipRenderer: {
      text: { simpleText: label }, isSelected: i === 0,
      navigationEndpoint: { browseEndpoint: { browseId: i ? 'music' : 'FEwhat_to_watch' } }
    } })) };
  });
  await mainBundle(page);
  const grid = page.locator('#ytg-browse-grid');
  await grid.locator('[data-browse-id="video:FEwhat_to_watch-0"]').waitFor();
  await grid.getByRole('button', { name: 'Music', exact: true }).click();
  await grid.locator('[data-browse-id="video:music-0"]').waitFor();
  await grid.getByRole('button', { name: 'Load more videos' }).click();
  const target = grid.locator('[data-browse-id="video:next-20"]');
  await target.waitFor(); await target.focus();
  const before = await page.evaluate(() => {
    const scroller = document.querySelector('#ytg-browse-grid [data-ytg-browse-grid]');
    const cards = [...document.querySelectorAll('#ytg-browse-grid a[data-browse-id]')];
    return { scroll: scroller.scrollTop, heights: cards.slice(0, 2).map(card => card.getBoundingClientRect().height),
      titles: cards.slice(0, 2).map(card => card.querySelector('strong').getBoundingClientRect().height),
      clamp: getComputedStyle(cards[1].querySelector('strong')).webkitLineClamp,
      channel: getComputedStyle(cards[0].querySelector('.channel')).textOverflow };
  });
  assert.ok(before.scroll > 0);
  assert.equal(before.heights[0], before.heights[1]); assert.equal(before.titles[0], before.titles[1]);
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
  await page.waitForFunction(() => document.activeElement?.getAttribute('data-browse-id') === 'video:next-20');
  assert.equal(await grid.getByRole('button', { name: 'Music', exact: true }).getAttribute('aria-pressed'), 'true');
  const after = await grid.locator('[data-ytg-browse-grid]').evaluate(node => node.scrollTop);
  assert.ok(Math.abs(after - before.scroll) <= 1, `scroll ${before.scroll} -> ${after}`);
  assert.equal(requests.length, count, 'return reuses the loaded category and continuation');
});

test('Vue categories request feed data, discard stale switches, paginate and retry without native clicks', { timeout: 30000 }, async t => {
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
    return route.fulfill({ json: { onResponseReceivedActions: [{ reloadContinuationItemsCommand: { continuationItems: [video,
      ...(key === 'gaming' ? [{ continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: 'more' } } } }] : [])] } }] } });
  });
  await page.goto('https://www.youtube.com/');
  await page.evaluate(() => {
    window.ytcfg = { get: name => ({ INNERTUBE_CONTEXT: { client: { clientName: 'WEB', clientVersion: 'test' } } })[name] };
    window.ytInitialData = { chips: ['All', 'Music', 'Gaming', 'Error'].map((label, index) => ({ chipCloudChipRenderer: {
      text: { simpleText: label }, isSelected: index === 0,
      navigationEndpoint: { browseEndpoint: { browseId: index === 0 ? 'FEwhat_to_watch' : label.toLowerCase() } }
    } })) };
    window.__nativeClicks = 0;
    document.querySelector('ytd-feed-filter-chip-bar-renderer button').onclick = () => ++window.__nativeClicks;
  });
  await mainBundle(page);
  const grid = page.locator('#ytg-browse-grid');
  const bar = grid.locator('#ytg-browse-categories');
  await grid.locator('[data-browse-id="video:all"]').waitFor();
  await page.evaluate(() => window.YTGamepad.act('seekForward'));
  await page.waitForFunction(() => document.querySelector('#ytg-browse-categories button[aria-pressed="true"]')?.textContent === 'Music');
  await bar.getByRole('button', { name: 'Gaming', exact: true }).click();
  await grid.locator('[data-browse-id="video:gaming"]').waitFor();
  await page.waitForTimeout(450);
  assert.equal(await grid.locator('[data-browse-id="video:music"]').count(), 0);
  assert.equal(await grid.locator('[data-browse-id="video:native"]').count(), 0);
  await grid.getByRole('button', { name: 'Load more videos' }).click();
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

test('browse loads late thumbnails, retries failed sources and keeps placeholder geometry', { timeout: 30000 }, async t => {
  const page = await browserPage(t);
  await page.route('https://i.ytimg.com/**', route => route.fulfill({ contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270"><rect width="480" height="270" fill="green"/></svg>' }));
  await page.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html',
    body: '<html><body><ytd-page-manager><ytd-rich-item-renderer><a id="thumbnail" href="/watch?v=late"><img src="data:image/gif;base64,placeholder"></a><h3>Late video</h3></ytd-rich-item-renderer></ytd-page-manager></body></html>' }));
  await page.goto('https://www.youtube.com/');
  await mainBundle(page);
  const card = page.locator('#ytg-browse-grid [data-browse-id="video:late"]');
  await card.waitFor();
  await page.waitForFunction(() => {
    const image = document.querySelector('#ytg-browse-grid img');
    return image?.complete && image.naturalWidth > 0;
  });
  assert.equal(await card.locator('img').getAttribute('src'), 'https://i.ytimg.com/vi/late/hqdefault.jpg');
  await page.evaluate(() => document.querySelector('ytd-page-manager img').setAttribute('data-src', 'https://i.ytimg.com/vi/late/custom.jpg'));
  await page.waitForFunction(() => document.querySelector('#ytg-browse-grid img')?.getAttribute('src')?.endsWith('/custom.jpg'));
  await card.locator('img').dispatchEvent('error');
  await page.waitForFunction(() => document.querySelector('#ytg-browse-grid img')?.getAttribute('src')?.endsWith('/hqdefault.jpg'));
  await card.locator('img').dispatchEvent('error');
  await card.locator('.thumbnail-placeholder').waitFor();
  await page.evaluate(() => document.querySelector('ytd-page-manager img').setAttribute('data-src', 'https://i.ytimg.com/vi/late/recovered.jpg'));
  await card.locator('img').waitFor();
  assert.equal(await card.locator('.thumbnail-placeholder').count(), 0);
});

test('Vue browse owns a separate grid, hides native cards immediately and preserves focus across updates', { timeout: 30000 }, async t => {
  const page = await browserPage(t);
  await page.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html',
    body: fixture.replace('<ytd-rich-item-renderer>', '<ytd-page-manager><ytd-rich-item-renderer>')
      .replace('</body>', '</ytd-page-manager></body>') }));
  await page.goto('https://www.youtube.com/');
  await mainBundle(page);
  const grid = page.locator('#ytg-browse-grid');
  await grid.locator('[data-browse-id="video:a"]').waitFor();
  assert.equal(await page.locator('ytd-rich-item-renderer').first().evaluate(node => getComputedStyle(node).visibility), 'hidden');
  assert.equal(await page.locator('ytd-rich-item-renderer').count(), 2);
  await grid.locator('[data-browse-id="video:a"]').focus();
  await page.evaluate(() => { window.__browsePad.buttons[15].pressed = true; });
  await page.waitForFunction(() => document.activeElement?.getAttribute('data-browse-id') === 'video:b');
  await page.evaluate(() => { window.__browsePad.buttons[15].pressed = false; });
  await grid.locator('[data-browse-id="video:b"]').focus();
  await page.evaluate(() => {
    const source = document.querySelector('ytd-page-manager');
    const card = document.createElement('ytd-rich-item-renderer');
    const anchor = document.createElement('a'); anchor.id = 'thumbnail'; anchor.href = '/watch?v=c'; anchor.textContent = 'C';
    card.append(anchor); source.prepend(card);
  });
  await grid.locator('[data-browse-id="video:c"]').waitFor();
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-browse-id')), 'video:b');
  await page.evaluate(() => {
    window.__nativeBrowseOpens = 0;
    document.querySelector('ytd-page-manager a[href="/watch?v=b"]').addEventListener('click', event => {
      event.preventDefault(); window.__nativeBrowseOpens++;
    });
    window.__browsePad.buttons[0].pressed = true;
  });
  await page.waitForFunction(() => window.__nativeBrowseOpens === 1);
  await page.evaluate(() => { window.__browsePad.buttons[0].pressed = false; });
  await page.evaluate(() => window.postMessage({ source: 'yt-gamepad-settings', values: { enabled: false } }, location.origin));
  await grid.waitFor({ state: 'hidden' });
  assert.equal(await page.locator('ytd-rich-item-renderer').first().evaluate(node => getComputedStyle(node).visibility), 'visible');
});

test('browse takeover hides unready native cards, then reads later data and native continuation', { timeout: 30000 }, async t => {
  const page = await browserPage(t);
  await page.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html',
    body: '<html><body><ytd-page-manager><ytd-rich-item-renderer><a id="thumbnail" href="/watch?v=late"></a></ytd-rich-item-renderer><ytd-continuation-item-renderer><button>Continue</button></ytd-continuation-item-renderer></ytd-page-manager></body></html>' }));
  await page.goto('https://www.youtube.com/');
  await mainBundle(page);
  const grid = page.locator('#ytg-browse-grid');
  await grid.getByRole('status').waitFor();
  assert.equal(await page.locator('ytd-rich-item-renderer').evaluate(node => getComputedStyle(node).visibility), 'hidden');
  await page.evaluate(() => {
    document.querySelector('a#thumbnail').textContent = 'Late video';
    document.querySelector('ytd-continuation-item-renderer button').addEventListener('click', () => {
      const card = document.createElement('ytd-rich-item-renderer');
      const link = document.createElement('a'); link.id = 'thumbnail'; link.href = '/watch?v=next'; link.textContent = 'Next';
      card.append(link); document.querySelector('ytd-page-manager').append(card);
    });
  });
  await grid.locator('[data-browse-id="video:late"]').waitFor();
  await grid.getByRole('button', { name: 'Load more videos' }).click();
  await grid.locator('[data-browse-id="video:next"]').waitFor();
});

test('browse preloads three continuation pages and batches further requests without duplicate loading', { timeout: 30000 }, async t => {
  const page = await browserPage(t);
  await page.route('https://i.ytimg.com/**', route => route.abort());
  await page.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html',
    body: '<html><body><ytd-page-manager><ytd-rich-item-renderer><a id="thumbnail" href="/watch?v=first">First</a></ytd-rich-item-renderer><ytd-continuation-item-renderer><button>Continue</button></ytd-continuation-item-renderer></ytd-page-manager></body></html>' }));
  await page.goto('https://www.youtube.com/');
  await page.evaluate(() => {
    window.__loads = 0;
    document.querySelector('ytd-continuation-item-renderer button').addEventListener('click', () => {
      const count = ++window.__loads;
      setTimeout(() => {
        const card = document.createElement('ytd-rich-item-renderer');
        const anchor = document.createElement('a');
        anchor.id = 'thumbnail'; anchor.href = '/watch?v=batch' + count; anchor.textContent = 'Batch ' + count;
        card.append(anchor); document.querySelector('ytd-page-manager').append(card);
      }, 50);
    });
  });
  await mainBundle(page);
  const grid = page.locator('#ytg-browse-grid');
  await grid.locator('[data-browse-id="video:batch3"]').waitFor();
  await page.waitForTimeout(1800);
  assert.equal(await page.evaluate(() => window.__loads), 3);
  const more = grid.getByRole('button', { name: 'Load more videos' });
  await more.click(); await more.click();
  await grid.locator('[data-browse-id="video:batch6"]').waitFor();
  await page.waitForTimeout(1800);
  assert.equal(await page.evaluate(() => window.__loads), 6);
});
