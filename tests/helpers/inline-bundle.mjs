import { build } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';

let pending;
// Only the legacy DOM fixture exposes this handle. Extension bundles remain private.
export function inlineSettingsFixture() {
  return pending ||= build({ configFile: false, publicDir: false, logLevel: 'silent',
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    plugins: [vue({ template: { compilerOptions: { hoistStatic: false } } })],
    build: { write: false, minify: false, target: 'es2022',
      lib: { entry: fileURLToPath(new URL('../../src/settings/inline-settings.ts', import.meta.url)),
        formats: ['iife'], name: 'InlineSettingsFixture' } }
  }).then(result => (Array.isArray(result) ? result[0] : result).output.find(item => item.type === 'chunk').code
    + '\nwindow.YTGamepadInlineSettings = InlineSettingsFixture.YTGamepadInlineSettings;');
}
