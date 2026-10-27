import { build } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';
import { moduleGraph } from '../../scripts/module-graph.mjs';

let pending;
// Browser scenarios inspect module instances through test-only getters. Build
// the current composition root, including Vue views, rather than stripping imports.
export function mainFixture() {
  const modules = [...moduleGraph(['src/app/application.ts']).keys()].filter(path => !['src/app/application.ts', 'src/app/content.ts', 'src/settings/inline-settings.ts'].includes(path));
  const id = fileURLToPath(new URL('./main-fixture-entry.ts', import.meta.url)).replaceAll('\\', '/');
  const source = modules.map((path, index) => `import * as m${index} from '/${path}';`).join('\n')
    + "\nimport '/src/entries/main.ts';\nimport '/src/app/application.ts';\nimport { ui } from '/src/ui/ui-api.ts';\nObject.defineProperty(window, '__testUi', { configurable: true, value: ui });\n"
    + "\nimport { YTGamepadRuntime } from '/src/shared/runtime.ts';\nYTGamepadRuntime.scope('page-fixture').cleanup(() => window[Symbol.for('yt-gamepad.page.dispose')]?.());\n"
    + modules.map((_, index) => `for (const key of Object.keys(m${index}).filter(key => key.startsWith('YTGamepad'))) {
      Object.defineProperty(window, key, { configurable: true, get: () => m${index}[key] });
    }`).join('\n');
  return pending ||= build({ root: fileURLToPath(new URL('../../', import.meta.url)), configFile: false, publicDir: false, logLevel: 'silent',
    define: { 'process.env.NODE_ENV': JSON.stringify('production'),
      __VUE_OPTIONS_API__: false, __VUE_PROD_DEVTOOLS__: false, __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false },
    plugins: [{ name: 'main-fixture', enforce: 'pre', resolveId: value => value.replaceAll('\\', '/') === id ? id : undefined,
      load: value => value === id ? source : undefined,
      transform(code, path) { if (path.replaceAll('\\','/').endsWith('/src/app/application.ts')) return code.replace('export const localChannel = createApplicationChannel();', 'const localChannel = undefined;').replace('configureDiagnosticsChannel(localChannel);', '').replace(/const disposeContent = startContent\(localChannel, \(\) => YTGamepadRuntime.destroy\(\)(?:, settingsApplied)?\);/, 'const disposeContent = () => {};').replace('await initialSettings;', 'settingsApplied(); await initialSettings;'); } },
      vue({ template: { compilerOptions: { hoistStatic: false, isCustomElement: tag => tag === 'selectedcontent' } } })],
    build: { write: false, minify: false, target: 'es2022',
      lib: { entry: id, formats: ['iife'], name: 'MainFixture' } }
  }).then(result => (Array.isArray(result) ? result[0] : result).output.find(item => item.type === 'chunk').code);
}
