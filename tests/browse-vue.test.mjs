import { test } from 'node:test';
import assert from 'node:assert/strict';
import { browserPage } from './helpers/bundles.mjs';
import { mainFixture } from './helpers/main-bundle.mjs';
import { fixture } from './helpers/extension.mjs';
import { mkdirSync, readFileSync } from 'node:fs';

for (const reducedMotion of ['no-preference', 'reduce']) {
  test(`browse motion preserves focus geometry, loading and folded navigation (${reducedMotion})`, { timeout: 30000 }, async t => {
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
      return route.fulfill({ json: { contents: [
        ...Array.from({ length: 6 }, (_, i) => ({ videoRenderer: { videoId: `${category}-${i}`, title: { simpleText: `${category} ${i}` } } })),
        { continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: 'more' } } } }
      ] } });
    });
    await page.goto('https://www.youtube.com/');
    await page.evaluate(() => {
      window.ytcfg = { get: () => ({ client: { clientName: 'WEB', clientVersion: 'test' } }) };
      window.ytInitialData = { chips: ['All', 'Music'].map((label, i) => ({ chipCloudChipRenderer: {
        text: { simpleText: label }, isSelected: i === 0,
        navigationEndpoint: { browseEndpoint: { browseId: i ? 'music' : 'FEwhat_to_watch' } }
      } })) };
      window.__motionCalls = [];
      const animate = Element.prototype.animate;
      Element.prototype.animate = function(frames, options) {
        window.__motionCalls.push(options?.id);
        return animate.call(this, frames, options);
      };
    });
    await mainBundle(page);
    const grid = page.locator('[data-ytg-browse-grid]');
    await grid.locator('.feed-skeletons').waitFor();
    assert.equal(await grid.getAttribute('aria-busy'), 'true');
    assert.equal(await grid.locator('.feed-skeletons').getAttribute('aria-hidden'), 'true');
    releaseFeed();
    const card = grid.locator('[data-browse-id="video:FEwhat_to_watch-0"]');
    await card.waitFor();
    assert.equal(await grid.locator('.feed-skeletons').count(), 0);
    assert.equal(await grid.getAttribute('aria-busy'), 'false');
    const cover = card.locator('.card-cover');
    const before = await cover.boundingBox();
    assert.equal(await cover.getAttribute('data-loading'), 'true');
    releaseImages();
    await page.waitForFunction(() => document.querySelector('[data-browse-id="video:FEwhat_to_watch-0"] img')?.dataset.loaded === 'true');
    await card.focus();
    await page.evaluate(() => { document.documentElement.classList.add('ytg-gamepad-input'); window.YTGamepad.refresh(); });
    await page.waitForTimeout(220);
    assert.deepEqual(await cover.boundingBox(), before, 'image loading and focus zoom must not move the cover or ring target');
    assert.equal(await card.locator('img').evaluate(node => getComputedStyle(node).scale), reducedMotion === 'reduce' ? 'none' : '1.035');
    const calls = await page.evaluate(() => window.__motionCalls.filter(id => id === 'ytg-feed-enter').length);
    assert.equal(calls, reducedMotion === 'reduce' ? 0 : 1);
    await page.evaluate(() => { window.YTGamepad.act('right'); window.YTGamepad.act('left'); });
    await grid.locator('[data-browse-more]').dispatchEvent('click');
    await grid.locator('[data-browse-id="video:more-0"]').waitFor();
    assert.equal(await page.evaluate(() => window.__motionCalls.filter(id => id === 'ytg-feed-enter').length), calls, 'navigation and appending never replay the feed entrance');
    await page.locator('#ytg-browse-categories button').last().click();
    await grid.locator('.feed-skeletons').waitFor();
    await page.locator('.client-brand').evaluate(node => window.YTGamepad.focus(node));
    releaseMusic();
    await grid.locator('[data-browse-id="video:music-0"]').waitFor();
    assert.equal(await page.evaluate(() => document.activeElement.classList.contains('client-brand')), true, 'a late category response must not steal focus from the header');
    assert.equal(await page.evaluate(() => window.__motionCalls.filter(id => id === 'ytg-feed-enter').length), reducedMotion === 'reduce' ? 0 : 2);
    const toggle = page.locator('#ytg-sidebar-explore');
    await toggle.click();
    await page.locator('#ytg-sidebar-explore-links a').first().waitFor();
    await toggle.click();
    assert.equal(await page.locator('#ytg-sidebar-explore-links').evaluate(node => node.inert), true);
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
    await page.evaluate(() => window.YTGamepad.act('down'));
    assert.equal(await page.evaluate(() => !!document.activeElement.closest('#ytg-sidebar-explore-links')), false);
    await page.locator('#ytg-sidebar-explore-links').waitFor({ state: 'hidden' });
    await toggle.click(); await toggle.click(); await toggle.click();
    await page.locator('#ytg-sidebar-explore-links a').first().waitFor();
    assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
    assert.equal(await page.locator('#ytg-sidebar-explore-links').evaluate(node => node.inert), false);
    mkdirSync('output/playwright', { recursive: true });
    await page.screenshot({ path: `output/playwright/browse-motion-${reducedMotion}.png` });
  });
}

