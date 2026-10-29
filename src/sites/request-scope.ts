/** Tracks requests belonging to the current route or account session. */
export function createRequestScope() {
  const active = new Set<AbortController>();
  let destroyed = false;
  function cancel() {
    for (const controller of active) controller.abort();
    active.clear();
  }
  return {
    get pending() { return active.size > 0; },
    begin(timeoutMs?: number) {
      if (destroyed) throw new Error('Request scope destroyed');
      const controller = new AbortController();
      active.add(controller);
      const timeout = timeoutMs === undefined ? undefined : setTimeout(() => controller.abort(), timeoutMs);
      return {
        signal: controller.signal,
        get current() { return !destroyed && !controller.signal.aborted; },
        finish() {
          if (timeout !== undefined) clearTimeout(timeout);
          active.delete(controller);
        }
      };
    },
    cancel,
    destroy() { destroyed = true; cancel(); }
  };
}
