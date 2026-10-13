import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function controllerAssets(root) {
  const kenney = JSON.parse(readFileSync(resolve(root, 'assets/controller/kenney.json'), 'utf8'));
  const controllerFont = JSON.parse(readFileSync(resolve(root, 'assets/controller/controller-font/prompts.json'), 'utf8'));
  const profiles = Object.fromEntries(Object.entries(kenney.profiles).map(([family, keys]) =>
    [family, { ...keys, ...controllerFont.profiles[family] }]));
  profiles.generic = { ...profiles.generic, ...controllerFont.profiles.xbox };
  return { profiles, files: { ...kenney.files, ...controllerFont.files } };
}
