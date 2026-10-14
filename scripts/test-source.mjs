import { watchPanelRendererSource } from '../tests/helpers/watch-panel-renderer.mjs';
import { readFileSync, readdirSync } from 'node:fs';
import ts from 'typescript-vue';
import { searchRendererSource } from '../tests/helpers/search-renderer.mjs';
import { dependencies } from './module-graph.mjs';
// Compatibility belongs only to old VM fixtures. Production uses ESM imports.
const aliases = new Set();
const compiled = new Map();
function fixtureSource(path) {
  const key = String(path);
  if (!compiled.has(key)) {
    const source = readFileSync(path, 'utf8');
    compiled.set(key, key.endsWith('.ts') ? ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }
    }).outputText : source);
  }
  return compiled.get(key);
}
function collect(directory) {
  for (const item of readdirSync(directory, { withFileTypes: true })) {
    const path = new URL(item.name + (item.isDirectory() ? '/' : ''), directory);
    if (item.isDirectory()) collect(path);
    else if (/\.(js|ts)$/.test(item.name) && !item.name.endsWith('.d.ts')) {
      for (const match of fixtureSource(path).matchAll(/^export let ([\w ,]+)(?:;|\s*=)/gm)) {
        for (const name of match[1].split(',')) aliases.add(name.trim());
      }
    }
  }
}
collect(new URL('../src/', import.meta.url));
aliases.add('YTGamepadInteraction');
aliases.add('YTGamepadWatchView');
const aliasPattern = new RegExp(`\\b(${[...aliases].join('|')})\\b`, 'g');
export function legacyModuleSource(file) {
  if (file === 'src/search/mount-search.ts') return searchRendererSource;
  if (file === 'src/ui/mount-watch-panel.ts') return watchPanelRendererSource;
  const fixtureFile = file === 'src/ui/watch-view.ts' ? 'tests/helpers/watch-view-fixture.ts' : file;
  let source = fixtureSource(new URL('../' + fixtureFile, import.meta.url))
    .replace(/^import[^\n]*\n/gm, '').replace(/^export let [\w ,]+;\s*/gm, '')
    .replace(/^export let /gm, 'let ')
    .replace(/^export function /gm, 'function ').replace(/^export \{\};?\s*/gm, '');
  if (file === 'src/sites/youtube.ts') source = source.replace('pageAccess = undefined', `pageAccess = { readVideoDetails: () => document.querySelector('#movie_player')?.getPlayerResponse?.()?.videoDetails, showControls: () => document.querySelector('#movie_player')?.showControls?.(), hideControls: () => document.querySelector('#movie_player')?.hideControls?.() }`);
  source = source.replace(aliasPattern, name => `${name === 'YTGamepadDiagnosticStore' ? 'globalThis' : 'window'}.${name}`);
  source = source.replace(/^let ((?:window|globalThis)\.\w+)\s*=/gm, '$1 =');
  // Tiny non-reactive harness for DOM-only VM fixtures; never bundled in production.
  if (file === 'src/app/state-machine.ts') source += `
    window.YTGamepadStateMachine.createStore = function(initial = window.YTGamepadStateMachine.createState()) {
      let state = window.YTGamepadStateMachine.freezeSnapshot(initial);
      return { get state() { return state; }, dispatch(event) {
        const result = window.YTGamepadStateMachine.transition(state, event);
        state = window.YTGamepadStateMachine.freezeSnapshot(result.nextState); return result;
      } };
    };
    window.YTGamepadInteraction ||= window.YTGamepadStateMachine.createStore();`;
  if (file === 'src/app/coordinator.ts') source += '\nstartCoordinator({ interaction: window.YTGamepadInteraction, createWatchView: port => window.YTGamepadWatchView.create(port) });';
  if (file === 'src/app/content.ts') source += '\nstartContent();';
  // These VM fixtures strip ESM imports. Keep the real translation dependency
  // scoped to its consumer rather than replacing it with a test-only stub.
  if (['src/input/controller-style.ts', 'src/app/content.ts', 'src/app/coordinator.ts'].includes(file)) {
    const locale = fixtureSource(new URL('../src/shared/locales.ts', import.meta.url)).replace(/^export /gm, '');
    const i18n = fixtureSource(new URL('../src/shared/i18n.ts', import.meta.url)).replace(/^import[^\n]*\n/gm, '').replace(/^export /gm, '');
    const grid = file === 'src/app/content.ts' ? fixtureSource(new URL('../src/shared/video-grid.ts', import.meta.url)).replace(/^export /gm, '') : '';
    source = `(function() {\n${locale}\n${i18n}\n${grid}\n${source}\n})();`;
  }
  return source;
}
// Load the same prerequisites as the extension. VM test doubles still supply
// only the collaborators the original scenario uses.
export function moduleSource(file) {
  const seen = new Set(), files = [];
  function visit(name) {
    if (seen.has(name)) return;
    seen.add(name);
    for (const dependency of dependencies[name] || []) visit(dependency);
    files.push(name);
  }
  visit(file);
  return files.map(name => legacyModuleSource(name) + '\n' + (fixtureAssembly[name] || '')).join('\n');
}

// Small VM scenarios assemble only their requested modules. Production assembly
// lives in src/app/coordinator.ts; the scripts themselves only define these factories.
const shared = `runtime: window.YTGamepadRuntime, interaction: window.YTGamepadInteraction,
  controllerStyle: window.YTGamepadControllerStyle, focusManager: window.YTGamepadFocus`;
const fixtureAssembly = {
  'src/navigation/core.ts': `if (!window.YTGamepad) window.YTGamepadCoreModule.create({ ${shared}, navigation: window.YTGamepadNavigation });`,
  'src/sites/youtube.ts': `window.YTGamepadSiteModule.create({ ${shared}, diagnostics: window.YTGamepadDiagnostics });`,
  'src/input/gamepad.ts': `if (!window.YTGamepadInput) window.YTGamepadInputModule.create({ ${shared},
    isSearchOpen: () => !!(window.YTGamepadMenu?.opened && window.YTGamepadMenu.state.view === 'search') });`,
  'src/ui/menu.ts': `window.YTGamepadMenuModule.create({ ${shared}, styles: window.YTGamepadStyles,
    createSearch: port => window.YTGamepadSearch.create(Object.assign(port, { controllerStyle: window.YTGamepadControllerStyle,
      keyboard: window.YTGamepadKeyboard, pinyin: window.YTGamepadPinyin })) });`,
  'src/playback/watch.ts': `if (!window.YTGamepadWatch) window.YTGamepadWatchModule.create({ ${shared},
    createSurface: (callbacks, lifecycle) => createWatchSurface({ ${shared},
    createView: port => window.YTGamepadWatchView.create({ ...port, styles: window.YTGamepadStyles }),
    createPanels: port => window.YTGamepadWatchPanels.create(port) }, callbacks, lifecycle) });`,
  'src/app/browse.ts': `window.YTGamepadBrowseModule.create({ ${shared}, core: window.YTGamepad,
    isMenuOpen: () => !!window.YTGamepadMenu?.opened });`
};
