import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function controllerAssets(root) {
  const kenney = JSON.parse(readFileSync(resolve(root, 'assets/controller/kenney.json'), 'utf8'));
  const template = JSON.parse(readFileSync(resolve(root, 'assets/controller/template.json'), 'utf8'));
  const profiles = { ...kenney.profiles, generic: { ...kenney.profiles.xbox } };
  return { profiles, files: { ...kenney.files, ...template.files } };
}
