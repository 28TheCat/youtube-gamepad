import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { Script } from 'node:vm';
import { releaseFiles, safePath } from './release-files.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export function checkRelease(directory) {
  directory = resolve(directory);
  const { files, version } = releaseFiles(directory);
  const inventory = JSON.parse(readFileSync(directory + '.inventory.json', 'utf8'));
  const actual = [];
  function walk(path) {
    for (const item of readdirSync(path, { withFileTypes: true })) {
      const full = resolve(path, item.name);
      if (item.isSymbolicLink()) throw new Error(`Symlink in release: ${item.name}`);
      if (item.isDirectory()) walk(full);
      else actual.push(relative(directory, full).replaceAll('\\', '/'));
    }
  }
  walk(directory);
  if (version !== inventory.version || JSON.stringify(actual.sort()) !== JSON.stringify(files) ||
      JSON.stringify(Object.keys(inventory.files).sort()) !== JSON.stringify(files)) throw new Error('Release inventory mismatch.');
  for (const file of files) {
    const content = readFileSync(safePath(directory, file));
    if (createHash('sha256').update(content).digest('hex') !== inventory.files[file]) throw new Error(`Changed release file: ${file}`);
    if (file.endsWith('.js')) new Script(content.toString('utf8'), { filename: file });
  }
  return files.length;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = process.argv[2] || JSON.parse(readFileSync(resolve(root, 'output/releases/latest.json'), 'utf8')).directory;
  console.log(`Release verified: ${checkRelease(directory)} files`);
}
