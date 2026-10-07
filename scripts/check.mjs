import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';
import { execFileSync } from 'node:child_process';
import { assertLoadOrder } from './module-graph.mjs';
import { styleSource } from './build-styles.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(resolve(root, 'manifest.json'), 'utf8'));
if (manifest.manifest_version !== 3) throw new Error('Expected Manifest V3');
for (const entry of manifest.content_scripts) {
  assertLoadOrder(entry.js);
  if (new Set(entry.css || []).size !== (entry.css || []).length) throw new Error('Duplicate manifest stylesheet.');
}
if (readFileSync(resolve(root, 'src/ui/styles.js'), 'utf8') !== styleSource()) {
  throw new Error('Shadow styles are stale. Run node scripts/build-styles.mjs.');
}
const scripts = [...manifest.content_scripts.flatMap(entry => entry.js), manifest.background.service_worker, 'src/popup/popup.js', 'src/settings/options.js', 'src/settings/options-bindings.js', 'src/ui/theme-sync.js', 'src/ui/controller-sync.js'];
for (const path of scripts) new Script(readFileSync(resolve(root, path), 'utf8'), { filename: path });
for (const path of manifest.content_scripts.flatMap(entry => entry.css || [])) {
  if (!existsSync(resolve(root, path))) throw new Error(`Missing stylesheet: ${path}`);
}
if (!existsSync(resolve(root, manifest.action.default_popup))) throw new Error('Missing popup');
if (!existsSync(resolve(root, manifest.options_ui.page))) throw new Error('Missing options page');
console.log(`Manifest and ${scripts.length} JavaScript files validated.`);
execFileSync(process.execPath, [resolve(root, 'node_modules/typescript/bin/tsc'), '-p', resolve(root, 'tsconfig.json')], { stdio: 'inherit' });
console.log('Port and snapshot type contracts validated.');