async function mainBundle(page) {
  await page.addStyleTag({ content: readFileSync(new URL('../src/ui/theme.css', import.meta.url), 'utf8') });
  await page.evaluate(() => {
    // Match YouTube's page containers, which the adapter uses to exclude stale pages.
    const manager = document.querySelector('ytd-page-manager');
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
  await page.evaluate(() => window.postMessage({ source: 'yt-gamepad-settings',
    values: { enabled: true, theater: true, uiLanguage: 'zh-CN' } }, location.origin));
}

test('explicit focus regions connect cards, sidebar, categories, search and settings', { timeout: 30000 }, async t => {
  const page = await browserPage(t);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.route('https://i.ytimg.com/**', route => route.abort());
  await page.route('https://www.youtube.com/**', route => {
    if (route.request().url().includes('/youtubei/')) return route.fulfill({ json: { contents: Array.from({ length: 8 }, (_, i) => ({
      videoRenderer: { videoId: `focus${i}`, title: { simpleText: `Video ${i}` } }
    })) } });
    return route.fulfill({ contentType: 'text/html', body: '<html><body><ytd-masthead style="display:block;height:56px"><input id="search"></ytd-masthead><ytd-page-manager></ytd-page-manager></body></html>' });
  });
  await page.goto('https://www.youtube.com/');
  await page.evaluate(() => {
    window.ytcfg = { get: () => ({ client: { clientName: 'WEB', clientVersion: 'test' } }) };
    window.ytInitialData = { chips: ['All', 'Music'].map((label, i) => ({ chipCloudChipRenderer: {
      text: { simpleText: label }, isSelected: i === 0, navigationEndpoint: { browseEndpoint: { browseId: i ? 'music' : 'FEwhat_to_watch' } }
    } })) };
    const settings = document.createElement('div'); settings.id = 'yt-gamepad-settings-launcher'; settings.tabIndex = -1;
    settings.style.cssText = 'position:fixed;right:0;top:450px;width:48px;height:48px';
    settings.onclick = () => { window.__settingsClicked = true; }; document.body.append(settings);
  });
  for (const stylesheet of ['src/ui/theme.css', 'src/app/browse.css'])
    await page.addStyleTag({ content: readFileSync(new URL(`../${stylesheet}`, import.meta.url), 'utf8') });
  await mainBundle(page);
  const cards = page.locator('#ytg-browse-grid a[data-browse-id]'); await cards.first().waitFor();
  const section = () => page.evaluate(() => {
    const el = window.YTGamepad.current;
    return el?.id === 'yt-gamepad-settings-launcher' ? 'settings' : el?.closest('[data-ytg-category]') ? 'categories'
      : el?.closest('#ytg-browse-sidebar') ? 'sidebar' : el?.closest('ytd-masthead,#ytg-browse-top') ? 'header' : 'content';
  });
  const input = action => page.evaluate(action => window.YTGamepad.act(action), action);
  await cards.first().focus(); await input('left'); assert.equal(await section(), 'sidebar');
  await input('right'); assert.equal(await section(), 'content');
  await input('up'); assert.equal(await section(), 'categories');
  const categoryFocus = await page.evaluate(() => {
    const category = document.activeElement;
    const button = category.querySelector('button');
    return { wrapperOutline: getComputedStyle(category).outlineStyle,
      buttonOutline: getComputedStyle(button).outlineStyle, buttonWidth: getComputedStyle(button).outlineWidth };
  });
  assert.deepEqual(categoryFocus, { wrapperOutline: 'none', buttonOutline: 'solid', buttonWidth: '4px' }, 'category focus uses one rounded button ring');
  await input('up'); assert.equal(await section(), 'header');
  await input('down'); assert.equal(await section(), 'categories');
  await input('confirm'); assert.equal(await section(), 'categories');
  await input('down'); assert.equal(await section(), 'content');
  for (let i = 0; i < 12 && await section() !== 'settings'; i++) await input('right');
  assert.equal(await section(), 'settings'); await input('confirm');
  assert.equal(await page.evaluate(() => window.__settingsClicked), true);
  await input('back'); assert.equal(await section(), 'content');
});

test('full document return restores API category, loaded cards, focus and scroll without refetching', { timeout: 30000 }, async t => {
  const page = await browserPage(t);
  const requests = [];
  await page.route('https://i.ytimg.com/**', route => route.abort());
  await page.route('https://www.youtube.com/**', route => {
    if (!route.request().url().includes('/youtubei/')) return route.fulfill({ contentType: 'text/html',
      body: '<html><body><ytd-page-manager></ytd-page-manager></body></html>' });
    const body = route.request().postDataJSON();
    const key = body.continuation || body.browseId; requests.push(key);
    return route.fulfill({ json: { contents: [
      ...Array.from({ length: 40 }, (_, i) => ({ videoRenderer: { videoId: `${key}-${i}`, title: { simpleText: `${key} ${i}` } } })),
      { continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: key === 'music' ? 'next' : 'third' } } } }
    ] } });
  });
  await page.goto('https://www.youtube.com/');
  await page.evaluate(() => {
    history.replaceState({ youtube: 'preserved' }, '');
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
  await grid.getByRole('button', { name: /^(Load more videos|加载更多视频)$/ }).dispatchEvent('click');
  const card = grid.locator('[data-browse-id="video:next-20"]');
  await card.waitFor();
  await card.focus();
  // Invoke the card without Playwright changing its scroll position first.
  const scrollTop = await page.evaluate(() => {
    const grid = document.querySelector('[data-ytg-browse-grid]');
    return grid.scrollTop;
  });
  assert.ok(scrollTop > 0);
  await page.evaluate(() => document.querySelector('[data-browse-id="video:next-20"]').click());
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
  await page.waitForFunction(() => document.activeElement?.getAttribute('data-browse-id') === 'video:next-20');
  assert.equal(await grid.locator('[data-browse-id]').count(), 80);
  assert.equal(await grid.locator('#ytg-browse-categories button[aria-pressed="true"]').textContent(), 'Music');
  assert.equal(await grid.locator('[data-ytg-browse-grid]').evaluate(node => node.scrollTop), scrollTop);
  assert.equal(await page.evaluate(() => history.state.youtube), 'preserved');
  assert.equal(requests.length, beforeReturn);
  await grid.getByRole('button', { name: /^(Load more videos|加载更多视频)$/ }).dispatchEvent('click');
  await grid.locator('[data-browse-id="video:third-0"]').waitFor();
  assert.equal(requests.at(-1), 'third');
});

test('subscriptions uses native YouTube navigation and renders its videos in our cards', { timeout: 30000 }, async t => {
  const page = await browserPage(t);
  await page.route('https://i.ytimg.com/**', route => route.abort());
  await page.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html', body:
    `<html><head><meta charset="utf-8"></head><body>
    <ytd-masthead style="display:block;height:56px"><input id="search"></ytd-masthead>
    <ytd-guide-renderer><a href="/feed/subscriptions">订阅</a></ytd-guide-renderer>
    <ytd-page-manager><ytd-rich-item-renderer><a id="thumbnail" href="/watch?v=home1234567"><h3>首页视频</h3></a></ytd-rich-item-renderer></ytd-page-manager>
    </body></html>` }));
  await page.goto('https://www.youtube.com/');
  await page.evaluate(() => {
    document.querySelector('ytd-guide-renderer a').addEventListener('click', event => {
      event.preventDefault(); window.__subscriptionClicks = (window.__subscriptionClicks || 0) + 1;
      document.dispatchEvent(new Event('yt-navigate-start'));
      history.pushState({}, '', '/feed/subscriptions');
      document.querySelector('ytd-page-manager').innerHTML =
        '<ytd-browse><ytd-rich-item-renderer><a id="thumbnail" href="/watch?v=subs1234567"><h3>YouTube 订阅更新</h3></a><span id="channel-name">原生订阅频道</span></ytd-rich-item-renderer></ytd-browse>';
      document.dispatchEvent(new Event('yt-navigate-finish'));
    });
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

test('sidebar has the requested sections, expands Explore and retains focus while cards update', { timeout: 30000 }, async t => {
  const page = await browserPage(t);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.route('https://i.ytimg.com/**', route => route.abort());
  await page.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html', body:
    `<html><head><meta charset="utf-8"></head><body><ytd-masthead style="display:block;height:56px"><input id="search" placeholder="搜索"></ytd-masthead>
    <ytd-guide-renderer><ytd-guide-section-renderer><div id="guide-section-title">探索</div>
    <ytd-guide-entry-renderer><a href="/gaming"><yt-formatted-string>游戏</yt-formatted-string></a></ytd-guide-entry-renderer>
    <ytd-guide-entry-renderer><a href="/feed/news"><yt-formatted-string>新闻</yt-formatted-string></a></ytd-guide-entry-renderer>
    </ytd-guide-section-renderer></ytd-guide-renderer><ytd-mini-guide-renderer>Native mini guide</ytd-mini-guide-renderer>
    <ytd-page-manager>${Array.from({ length: 16 }, (_, i) => `<ytd-rich-item-renderer><a id="thumbnail" href="/watch?v=sidebar${i}"><h3>视频 ${i + 1}</h3></a><span id="channel-name">频道名称</span></ytd-rich-item-renderer>`).join('')}</ytd-page-manager></body></html>` }));
  await page.goto('https://www.youtube.com/');
  for (const stylesheet of ['src/ui/theme.css', 'src/app/browse.css'])
    await page.addStyleTag({ content: readFileSync(new URL(`../${stylesheet}`, import.meta.url), 'utf8') });
  await mainBundle(page);
  const sidebar = page.locator('#ytg-browse-sidebar');
  await sidebar.waitFor();
  assert.deepEqual(await sidebar.locator(':scope > a > span,:scope > section > button > span').allTextContents(), ['首页', '订阅', '我的频道', '探索']);
  assert.deepEqual(await sidebar.locator('#ytg-sidebar-personal-links a span').allTextContents(), ['历史记录', '播放列表', '稍后观看', '赞过的视频', '我的视频']);
  assert.equal(await sidebar.locator('[data-sidebar-id="home"]').getAttribute('aria-current'), 'page');
  const expand = sidebar.getByRole('button', { name: '探索', exact: true });
  assert.equal(await expand.getAttribute('aria-expanded'), 'false');
  await expand.focus();
  await page.evaluate(() => window.YTGamepad.act('confirm'));
  await sidebar.getByRole('link', { name: '游戏', exact: true }).waitFor();
  assert.equal(await sidebar.getByRole('link', { name: '游戏', exact: true }).getAttribute('href'), '/gaming');
  await page.evaluate(() => window.YTGamepad.act('down'));
  assert.equal(await page.evaluate(() => document.activeElement.textContent.trim()), '游戏');
  await page.evaluate(() => {
    document.querySelector('ytd-guide-renderer a[href="/gaming"]').addEventListener('click', event => { event.preventDefault(); window.__exploreClicks = (window.__exploreClicks || 0) + 1; });
    window.YTGamepad.act('confirm');
  });
  assert.equal(await page.evaluate(() => window.__exploreClicks), 1);
  await page.evaluate(() => {
    const item = document.createElement('ytd-rich-item-renderer');
    const link = document.createElement('a'); link.id = 'thumbnail'; link.href = '/watch?v=appended'; link.textContent = 'Appended'; item.append(link);
    document.querySelector('ytd-page-manager ytd-browse').append(item);
  });
  await page.locator('[data-browse-id="video:appended"]').waitFor();
  assert.equal(await page.evaluate(() => document.activeElement.textContent.trim()), '游戏');
  await expand.focus(); await page.evaluate(() => window.YTGamepad.act('confirm'));
  assert.equal(await sidebar.locator('#ytg-sidebar-explore-links').getAttribute('aria-hidden'), 'true');
  assert.equal(await sidebar.locator('#ytg-sidebar-explore-links').evaluate(node => node.inert), true);
  await sidebar.locator('#ytg-sidebar-explore-links').waitFor({ state: 'hidden' });
  assert.equal(await expand.getAttribute('aria-expanded'), 'false');
  await sidebar.locator('[data-sidebar-id="home"]').focus();
  await page.evaluate(() => window.YTGamepad.act('right'));
  assert.ok(await page.evaluate(() => document.activeElement.hasAttribute('data-browse-id')));
  // Custom cards use the same floating thumbnail ring as native video cards.
  for (const dark of [false, true]) {
    await page.evaluate(dark => {
      document.documentElement.toggleAttribute('dark', dark);
      document.documentElement.classList.add('ytg-gamepad-input');
      window.YTGamepad.refresh();
    }, dark);
    const selection = await page.evaluate(() => {
      const card = document.activeElement;
      const thumbnail = card.querySelector('.card-cover').getBoundingClientRect();
      const ring = document.querySelector('#yt-gamepad-overlay').shadowRoot.querySelector('#ring');
      const bounds = ring.getBoundingClientRect();
      return { display: getComputedStyle(ring).display, color: getComputedStyle(ring).borderColor,
        outline: getComputedStyle(card).outlineStyle, width: bounds.width, height: bounds.height,
        thumbnailWidth: thumbnail.width, thumbnailHeight: thumbnail.height,
        focusColor: getComputedStyle(document.documentElement).getPropertyValue('--ytg-focus-color').trim(),
        focusPadding: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ytg-focus-width')),
        left: bounds.left, top: bounds.top, thumbnailLeft: thumbnail.left, thumbnailTop: thumbnail.top };
    });
    assert.equal(selection.display, 'block');
    assert.equal(selection.color, dark ? 'rgb(138, 180, 248)' : 'rgb(23, 105, 210)');
    assert.equal(selection.outline, 'none');
    assert.ok(Math.abs(selection.width - selection.thumbnailWidth - selection.focusPadding * 2) < 1);
    assert.ok(Math.abs(selection.height - selection.thumbnailHeight - selection.focusPadding * 2) < 1);
    assert.ok(Math.abs(selection.left - selection.thumbnailLeft + selection.focusPadding) < 1);
    assert.ok(Math.abs(selection.top - selection.thumbnailTop + selection.focusPadding) < 1);
  }
  assert.equal(await page.locator('ytd-guide-renderer').evaluate(node => getComputedStyle(node).display), 'none');
  await expand.click();
  mkdirSync('output/playwright', { recursive: true });
  await page.screenshot({ path: 'output/playwright/browse-sidebar.png' });
  const bounds = await page.evaluate(() => ({ sidebar: document.querySelector('#ytg-browse-sidebar').getBoundingClientRect().right,
    grid: document.querySelector('#ytg-browse-grid').getBoundingClientRect().left }));
  assert.equal(bounds.sidebar, bounds.grid);
  await page.evaluate(() => window.postMessage({ source: 'yt-gamepad-settings', values: { enabled: false } }, location.origin));
  await sidebar.waitFor({ state: 'hidden' });
  assert.notEqual(await page.locator('ytd-guide-renderer').evaluate(node => getComputedStyle(node).display), 'none');
});

