import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import ts from 'typescript-vue';
import { entries } from './extension-entries.mjs';
import { releaseFiles } from './release-files.mjs';
import { styleSource } from './build-styles.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(resolve(root, 'manifest.json'), 'utf8'));
if (manifest.manifest_version !== 3) throw new Error('Expected Manifest V3');
for (const entry of manifest.content_scripts) {
  if (entry.js.length !== 1 || !(entry.js[0] in entries)) throw new Error('Expected a bundled content entry');
  if (new Set(entry.css || []).size !== (entry.css || []).length) throw new Error('Duplicate manifest stylesheet.');
}
if (readFileSync(resolve(root, 'src/ui/styles.ts'), 'utf8') !== styleSource()) {
  throw new Error('Shadow styles are stale. Run node scripts/build-styles.mjs.');
}
let count = 0;
function check(directory) {
  for (const item of readdirSync(directory, { withFileTypes: true })) {
    const file = resolve(directory, item.name);
    if (item.isDirectory()) { check(file); continue; }
    if (file.endsWith('.js')) throw new Error(`Source must be TypeScript: ${file}`);
    if (!/\.(js|ts)$/.test(file) || file.endsWith('.d.ts')) continue;
    const source = readFileSync(file, 'utf8');
    if (/(?:window|globalThis)\.YTGamepad|importScripts\(/.test(source)) throw new Error(`Legacy global dependency: ${file}`);
    const output = file.endsWith('.ts') ? ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText : source;
    const module = ts.createSourceFile(file, output, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
    for (const statement of module.statements) {
      if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
      const reference = statement.moduleSpecifier;
      if (!reference || !ts.isStringLiteral(reference)) continue;
      const specifier = reference.text;
      // Vite asset query suffixes select transformations, not filesystem names.
      const target = resolve(dirname(file), specifier.split(/[?#]/, 1)[0]);
      if (specifier.startsWith('.') && ![target, target + '.ts', target + '.js', target + '.vue', resolve(target, 'index.ts')].some(path => existsSync(path))) throw new Error(`Missing module ${specifier} in ${file}`);
    }
    execFileSync(process.execPath, ['--check', '--input-type=module'], { input: output, stdio: ['pipe', 'pipe', 'pipe'] });
    count++;
  }
}
check(resolve(root, 'src'));
releaseFiles(root, { source: true });
for (const path of manifest.content_scripts.flatMap(entry => entry.css || [])) {
  if (!existsSync(resolve(root, path))) throw new Error(`Missing stylesheet: ${path}`);
}
if (!existsSync(resolve(root, manifest.action.default_popup))) throw new Error('Missing popup');
if (!existsSync(resolve(root, manifest.options_ui.page))) throw new Error('Missing options page');
console.log(`Manifest, assets and ${count} ESM source files validated.`);
// The fast module check is useful during iteration. Release builds always
// run the default command with every strict TypeScript and Vue check.
if (process.argv.includes('--modules-only')) process.exit(0);
execFileSync(process.execPath, [resolve(root, 'node_modules/typescript/bin/tsc'), '-p', resolve(root, 'tsconfig.json')], { stdio: 'inherit' });
console.log('Port and snapshot type contracts validated.');
execFileSync(process.execPath, [resolve(root, 'scripts/check-vue.cjs'), '-p', resolve(root, 'tsconfig.menu.json')], { stdio: 'inherit' });
console.log('Vue quick menu and page interaction Pinia types validated.');
execFileSync(process.execPath, [resolve(root, 'scripts/check-vue.cjs'), '-p', resolve(root, 'tsconfig.browse.json')], { stdio: 'inherit' });
console.log('Vue browse grid, adapter and store types validated.');

execFileSync(process.execPath, [resolve(root, 'scripts/check-vue.cjs'), '-p', resolve(root, 'tsconfig.pages.json')], { stdio: 'inherit' });
console.log('Vue page and settings type contracts validated.');
