import { legacyModuleSource } from '../scripts/test-source.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

test('manifest feature scripts define factories without creating resources or reading collaborators', () => {
  const window = {};
  const context = { window };
  for (const file of ['src/navigation/core.ts', 'src/input/gamepad.ts', 'src/ui/menu.ts', 'src/playback/watch.ts', 'src/app/browse.ts', 'src/sites/youtube.ts',
    'src/search/search.ts', 'src/ui/watch-panels.ts', 'src/app/route-controller.ts']) {
    // No document, runtime or state store exists here. Definition must be inert.
    runInNewContext(legacyModuleSource(file), context);
  }
  for (const name of ['CoreModule', 'InputModule', 'MenuModule', 'WatchModule', 'BrowseModule', 'SiteModule',
    'Search', 'WatchPanels', 'RouteController']) {
    assert.equal(typeof window['YTGamepad' + name].create, 'function', name);
  }
  for (const name of ['YTGamepad', 'YTGamepadInput', 'YTGamepadMenu', 'YTGamepadWatch', 'YTGamepadSite']) {
    assert.equal(window[name], undefined, name);
  }
});
