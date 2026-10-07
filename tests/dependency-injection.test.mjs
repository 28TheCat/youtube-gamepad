import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

test('manifest feature scripts define factories without creating resources or reading collaborators', () => {
  const window = {};
  const context = { window };
  for (const file of ['core.js', 'gamepad.js', 'menu.js', 'watch.js', 'browse.js', 'sites/youtube.js',
    'search.js', 'ui/watch-view.js', 'ui/watch-panels.js', 'app/route-controller.js']) {
    // No document, runtime or state store exists here. Definition must be inert.
    runInNewContext(readFileSync(new URL('../' + file, import.meta.url), 'utf8'), context);
  }
  for (const name of ['CoreModule', 'InputModule', 'MenuModule', 'WatchModule', 'BrowseModule', 'SiteModule',
    'Search', 'WatchView', 'WatchPanels', 'RouteController']) {
    assert.equal(typeof window['YTGamepad' + name].create, 'function', name);
  }
  for (const name of ['YTGamepad', 'YTGamepadInput', 'YTGamepadMenu', 'YTGamepadWatch', 'YTGamepadSite']) {
    assert.equal(window[name], undefined, name);
  }
});
