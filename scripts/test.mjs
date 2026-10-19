import { readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { buildExtension } from './build-extension.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv[2] || 'unit';
if (!['unit', 'browser', 'extension', 'live', 'all'].includes(mode)) throw new Error(`Unknown test mode: ${mode}`);
const groups = {
  'youtube-sidebar-extension.test.mjs': 'extension',
  'navigation-scroll.test.mjs': 'browser',
  'youtube-watch-info-extension.test.mjs': 'extension',
  'input-mode-extension.test.mjs': 'extension',
  'shorts-extension.test.mjs': 'extension',
  'youtube-comments-extension.test.mjs': 'extension',
  'youtube-channel-extension.test.mjs': 'extension',
  'youtube-next-extension.test.mjs': 'extension',
  'youtube-search-extension.test.mjs': 'extension',
  'account-page.test.mjs': 'browser',
  'ui-api-browser.test.mjs': 'browser',
  'youtube-account-extension.test.mjs': 'extension',
  'browse-mode.test.mjs': 'extension',
  'playback-layout.test.mjs': 'browser',
  'browse-shadow.test.mjs': 'browser',
  'i18n-extension.test.mjs': 'extension',
  'category-settings.test.mjs': 'extension',
  'module-combinations.test.mjs': 'browser', 'bundled-runtime.test.mjs': 'browser',
  'browse-vue.test.mjs': 'browser',
  'search-bar.test.mjs': 'browser',
  'extension-e2e.test.mjs': 'extension', 'video-grid-extension.test.mjs': 'extension', 'settings-pages.test.mjs': 'extension',
  'inline-settings-vue.test.mjs': 'extension', 'quick-menu-vue.test.mjs': 'extension', 'search-vue.test.mjs': 'extension',
  'playback-vue.test.mjs': 'browser', 'watch-panels-vue.test.mjs': 'browser', 'watch-surface.test.mjs': 'browser',
  'playback-extension.test.mjs': 'extension',
  'youtube-live.test.mjs': 'live'
};
if (['all', 'browser', 'extension', 'live'].includes(mode) && !process.env.YTG_EXTENSION_ROOT) await buildExtension();
const tests = readdirSync(resolve(root, 'tests')).filter(file => file.endsWith('.test.mjs'))
  .filter(file => mode === 'all' ? groups[file] !== 'live' : (groups[file] || 'unit') === mode)
  .sort().map(file => resolve(root, 'tests', file));
// Each browser test file launches its own Chrome instance. Bound concurrency so
// full regression runs do not exhaust resources and turn passing checks into timeouts.
const concurrency = mode === 'unit' ? [] : ['--test-concurrency=2'];
const result = spawnSync(process.execPath, ['--test', ...concurrency, ...tests], { cwd: root, stdio: 'inherit',
  env: { ...process.env, ...(mode !== 'unit' ? { REQUIRE_BROWSER_TESTS: '1' } : {}) } });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