test('category bar survives fullscreen-sized viewports, masthead backing and late header resizing', { timeout: 30000 }, async t => {
  const page = await browserPage(t);
  await page.route('https://i.ytimg.com/**', route => route.abort());
  await page.route('https://www.youtube.com/**', route => route.request().url().includes('/youtubei/')
    ? route.fulfill({ json: { contents: [{ videoRenderer: { videoId: 'layout', title: { simpleText: 'Layout card' } } }] } })
    : route.fulfill({ contentType: 'text/html', body: `<html><head><style>
      body{margin:0}#masthead-container{position:fixed;inset:0 0 auto;z-index:2020;background:white}
      ytd-masthead{display:block;height:56px;background:white}
      #masthead-container::after{content:'';position:absolute;top:100%;left:0;right:0;height:48px;background:white}
      </style></head><body><div id="masthead-container"><ytd-masthead>Search header</ytd-masthead></div><ytd-page-manager></ytd-page-manager></body></html>` }));
  await page.goto('https://www.youtube.com/');
  await page.evaluate(() => {
    window.ytcfg = { get: () => ({ client: { clientName: 'WEB', clientVersion: 'test' } }) };
    window.ytInitialData = { chips: ['All', 'Music', 'Gaming'].map((label, i) => ({ chipCloudChipRenderer: {
      text: { simpleText: label }, isSelected: i === 0,
      navigationEndpoint: { browseEndpoint: { browseId: 'FEwhat_to_watch' } }
    } })) };
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
      const header = document.querySelector('#ytg-browse-top').getBoundingClientRect();
      return { belowHeader: bar.top >= header.bottom, inside: r.top >= bar.top && r.bottom <= bar.bottom,
        uncovered: [0.1, 0.5, 0.9].every(y => button.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height * y))) };
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
    const old = document.querySelector('ytd-masthead');
    const header = document.createElement('ytd-masthead'); header.textContent = 'Restored search header'; old.replaceWith(header);
    const backing = document.createElement('div'); backing.id = 'frosted-glass';
    backing.style.cssText = 'position:absolute;inset:0 0 auto;height:160px;background:white;pointer-events:none';
    document.querySelector('#masthead-container').prepend(backing);
    document.dispatchEvent(new Event('yt-navigate-finish'));
    document.dispatchEvent(new Event('fullscreenchange'));
  });
  await buttons.first().waitFor();
  await page.waitForTimeout(150);
  await page.locator('ytd-masthead').evaluate(node => { node.style.height = '88px'; });
  await page.waitForTimeout(250);
  assert.equal(await buttons.first().evaluate(button => {
    const r = button.getBoundingClientRect();
    return button.closest('nav').getBoundingClientRect().top >= document.querySelector('#ytg-browse-top').getBoundingClientRect().bottom
      && button.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
  }), true, 'return from playback must track the replaced header and its late size change');
  await buttons.nth(1).click();
  await page.waitForFunction(() => document.querySelector('#ytg-browse-categories button[aria-pressed=true]')?.textContent === 'Music');
  mkdirSync('output/playwright', { recursive: true });
  await page.screenshot({ path: 'output/playwright/categories-fullscreen-layout.png' });
  await page.evaluate(() => {
    const dialog = document.createElement('div'); dialog.id = 'layout-dialog'; dialog.setAttribute('role', 'dialog');
    dialog.style.cssText = 'position:fixed;inset:0;z-index:2200;background:white'; document.body.append(dialog);
  });
  assert.equal(await buttons.first().evaluate(button => {
    const r = button.getBoundingClientRect();
    return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.id;
  }), 'layout-dialog', 'native dialogs must still appear above the browse surface');
});

