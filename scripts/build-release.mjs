import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, copyFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { releaseFiles, safePath } from './release-files.mjs';
import { checkRelease } from './check-release.mjs';
import { buildExtension } from './build-extension.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const check = spawnSync(process.execPath, [resolve(root, 'scripts/check.mjs')], { stdio: 'inherit' });
if (check.error) throw check.error;
if (check.status !== 0) process.exit(check.status ?? 1);
const built = await buildExtension();
const { files, version } = releaseFiles(built);
const packageVersion = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version;
if (version !== packageVersion) throw new Error('Package and manifest versions differ.');
mkdirSync(resolve(root, 'output/releases'), { recursive: true });
const destination = mkdtempSync(resolve(root, `output/releases/youtube-gamepad-${version}-`));
const inventory = {};
for (const file of files) {
  const source = safePath(built, file), target = resolve(destination, file);
  mkdirSync(dirname(target), { recursive: true }); copyFileSync(source, target);
  inventory[file] = createHash('sha256').update(readFileSync(target)).digest('hex');
}
// The inventory is kept beside the loadable extension, never injected into its pages.
writeFileSync(destination + '.inventory.json', JSON.stringify({ version, files: inventory }, null, 2) + '\n');
checkRelease(destination);
writeFileSync(resolve(root, 'output/releases/latest.json'), JSON.stringify({ directory: destination }, null, 2) + '\n');
console.log(`Verified release: ${destination} (${files.length} files)`);
