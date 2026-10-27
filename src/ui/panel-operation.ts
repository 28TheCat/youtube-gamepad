export interface PanelOperationPort {
  active(): boolean;
  route(): string;
  changed(): void;
}

/** Serialize requests and discard completions after reset or navigation. */
export function createPanelOperation(port: PanelOperationPort, state: { loading: boolean; failed: boolean }) {
  let version = 0;
  return {
    reset() { ++version; state.loading = false; state.failed = false; },
    async run<T>(request: () => Promise<T>, apply: (value: T) => boolean): Promise<boolean | undefined> {
      if (state.loading || !port.active()) return;
      const current = ++version, route = port.route();
      const valid = () => current === version && route === port.route();
      state.loading = true; state.failed = false; port.changed();
      try {
        let ok = false;
        try {
          const value = await request();
          if (!valid() || !port.active()) return;
          ok = apply(value);
        } catch { /* Never retry a request automatically. */ }
        if (!valid() || !port.active()) return;
        state.failed = !ok;
        return ok;
      } finally {
        if (valid()) { state.loading = false; if (port.active()) port.changed(); }
      }
    }
  };
}
