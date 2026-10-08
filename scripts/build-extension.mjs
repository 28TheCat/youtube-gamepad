import { build } from 'vite';
import vue from '@vitejs/plugin-vue';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { entries } from './extension-entries.mjs';
import { releaseFiles, safePath } from './release-files.mjs';
import { styleSource } from './build-styles.mjs';

export const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const buildDirectory = resolve(repository, 'dist');
export async function buildExtension() {
  writeFileSync(resolve(repository, 'src/ui/styles.ts'), styleSource());
  let first = true;
  for (const [file, source] of Object.entries(entries)) {
    await build({
      configFile: false, root: repository, publicDir: false, logLevel: 'warn',
      define: {
        'process.env.NODE_ENV': JSON.stringify('production'),
        __VUE_OPTIONS_API__: false,
        __VUE_PROD_DEVTOOLS__: false,
        __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false
      },
      // Page overlays must render without HTML-string sinks on YouTube.
      plugins: [vue({ template: { compilerOptions: { hoistStatic: false, isCustomElement: tag => tag === 'selectedcontent' } } })],
      build: {
        outDir: buildDirectory, emptyOutDir: first, minify: false,
        sourcemap: false, target: 'es2022',
        lib: { entry: resolve(repository, source), formats: ['iife'], name: 'YTGamepadEntry', fileName: () => file },
      }
    });
    first = false;
  }
  // Copy only the same explicit assets that release validation inventories.
  const { files } = releaseFiles(repository, { source: true });
  for (const file of files.filter(file => !(file in entries))) {
    const destination = resolve(buildDirectory, file);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(safePath(repository, file), destination);
  }
  const manifest = JSON.parse(readFileSync(resolve(buildDirectory, 'manifest.json'), 'utf8'));
  if (manifest.content_scripts.some(entry => entry.js.length !== 1)) throw new Error('Expected one bundle per content world');
  console.log(`Built extension: ${buildDirectory}`);
  return buildDirectory;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await buildExtension();
