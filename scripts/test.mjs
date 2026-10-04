import { readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv[2] || 'unit';
if (!['unit', 'browser', 'extension', 'live', 'all'].includes(mode)) throw new Error(`Unknown test mode: ${mode}`);
const groups = { 'module-combinations.test.mjs': 'browser', 'extension-e2e.test.mjs': 'extension', 'youtube-live.test.mjs': 'live' };
const tests = readdirSync(resolve(root, 'tests')).filter(file => file.endsWith('.test.mjs'))
  .filter(file => mode === 'all' ? groups[file] !== 'live' : (groups[file] || 'unit') === mode)
  .sort().map(file => resolve(root, 'tests', file));
const result = spawnSync(process.execPath, ['--test', ...tests], { cwd: root, stdio: 'inherit',
  env: { ...process.env, ...(mode !== 'unit' ? { REQUIRE_BROWSER_TESTS: '1' } : {}) } });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
