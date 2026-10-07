// One policy for temporary-layer restoration; owners resolve and focus their own DOM.
(() => {
  if (window.YTGamepadFocus) return;
  const owners = new Map(), layers = [];
  const suspendedScopes = new Map();
  function syncSuspendedScopes() {
    const top = layers.at(-1), next = new Set();
    if (top?.priority > 0) {
      for (const layer of layers.slice(0, -1)) {
        const scope = layer.token;
        if (scope?.setAttribute && scope?.removeAttribute && scope?.getAttribute &&
            scope.isConnected && !scope.contains?.(top.token) &&
            (suspendedScopes.has(scope) || scope.getAttribute('inert') === null)) next.add(scope);
      }
    }
    // Release before restoring focus. Only remove attributes this module added.
    for (const scope of suspendedScopes.keys()) {
      if (!next.has(scope)) { scope.removeAttribute('inert'); suspendedScopes.delete(scope); }
    }
    for (const scope of next) {
      if (!suspendedScopes.has(scope)) { scope.setAttribute('inert', ''); suspendedScopes.set(scope, true); }
    }
  }
  const routeKey = () => location.pathname + location.search;
  function capture(preferred) {
    const owner = preferred || [...owners.keys()].reverse().find(name => owners.get(name).active());
    const adapter = owners.get(owner);
    const target = adapter?.capture();
    if (!target) return null;
    const items = adapter.items(target.region, target), keys = items.map(item => item.itemKey);
    const matches = items.filter(item => item.itemKey === target.itemKey);
    const occurrence = matches.findIndex(item => target.el ? item.el === target.el : item.index === target.index);
    return { ...target, owner, routeKey: routeKey(), keys, occurrence: Math.max(0, occurrence) };
  }
  function restore(target) {
    let adapter = target?.routeKey === routeKey() ? owners.get(target.owner) : null;
    if (!adapter?.active()) {
      const owner = [...owners.keys()].reverse().find(name => owners.get(name).active());
      adapter = owners.get(owner); target = null;
    }
    if (!adapter) return;
    let chosen;
    if (target) {
      const items = adapter.items(target.region, target);
      const matches = items.filter(item => item.itemKey === target.itemKey);
      chosen = (target.el && matches.find(item => item.el === target.el)) || matches[target.occurrence || 0] || matches[0];
      if (!chosen) {
        const keys = target.keys || [], position = keys.indexOf(target.itemKey);
        for (let distance = 1; !chosen && position >= 0 && distance < keys.length; distance++) {
          for (const key of [keys[position + distance], keys[position - distance]]) {
            chosen = items.find(item => key !== undefined && item.itemKey === key);
            if (chosen) break;
          }
        }
        chosen ||= items[Math.max(0, Math.min(target.index || 0, items.length - 1))];
      }
    }
    adapter.apply(chosen || adapter.fallback(target), target);
  }
  window.YTGamepadFocus = {
    register(owner, adapter) {
      owners.set(owner, adapter);
      return () => { if (owners.get(owner) === adapter) owners.delete(owner); };
    }, capture,
    open(token, preferred, priority = 0) {
      if (layers.some(layer => layer.token === token)) return;
      const layer = { token, target: capture(preferred), priority };
      const above = layers.findIndex(existing => existing.priority > priority);
      if (above < 0) layers.push(layer); else layers.splice(above, 0, layer);
      syncSuspendedScopes();
    },
    close(token, apply = true) {
      const index = layers.findIndex(layer => layer.token === token);
      if (index < 0) return;
      const [layer] = layers.splice(index, 1);
      syncSuspendedScopes();
      // A higher layer opened inside this scope inherits its external return target.
      for (const higher of layers.slice(index)) if (higher.target?.scope === token) higher.target = layer.target;
      if (apply && index === layers.length) restore(layer.target);
    },
    restore(target) { if (!layers.length) restore(target); },
    isSuspendedScope(scope) { return suspendedScopes.has(scope); },
    get suspended() { return layers.length > 0; }
  };
})();
