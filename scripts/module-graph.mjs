// Runtime prerequisites checked against the manifest and used by VM fixtures.
// Site and view instances are connected by coordinator; they do not import each other.
export const dependencies = {
  'src/shared/actions.js': [],
  'src/input/bindings.js': ['src/shared/actions.js'],
  'src/shared/runtime.js': [],
  'src/diagnostics/diagnostics.js': ['src/shared/runtime.js'],
  'src/diagnostics/diagnostics-store.js': [],
  'src/app/route-state.js': [],
  'src/app/state-machine.js': ['src/app/route-state.js'],
  'src/app/route-controller.js': ['src/shared/runtime.js', 'src/app/state-machine.js'],
  'src/input/controller-style.js': ['src/shared/runtime.js', 'src/ui/styles.js', 'src/input/bindings.js'],
  'src/input/gamepad.js': ['src/shared/runtime.js', 'src/input/controller-style.js'],
  'src/navigation/navigation.js': [],
  'src/navigation/focus.js': [],
  'src/navigation/core.js': ['src/shared/runtime.js', 'src/input/controller-style.js', 'src/app/state-machine.js', 'src/navigation/navigation.js', 'src/navigation/focus.js'],
  'src/search/keyboard.js': [],
  'src/search/pinyin-data.js': [],
  'src/search/pinyin.js': ['src/search/pinyin-data.js'],
  'src/ui/styles.js': [],
  'src/search/search.js': ['src/input/controller-style.js', 'src/search/keyboard.js', 'src/search/pinyin.js', 'src/app/state-machine.js'],
  'src/ui/menu.js': ['src/shared/runtime.js', 'src/ui/styles.js', 'src/search/search.js', 'src/navigation/focus.js', 'src/app/state-machine.js', 'src/input/controller-style.js'],
  'src/ui/watch-view.js': ['src/input/controller-style.js', 'src/ui/styles.js'],
  'src/ui/watch-panels.js': ['src/input/controller-style.js'],
  'src/playback/watch.js': ['src/shared/runtime.js', 'src/app/state-machine.js', 'src/ui/watch-view.js', 'src/ui/watch-panels.js', 'src/navigation/focus.js'],
  'src/app/browse.js': ['src/shared/runtime.js'],
  'src/sites/youtube.js': ['src/shared/actions.js', 'src/shared/runtime.js', 'src/navigation/focus.js'],
  'src/app/coordinator.js': ['src/input/bindings.js', 'src/diagnostics/diagnostics.js', 'src/shared/runtime.js', 'src/app/route-controller.js', 'src/navigation/core.js', 'src/sites/youtube.js'],
  'src/app/content.js': ['src/input/bindings.js'],
  'src/settings/inline-settings.js': ['src/input/bindings.js', 'src/diagnostics/diagnostics-store.js'],
  'src/background/background.js': ['src/diagnostics/diagnostics-store.js'],
  'src/popup/popup.js': []
};
export function assertLoadOrder(files) {
  const loaded = new Set();
  for (const file of files) {
    if (!(file in dependencies)) throw new Error(`Unregistered module: ${file}`);
    if (loaded.has(file)) throw new Error(`Duplicate module: ${file}`);
    for (const dependency of dependencies[file]) {
      if (!loaded.has(dependency)) throw new Error(`${file} requires ${dependency} before it`);
    }
    if (file === 'src/app/coordinator.js') {
      for (const module of compositionModules) {
        if (!loaded.has(module)) throw new Error(`src/app/coordinator.js requires ${module} before assembly`);
      }
    }
    loaded.add(file);
  }
}

// Full extension assembly requires these definitions; small VM policy tests can
// provide module doubles instead of rendering every feature.
export const compositionModules = ['src/navigation/focus.js', 'src/input/controller-style.js', 'src/input/gamepad.js',
  'src/ui/menu.js', 'src/playback/watch.js', 'src/app/browse.js', 'src/ui/styles.js', 'src/search/keyboard.js', 'src/search/pinyin.js'];
