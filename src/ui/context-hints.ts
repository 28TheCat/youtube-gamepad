/** Describe only the action the focused, enabled target accepts. */
export function confirmHint(target: HTMLElement | null | undefined): string {
  if (!target || target.matches?.(':disabled,[aria-disabled="true"]')) return '';
  if (target.matches?.('input[type="range"],[role="slider"]')) return 'A Adjust';
  if (target.matches?.('input[type="checkbox"],[role="checkbox"],[role="switch"]')) return 'A Toggle';
  return 'A Confirm';
}
export function dialogHints(target: HTMLElement | null | undefined, closeMenu = false): string {
  return ['D-pad: Select', confirmHint(target), 'B Back', closeMenu ? 'Start Close' : ''].filter(Boolean).join(' · ');
}
