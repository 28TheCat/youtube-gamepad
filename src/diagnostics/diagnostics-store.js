// Shared by the worker and settings page. Keep every field and the total bounded.
globalThis.YTGamepadDiagnosticStore = (() => {
  const key = 'ytg-diagnostics', maxEntries = 100, maxCharacters = 32768;
  const text = (value, limit) => typeof value === 'string' ? value.replace(/https?:\/\/[^\s)]+/g, '[URL]').slice(0, limit) : '';
  function normalize(raw, version, now = Date.now()) {
    if (!raw || typeof raw !== 'object' || typeof raw.reason !== 'string' || typeof raw.operation !== 'string') return null;
    const state = {};
    for (const field of ['enabled', 'surfaceReady', 'navigating']) if (typeof raw.state?.[field] === 'boolean') state[field] = raw.state[field];
    for (const [field, allowed] of Object.entries({ route: ['watch', 'browse'], mode: ['browse', 'playback', 'controls'], adaptation: ['inactive', 'waiting', 'ready', 'fallback'] })) {
      if (allowed.includes(raw.state?.[field])) state[field] = raw.state[field];
    }
    return { timestamp: now, version: text(version, 40), module: text(raw.module, 40), operation: text(raw.operation, 80),
      name: text(raw.name, 80), reason: text(raw.reason, 512), stack: text(raw.stack, 1024), state };
  }
  function bounded(raw) {
    const entries = (Array.isArray(raw) ? raw.slice(-maxEntries) : []).map(entry =>
      normalize(entry, entry?.version, Number.isFinite(entry?.timestamp) ? entry.timestamp : 0)).filter(Boolean);
    while (JSON.stringify(entries).length > maxCharacters) entries.shift();
    return entries;
  }
  return { key, maxEntries, maxCharacters, normalize, bounded };
})();
