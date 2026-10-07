// Runtime prerequisites checked against the manifest and used by VM fixtures.
// Site and view instances are connected by coordinator; they do not import each other.
export const dependencies = {
  'actions.js': [],
  'bindings.js': ['actions.js'],
  'runtime.js': [],
  'diagnostics.js': ['runtime.js'],
  'diagnostics-store.js': [],
  'app/route-state.js': [],
  'state-machine.js': ['app/route-state.js'],
  'app/route-controller.js': ['runtime.js', 'state-machine.js'],
  'controller-style.js': ['runtime.js', 'ui/styles.js', 'bindings.js'],
  'gamepad.js': ['runtime.js', 'controller-style.js'],
  'navigation.js': [],
  'focus.js': [],
  'core.js': ['runtime.js', 'controller-style.js', 'state-machine.js', 'navigation.js', 'focus.js'],
  'keyboard.js': [],
  'pinyin-data.js': [],
  'pinyin.js': ['pinyin-data.js'],
  'ui/styles.js': [],
  'search.js': ['controller-style.js', 'keyboard.js', 'pinyin.js', 'state-machine.js'],
  'menu.js': ['runtime.js', 'ui/styles.js', 'search.js', 'focus.js', 'state-machine.js', 'controller-style.js'],
  'ui/watch-view.js': ['controller-style.js', 'ui/styles.js'],
  'ui/watch-panels.js': ['controller-style.js'],
  'watch.js': ['runtime.js', 'state-machine.js', 'ui/watch-view.js', 'ui/watch-panels.js', 'focus.js'],
  'browse.js': ['runtime.js'],
  'sites/youtube.js': ['actions.js', 'runtime.js', 'focus.js'],
  'coordinator.js': ['bindings.js', 'diagnostics.js', 'runtime.js', 'app/route-controller.js', 'core.js', 'sites/youtube.js'],
  'content.js': ['bindings.js'],
  'inline-settings.js': ['bindings.js', 'diagnostics-store.js'],
  'background.js': ['diagnostics-store.js'],
  'popup.js': []
};
export function assertLoadOrder(files) {
  const loaded = new Set();
  for (const file of files) {
    if (!(file in dependencies)) throw new Error(`Unregistered module: ${file}`);
    if (loaded.has(file)) throw new Error(`Duplicate module: ${file}`);
    for (const dependency of dependencies[file]) {
      if (!loaded.has(dependency)) throw new Error(`${file} requires ${dependency} before it`);
    }
    if (file === 'coordinator.js') {
      for (const module of compositionModules) {
        if (!loaded.has(module)) throw new Error(`coordinator.js requires ${module} before assembly`);
      }
    }
    loaded.add(file);
  }
}

// Full extension assembly requires these definitions; small VM policy tests can
// provide module doubles instead of rendering every feature.
export const compositionModules = ['focus.js', 'controller-style.js', 'gamepad.js',
  'menu.js', 'watch.js', 'browse.js', 'ui/styles.js', 'keyboard.js', 'pinyin.js'];
