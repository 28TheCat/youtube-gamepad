import type { Action, Settings } from './ports';
declare global {
  interface WindowEventMap {
    visibilitychange: Event;
    'yt-gamepad-action': CustomEvent<{ action: Action }>;
    'yt-gamepad-input-mode': CustomEvent<{ mode: 'gamepad' | 'mouse' | 'keyboard' }>;
    'yt-gamepad-local-settings': CustomEvent<Partial<Settings>>;
    'yt-gamepad-controller-style': CustomEvent<{ family: string }>;
    'yt-gamepad-escape-request': CustomEvent<KeyboardEvent>;
  }
}
