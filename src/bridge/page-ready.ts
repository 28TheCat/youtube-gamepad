import type { PageAccess } from './page-protocol';

// A bounded handshake tolerates a late MAIN entry. Cancellation prevents a
// replaced application from mounting and releases its pending retry timer.
export function waitForPageServer(client: PageAccess, signal: AbortSignal,
  timeoutMs = 3000, retryMs = 100): Promise<boolean> {
  return new Promise(resolve => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = Date.now() + timeoutMs;
    const finish = (ready: boolean) => {
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
      resolve(ready);
    };
    const cancel = () => finish(false);
    const check = () => {
      if (signal.aborted) { finish(false); return; }
      if (client.ping?.()) { finish(true); return; }
      const remaining = deadline - Date.now();
      if (remaining <= 0) { finish(false); return; }
      timer = setTimeout(check, Math.min(retryMs, remaining));
    };
    signal.addEventListener('abort', cancel, { once: true });
    check();
  });
}
