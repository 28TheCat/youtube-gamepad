import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';
import { browserPage } from './helpers/bundles.mjs';

test('subscription channel browsing retains its context through reload and back without treating personal pages as subscription feeds', async t => {
  const component = fileURLToPath(new URL('../src/ui/SubscriptionChannels.vue', import.meta.url)).replaceAll('\\', '/');
  const sidebar = fileURLToPath(new URL('../src/ui/BrowseSidebar.vue', import.meta.url)).replaceAll('\\', '/');
  const shared = fileURLToPath(new URL('../src/ui/use-browse-sidebar.ts', import.meta.url)).replaceAll('\\', '/');
  const result = await build({ configFile: false, publicDir: false, logLevel: 'silent',
    plugins: [{ name: 'subscription-context-fixture', enforce: 'pre', resolveId(id) {
      if (id.endsWith('context-fixture')) return '\0context-fixture';
      if (id.endsWith('/bridge/page-client')) return '\0context-client';
    }, load(id) {
      if (id === '\0context-client') return `export const createPageClient = () => {
        window.sidebarClients = (window.sidebarClients || 0) + 1;
        return {
          readSidebar: async () => { window.sidebarReads = (window.sidebarReads || 0) + 1; return {
            sections: [{ id: 'subscriptions', entries: [{ id: 'subscription:UCcreator', label: 'Creator', href: '/channel/UCcreator/videos', icon: 'person' }] }],
            subscriptions: [{ id:'UCcreator', label:'Creator', href:'/channel/UCcreator/videos' }] }; },
          openBrowseRoute(href) { document.dispatchEvent(new Event('yt-navigate-start')); history.pushState({}, '', href); document.dispatchEvent(new Event('yt-navigate-finish')); return true; },
          destroy() { window.sidebarDisposed = (window.sidebarDisposed || 0) + 1; }
        };
      };`;
      if (id === '\0context-fixture') return `import { createApp, h, ref, onBeforeUnmount } from 'vue';
        import Channels from ${JSON.stringify(component)}; import Sidebar from ${JSON.stringify(sidebar)}; import { useBrowseSidebar } from ${JSON.stringify(shared)};
        window.mountChannels = () => {
          const app = createApp({ setup() {
            const route = ref(location.pathname + location.search);
            const updateRoute = () => route.value = location.pathname + location.search;
            document.addEventListener('yt-navigate-finish', updateRoute);
            window.addEventListener('popstate', updateRoute);
            onBeforeUnmount(() => { document.removeEventListener('yt-navigate-finish', updateRoute); window.removeEventListener('popstate', updateRoute); });
            const { snapshot, openRoute } = useBrowseSidebar(() => route.value);
            return () => [h(Sidebar, { route: route.value, snapshot: snapshot.value, openRoute }),
              h(Channels, { route: route.value, channels: snapshot.value?.subscriptions || [], openRoute, onBrowsing: value => window.subscriptionBrowsing = value })];
          } });
          app.mount('#app'); window.unmountChannels = () => app.unmount();
        };`;
    } }, vue()], define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    build: { write: false, lib: { entry: 'context-fixture', formats: ['iife'], name: 'ContextFixture' } } });
  const source = (Array.isArray(result) ? result[0] : result).output.find(item => item.type === 'chunk').code;
  const page = await browserPage(t);
  await page.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html', body: '<html><body><div id="app"></div></body></html>' }));
  await page.goto('https://www.youtube.com/feed/subscriptions');
  const mount = async () => { await page.addScriptTag({ content: source }); await page.evaluate(() => window.mountChannels()); };
  await mount();
  await page.locator('[data-subscription-id="UCcreator"]').waitFor();
  assert.deepEqual(await page.evaluate(() => [window.sidebarClients, window.sidebarReads]), [1, 1]);
  assert.equal(await page.locator('[data-sidebar-id="subscription:UCcreator"]').getAttribute('title'), 'Creator');
  await page.evaluate(() => {
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('yt-page-data-updated'));
    document.dispatchEvent(new Event('yt-navigate-finish'));
  });
  await page.waitForFunction(() => window.sidebarReads === 2);
  await page.locator('[data-subscription-id="UCcreator"]').click();
  await page.waitForFunction(() => window.subscriptionBrowsing === true);
  assert.equal(await page.locator('#ytg-subscription-channels').isVisible(), true);
  await page.reload(); await mount();
  await page.waitForFunction(() => window.subscriptionBrowsing === true);
  await page.evaluate(() => { history.pushState({}, '', '/channel/UCcreator'); document.dispatchEvent(new Event('yt-navigate-finish')); });
  await page.waitForFunction(() => window.subscriptionBrowsing === false);
  assert.equal(await page.locator('#ytg-subscription-channels').count(), 0);
  await page.goBack();
  await page.waitForFunction(() => window.subscriptionBrowsing === true);
  assert.equal(await page.locator('#ytg-subscription-channels').isVisible(), true);
  const reads = await page.evaluate(() => {
    window.unmountChannels();
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('popstate'));
    document.dispatchEvent(new Event('yt-navigate-finish'));
    document.dispatchEvent(new Event('yt-page-data-updated'));
    return window.sidebarReads;
  });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.deepEqual(await page.evaluate(() => [window.sidebarClients, window.sidebarDisposed, window.sidebarReads]), [1, 1, reads]);
});
