import { readFileSync } from 'node:fs';
import { dependencies } from './module-graph.mjs';
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
  return files.map(name => readFileSync(new URL('../' + name, import.meta.url), 'utf8') + '\n' + (fixtureAssembly[name] || '')).join('\n');
}

// Small VM scenarios assemble only their requested modules. Production assembly
// lives in coordinator.js; the scripts themselves only define these factories.
const shared = `runtime: window.YTGamepadRuntime, interaction: window.YTGamepadInteraction,
  controllerStyle: window.YTGamepadControllerStyle, focusManager: window.YTGamepadFocus`;
const fixtureAssembly = {
  'core.js': `if (!window.YTGamepad) window.YTGamepadCoreModule.create({ ${shared}, navigation: window.YTGamepadNavigation });`,
  'sites/youtube.js': `window.YTGamepadSiteModule.create({ ${shared}, diagnostics: window.YTGamepadDiagnostics });`,
  'gamepad.js': `if (!window.YTGamepadInput) window.YTGamepadInputModule.create({ ${shared},
    isSearchOpen: () => !!(window.YTGamepadMenu?.opened && window.YTGamepadMenu.state.view === 'search') });`,
  'menu.js': `window.YTGamepadMenuModule.create({ ${shared}, styles: window.YTGamepadStyles,
    createSearch: port => window.YTGamepadSearch.create(Object.assign(port, { controllerStyle: window.YTGamepadControllerStyle,
      keyboard: window.YTGamepadKeyboard, pinyin: window.YTGamepadPinyin })) });`,
  'watch.js': `if (!window.YTGamepadWatch) window.YTGamepadWatchModule.create({ ${shared},
    createView: port => window.YTGamepadWatchView.create({ ...port, styles: window.YTGamepadStyles }),
    createPanels: port => window.YTGamepadWatchPanels.create(port) });`,
  'browse.js': `window.YTGamepadBrowseModule.create({ ${shared}, core: window.YTGamepad,
    isMenuOpen: () => !!window.YTGamepadMenu?.opened });`
};
