import type { ApplicationChannel, ApplicationMessage } from '../../types/ports';

// A module-private channel: page scripts cannot forge settings or diagnostics.
export function createApplicationChannel(): ApplicationChannel {
  const listeners = new Set<(message: ApplicationMessage) => void>();
  return {
    publish(message) { for (const listener of [...listeners]) listener(message); },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; }
  };
}
