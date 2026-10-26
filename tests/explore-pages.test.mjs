import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importSettingsModel } from './helpers/settings-model.mjs';
const { explorePages, resolveExplorePage, isInnerTubeBrowseRoute, searchHref, sidebarBrowseEndpoint } = await importSettingsModel('src/shared/explore-pages.ts');

test('search navigation uses bounded queries and fixed search endpoints', () => {
  const href = searchHref('  中文 & music  ');
  assert.equal(href, '/results?search_query=%E4%B8%AD%E6%96%87+%26+music');
  assert.equal(sidebarBrowseEndpoint(href).searchEndpoint.query, '中文 & music');
  assert.equal(sidebarBrowseEndpoint(href).commandMetadata.webCommandMetadata.webPageType, 'WEB_PAGE_TYPE_SEARCH');
  for (const query of ['', '  ', 1, 'a'.repeat(257)]) assert.equal(searchHref(query), undefined);
  for (const href of ['/results?search_query=', '/results?search_query=a&search_query=b',
    '/results?search_query=a&redirect=https://evil.test', '//evil.test/results?search_query=a'])
    assert.equal(sidebarBrowseEndpoint(href), undefined);
});

test('API-owned routes include subscriptions, channel URLs and valid playlists', () => {
  for (const route of ['/', '/results?search_query=test', '/feed/subscriptions', '/feed/history',
    '/playlist?list=PLordinary', '/playlist?list=WL', '/@creator', '/@creator/videos', '/channel/UCcreator/shorts', '/c/Creator', '/user/Creator/streams'])
    assert.equal(isInnerTubeBrowseRoute(route), true, route);
  for (const route of ['/watch?v=a', '/playlist', '/playlist?list=', '/playlist?list=bad%2Fid',
    '/shorts/a', '/channel/', '/@creator/videos/extra', 'https://evil.test/@creator'])
    assert.equal(isInnerTubeBrowseRoute(route), false, route);
});

test('explore destinations resolve to separate reusable page definitions', () => {
  for (const page of explorePages) {
    assert.equal(isInnerTubeBrowseRoute(page.href), true);
    assert.equal(resolveExplorePage(page.href)?.id, page.id);
    assert.equal(resolveExplorePage(page.href + '?tracking=test')?.id, page.id);
    for (const alias of page.aliases || []) {
      assert.equal(resolveExplorePage(alias)?.id, page.id);
      assert.equal(isInnerTubeBrowseRoute(alias), true);
    }
    assert.ok(page.browseId && page.description);
    assert.ok(!page.href.startsWith('/results'));
  }
  for (const route of ['/', '/watch?v=music', '/results?search_query=音乐', 'https://evil.test/music', '/@creator'])
    assert.equal(resolveExplorePage(route), undefined);
});
