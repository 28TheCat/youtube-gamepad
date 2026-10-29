import type { DisposerHost } from '../../types/core';
// Reinjection replaces the previous private module graph. Keep only its disposer
// on a symbol, following the existing ISOLATED bridge lifecycle convention.
const key = Symbol.for('yt-gamepad.main.dispose');
const previous = (window as unknown as DisposerHost)[key];
if (typeof previous === 'function') previous();
if ((window as unknown as DisposerHost)[key] === previous) delete (window as unknown as DisposerHost)[key];

export function registerMainDispose(dispose: { (): void; (): void; }) {
  (window as unknown as DisposerHost)[key] = () => {
    document.removeEventListener('ytg-extension-handoff', current);
    dispose();
    if ((window as unknown as DisposerHost)[key] === current) delete (window as unknown as DisposerHost)[key];
  };
  const current = (window as unknown as DisposerHost)[key]!;
  document.addEventListener('ytg-extension-handoff', current);
}
