import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// Behavioral popup coverage runs against its compiled Vue page in settings-pages.
test('extension pages mount Vue through bundled entries without legacy page scripts', () => {
  for (const [page, directory] of [['popup', 'popup'], ['options', 'settings']]) {
    const html = readFileSync(new URL(`../src/${directory}/${page}.html`, import.meta.url), 'utf8');
    assert.match(html, /id="app"/);
    assert.match(html, new RegExp(`src="../../bundles/${page}\\.js"`));
    assert.equal([...html.matchAll(/<script/g)].length, 1);
    const entry = readFileSync(new URL(`../src/entries/${page}.ts`, import.meta.url), 'utf8');
    assert.match(entry, /createApp/); assert.match(entry, /createPinia/);
    assert.doesNotMatch(entry, /options-bindings\.js|diagnostics-options\.js|popup\.js|options\.js/);
  }
});
