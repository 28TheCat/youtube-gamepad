// Runtime prerequisites checked against the manifest and used by VM fixtures.
// Site and view instances are connected by coordinator; they do not import each other.
export const dependencies = {
  'runtime.js': [],
  'diagnostics.js': ['runtime.js'],
  'diagnostics-store.js': [],
  'app/route-state.js': [],
  'state-machine.js': ['app/route-state.js'],
  'app/route-controller.js': ['runtime.js', 'state-machine.js'],
  'gamepad.js': ['runtime.js'],
  'navigation.js': [],
  'focus.js': [],
  'core.js': ['runtime.js', 'state-machine.js', 'navigation.js'],
  'keyboard.js': [],
  'pinyin-data.js': [],
  'pinyin.js': ['pinyin-data.js'],
  'ui/styles.js': [],
  'search.js': ['keyboard.js', 'pinyin.js', 'state-machine.js'],
  'menu.js': ['runtime.js', 'ui/styles.js', 'search.js'],
  'ui/watch-view.js': ['ui/styles.js'],
  'ui/watch-panels.js': [],
  'watch.js': ['runtime.js', 'state-machine.js', 'ui/watch-view.js', 'ui/watch-panels.js'],
  'browse.js': ['runtime.js'],
  'sites/youtube.js': ['runtime.js'],
  'coordinator.js': ['diagnostics.js', 'runtime.js', 'app/route-controller.js', 'core.js', 'sites/youtube.js'],
  'content.js': ['runtime.js'],
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
    loaded.add(file);
  }
}
