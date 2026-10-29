import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { legacyModuleSource } from '../scripts/test-source.mjs';

test('update injects manifest bundles in world order, skips discarded tabs and isolates closed-tab failures', async () => {
  const calls = [];
  const context = { console: { warn() {} }, chrome: {
    runtime: { getManifest: () => ({ content_scripts: [
      { matches: ['https://www.youtube.com/*'], js: ['early.js'], world: 'ISOLATED' },
      { matches: ['https://www.youtube.com/*'], css: ['theme.css'], js: ['main.js'], world: 'MAIN' },
      { matches: ['https://www.youtube.com/*'], js: ['content.js'] }
    ] }) },
    tabs: { query: async filter => { assert.equal(filter.url, 'https://www.youtube.com/*'); return [{ id: 1 }, { id: 2, discarded: true }, { id: 3 }]; } },
    scripting: Object.fromEntries(['executeScript', 'removeCSS', 'insertCSS'].map(method => [method, async args => {
      if (args.target.tabId === 3) throw new Error('Tab closed');
      calls.push([method, args.files?.[0] || 'cleanup', args.world]);
    }]))
  } };
  runInNewContext(legacyModuleSource('src/background/update-tabs.ts'), context);
  await context.updateYouTubeTabs();
  assert.deepEqual(calls, [
    ['executeScript', 'cleanup', 'ISOLATED'], ['executeScript', 'early.js', 'ISOLATED'],
    ['removeCSS', 'theme.css', undefined], ['insertCSS', 'theme.css', undefined],
    ['executeScript', 'main.js', 'MAIN'], ['executeScript', 'content.js', 'ISOLATED']
  ]);
});
