// Compatibility dependencies for legacy VM/DOM fixtures only. Production
// dependencies are declared by source imports and resolved by Vite.
// Site and view instances are connected by coordinator; they do not import each other.
export const dependencies = {
  'src/shared/actions.ts': [],
  'src/playback/seek.ts': [],
  'src/input/bindings.ts': ['src/shared/actions.ts'],
  'src/shared/runtime.ts': [],
  'src/diagnostics/diagnostics.ts': ['src/shared/runtime.ts'],
  'src/diagnostics/diagnostics-store.ts': [],
  'src/app/route-state.ts': [],
  'src/app/state-machine.ts': ['src/app/route-state.ts'],
  'src/app/route-controller.ts': ['src/shared/runtime.ts', 'src/app/state-machine.ts'],
  'src/input/controller-style.ts': ['src/shared/runtime.ts', 'src/ui/styles.ts', 'src/input/bindings.ts'],
  'src/input/gamepad.ts': ['src/shared/runtime.ts', 'src/input/controller-style.ts'],
  'src/navigation/navigation.ts': [],
  'src/navigation/focus.ts': [],
  'src/navigation/core.ts': ['src/shared/runtime.ts', 'src/input/controller-style.ts', 'src/app/state-machine.ts', 'src/navigation/navigation.ts', 'src/navigation/focus.ts'],
  'src/search/keyboard.ts': [],
  'src/search/pinyin-data.ts': [],
  'src/search/pinyin.ts': ['src/search/pinyin-data.ts'],
  'src/ui/styles.ts': [],
  'src/search/search-text.ts': [],
  'src/search/search-model.ts': ['src/search/search-text.ts'],
  'src/search/mount-search.ts': [],
  'src/search/search.ts': ['src/input/controller-style.ts', 'src/search/keyboard.ts', 'src/search/pinyin.ts', 'src/app/state-machine.ts', 'src/search/search-model.ts', 'src/search/mount-search.ts'],
  'src/ui/menu.ts': ['src/shared/runtime.ts', 'src/ui/styles.ts', 'src/search/search.ts', 'src/navigation/focus.ts', 'src/app/state-machine.ts', 'src/input/controller-style.ts'],
  'src/ui/watch-view.ts': ['src/input/controller-style.ts', 'src/ui/styles.ts'],
  'src/ui/mount-watch-panel.ts': [],
  'src/ui/watch-panels.ts': ['src/input/controller-style.ts', 'src/ui/mount-watch-panel.ts'],
  'src/ui/playback-presentation.ts': [],
  'src/ui/watch-surface.ts': ['src/ui/playback-presentation.ts'],
  'src/playback/watch.ts': ['src/shared/runtime.ts', 'src/app/state-machine.ts', 'src/ui/watch-view.ts', 'src/ui/watch-panels.ts', 'src/navigation/focus.ts', 'src/ui/watch-surface.ts'],
  'src/app/browse.ts': ['src/shared/runtime.ts'],
  'src/sites/youtube.ts': ['src/shared/actions.ts', 'src/playback/seek.ts', 'src/shared/runtime.ts', 'src/navigation/focus.ts'],
  'src/app/coordinator.ts': ['src/input/bindings.ts', 'src/diagnostics/diagnostics.ts', 'src/shared/runtime.ts', 'src/app/route-controller.ts', 'src/navigation/core.ts', 'src/sites/youtube.ts'],
  'src/app/content.ts': ['src/input/bindings.ts'],
  'src/settings/inline-settings.ts': ['src/input/bindings.ts', 'src/diagnostics/diagnostics-store.ts'],
  'src/background/background.ts': ['src/diagnostics/diagnostics-store.ts']
};
export function assertLoadOrder(files) {
  const loaded = new Set();
  for (const file of files) {
    if (!(file in dependencies)) throw new Error(`Unregistered module: ${file}`);
    if (loaded.has(file)) throw new Error(`Duplicate module: ${file}`);
    for (const dependency of dependencies[file]) {
      if (!loaded.has(dependency)) throw new Error(`${file} requires ${dependency} before it`);
    }
    if (file === 'src/app/coordinator.ts') {
      for (const module of compositionModules) {
        if (!loaded.has(module)) throw new Error(`src/app/coordinator.ts requires ${module} before assembly`);
      }
    }
    loaded.add(file);
  }
}

// Full extension assembly requires these definitions; small VM policy tests can
// provide module doubles instead of rendering every feature.
export const compositionModules = ['src/navigation/focus.ts', 'src/input/controller-style.ts', 'src/input/gamepad.ts',
  'src/ui/menu.ts', 'src/playback/watch.ts', 'src/app/browse.ts', 'src/ui/styles.ts', 'src/search/keyboard.ts', 'src/search/pinyin.ts'];