test('SPA return keeps category, continuation cards, video identity and inner scroll; card text has stable height', { timeout: 30000 }, async t => {
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
  // API categories must remain below the masthead without a native chip bar.
  const categoryLayout = await grid.locator('#ytg-browse-categories button').first().evaluate(button => {
    const bar = button.closest('nav').getBoundingClientRect();
    const bounds = button.getBoundingClientRect();
    const masthead = document.querySelector('ytd-masthead').getBoundingClientRect();
    return { belowHeader: bar.top >= masthead.bottom,
      contained: bounds.top >= bar.top && bounds.bottom <= bar.bottom,
      margin: getComputedStyle(button).marginTop,
      hit: button.contains(document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)) };
  });
  assert.deepEqual(categoryLayout, { belowHeader: true, contained: true, margin: '0px', hit: true });
  // YouTube mounts an opaque, higher-layer chip wrapper after initial data.
  await page.evaluate(() => {
    const nativeBar = document.createElement('ytd-feed-filter-chip-bar-renderer');
    nativeBar.style.cssText = 'position:fixed;top:56px;left:0;right:0;height:56px;background:white;z-index:2000';
    nativeBar.innerHTML = '<div id="chips-wrapper" style="height:56px;background:white"><yt-chip-cloud-chip-renderer>Native</yt-chip-cloud-chip-renderer></div>';
    document.querySelector('ytd-page-manager').append(nativeBar);
  });
  await page.waitForTimeout(250);
  assert.equal(await grid.locator('#ytg-browse-categories button').first().evaluate(button => {
    const bounds = button.getBoundingClientRect();
    return button.contains(document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2));
  }), true, 'native category wrapper must not cover the custom category buttons');
  await grid.getByRole('button', { name: 'Music', exact: true }).click();
  await grid.locator('[data-browse-id="video:music-0"]').waitFor();
  // Scrolling this button into view can auto-load the final page and remove it before the click.
  await grid.getByRole('button', { name: /^(Load more videos|加载更多视频)$/ }).dispatchEvent('click');
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
  await page.evaluate(() => window.postMessage({ source: 'yt-gamepad-settings', values: { enabled: false } }, location.origin));
  await grid.waitFor({ state: 'hidden' });
  assert.equal(await page.locator('ytd-feed-filter-chip-bar-renderer').evaluate(node => getComputedStyle(node).visibility), 'visible');
  assert.equal(await page.locator('#chips-wrapper').evaluate(node => getComputedStyle(node).visibility), 'visible');
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
  await bar.locator('[data-ytg-category]').first().evaluate(node => window.YTGamepad.focus(node));
  await page.evaluate(() => window.YTGamepad.act('right'));
  await page.waitForFunction(() => document.querySelector('#ytg-browse-categories button[aria-pressed="true"]')?.textContent === 'Music');
  await page.evaluate(() => window.YTGamepad.act('right'));
  await grid.locator('[data-browse-id="video:gaming"]').waitFor();
  assert.equal(await bar.locator('.ytg-selected button').textContent(), 'Gaming');
  assert.equal(await bar.locator('button[aria-pressed="true"]').textContent(), 'Gaming');
  await page.waitForTimeout(450);
  assert.equal(await grid.locator('[data-browse-id="video:music"]').count(), 0);
  assert.equal(await grid.locator('[data-browse-id="video:native"]').count(), 0);
  await grid.getByRole('button', { name: /^(Load more videos|加载更多视频)$/ }).click();
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
    const source = document.querySelector('ytd-page-manager ytd-browse');
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
      card.append(link); document.querySelector('ytd-page-manager ytd-browse').append(card);
    });
  });
  await grid.locator('[data-browse-id="video:late"]').waitFor();
  await grid.getByRole('button', { name: /^(Load more videos|加载更多视频)$/ }).click();
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
        card.append(anchor); document.querySelector('ytd-page-manager ytd-browse').append(card);
      }, 50);
    });
  });
  await mainBundle(page);
  const grid = page.locator('#ytg-browse-grid');
  await grid.locator('[data-browse-id="video:batch3"]').waitFor();
  await page.waitForTimeout(1800);
  assert.equal(await page.evaluate(() => window.__loads), 3);
  const more = grid.getByRole('button', { name: /^(Load more videos|加载更多视频)$/ });
  await more.click(); await more.click();
  await grid.locator('[data-browse-id="video:batch6"]').waitFor();
  await page.waitForTimeout(1800);
  assert.equal(await page.evaluate(() => window.__loads), 6);
});
