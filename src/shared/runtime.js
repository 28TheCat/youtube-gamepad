// Per-module resources. Replacing a scope disposes its previous instance.
(() => {
  if (window.YTGamepadRuntime) return;
  const scopes = new Map();
  function scope(name) {
    scopes.get(name)?.destroy();
    const resources = new Set(), timeouts = new Map();
    let destroyed = false;
    function cleanup(dispose) {
      if (destroyed) { dispose(); return () => {}; }
      const release = () => { if (resources.delete(release)) dispose(); };
      resources.add(release); return release;
    }
    const api = {
      get destroyed() { return destroyed; },
      get size() { return resources.size; }, cleanup,
      listen(target, type, listener, options) {
        if (destroyed || !target?.addEventListener) return () => {};
        const guarded = (...args) => { if (!destroyed) return listener(...args); };
        target.addEventListener(type, guarded, options);
        return cleanup(() => target.removeEventListener?.(type, guarded, options));
      },
      timeout(callback, delay) {
        if (destroyed || typeof setTimeout !== 'function') return;
        let id, completed = false;
        const release = cleanup(() => { if (id !== undefined) clearTimeout(id); timeouts.delete(id); });
        id = setTimeout(() => { completed = true; release(); if (!destroyed) callback(); }, delay);
        if (!completed) timeouts.set(id, release); return id;
      },
      clearTimeout(id) { timeouts.get(id)?.(); },
      interval(callback, delay) {
        if (destroyed || typeof setInterval !== 'function') return;
        const id = setInterval(() => { if (!destroyed) callback(); }, delay);
        cleanup(() => { if (typeof clearInterval === 'function') clearInterval(id); }); return id;
      },
      frame(callback) {
        if (destroyed || typeof requestAnimationFrame !== 'function') return;
        let id;
        const release = cleanup(() => { if (id !== undefined && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id); });
        id = requestAnimationFrame(time => { release(); if (!destroyed) callback(time); });
        return id;
      },
      observer(callback) {
        const observer = new MutationObserver((...args) => { if (!destroyed) callback(...args); });
        const observe = observer.observe.bind(observer), disconnect = observer.disconnect?.bind(observer);
        let release;
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
  window.YTGamepadRuntime = { scope,
    destroy() { for (const entry of [...scopes.values()].reverse()) entry.destroy(); },
    get resources() { return Object.fromEntries([...scopes].map(([name, entry]) => [name, entry.size])); }
  };
})();
