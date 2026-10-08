import type { Dispose, Runtime, Scope } from '../../types/ports';

export let YTGamepadRuntime!: Runtime;
// Per-module resources. Replacing a scope disposes its previous instance.
(() => {
  if (YTGamepadRuntime) return;
    const scopes: Map<string, Scope> = new Map();
  function scope(name: string) {
    scopes.get(name)?.destroy();
    const resources: Set<Dispose> = new Set(), timeouts: Map<number | undefined, Dispose> = new Map();
    let destroyed = false;
    function cleanup(dispose: Dispose) {
      if (destroyed) { dispose(); return () => {}; }
      const release = () => { if (resources.delete(release)) dispose(); };
      resources.add(release); return release;
    }
    const api: Scope = {
      get destroyed() { return destroyed; },
      get size() { return resources.size; }, cleanup,
      listen(target: EventTarget, type: string, listener: EventListener, options?: boolean | AddEventListenerOptions | undefined) {
        if (destroyed || !target?.addEventListener) return () => {};
        const guarded: EventListener = event => { if (!destroyed) return listener(event); };
        target.addEventListener(type, guarded, options);
        return cleanup(() => target.removeEventListener?.(type, guarded, options));
      },
      timeout(callback: () => void, delay?: number|undefined) {
        if (destroyed || typeof setTimeout !== 'function') return;
        let id: number|undefined, completed = false;
        const release = cleanup(() => { if (id !== undefined) clearTimeout(id); timeouts.delete(id); });
        id = setTimeout(() => { completed = true; release(); if (!destroyed) callback(); }, delay);
        if (!completed) timeouts.set(id, release); return id;
      },
      clearTimeout(id?: number | undefined) { timeouts.get(id)?.(); },
      interval(callback: () => void, delay?: number|undefined) {
        if (destroyed || typeof setInterval !== 'function') return;
        const id = setInterval(() => { if (!destroyed) callback(); }, delay);
        cleanup(() => { if (typeof clearInterval === 'function') clearInterval(id); }); return id;
      },
      frame(callback: (arg0: number) => void) {
        if (destroyed || typeof requestAnimationFrame !== 'function') return;
        let id: number|undefined;
        const release = cleanup(() => { if (id !== undefined && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id); });
        id = requestAnimationFrame(time => { release(); if (!destroyed) callback(time); });
        return id;
      },
      observer(callback: MutationCallback) {
        const observer = new MutationObserver((...args) => { if (!destroyed) callback(...args); });
        const observe = observer.observe.bind(observer), disconnect = observer.disconnect?.bind(observer);
        let release: (() => void)|undefined;
        observer.observe = (...args) => {
          if (destroyed) return;
          release ||= cleanup(() => { disconnect?.(); release = undefined; });
          return observe(...args);
        };
        observer.disconnect = () => { release?.(); };
        return observer;
      },
      destroy() {
        if (destroyed) return;
        destroyed = true;
        const errors = [];
        for (const dispose of [...resources].reverse()) { try { dispose(); } catch (error) { errors.push(error); } }
        resources.clear(); timeouts.clear();
        if (scopes.get(name) === api) scopes.delete(name);
        if (errors.length) console.warn('YouTube Gamepad cleanup:', errors);
      }
    };
    scopes.set(name, api); return api;
  }
  YTGamepadRuntime = { scope,
    destroy() { for (const entry of [...scopes.values()].reverse()) entry.destroy(); },
    get resources() { return Object.fromEntries([...scopes].map(([name, entry]) => [name, entry.size])); }
  };
})();
