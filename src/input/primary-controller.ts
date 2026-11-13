export function findPrimaryController(currentIndex: number | null): Gamepad | undefined {
  let first: Gamepad | undefined;
  for (const pad of navigator.getGamepads?.() ?? []) {
    if (!pad?.connected || pad.mapping !== 'standard') continue;
    if (pad.index === currentIndex) return pad;
    first ??= pad;
  }
  return first;
}
