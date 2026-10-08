export interface StoredDiagnostic {
  timestamp: number; version: string; module: string; operation: string;
  name: string; reason: string; stack: string; state: Record<string,string | boolean>;
}
export let YTGamepadDiagnosticStore: { key: string; bounded(raw: unknown): StoredDiagnostic[]; maxEntries: number; maxCharacters: number; normalize(raw: unknown,version: unknown,now?: number): StoredDiagnostic | null };
// Shared by the worker and settings page. Keep every field and the total bounded.
YTGamepadDiagnosticStore = (() => {
  const key = 'ytg-diagnostics', maxEntries = 100, maxCharacters = 32768;
  const text = (value: unknown, limit: number) => typeof value === 'string' ? value.replace(/https?:\/\/[^\s)]+/g, '[URL]').slice(0, limit) : '';
  function normalize(input: unknown, version: unknown, now = Date.now()): StoredDiagnostic | null {
    if (!input || typeof input !== 'object') return null;
    const raw = input as Record<string,unknown>;
    if (!raw || typeof raw !== 'object' || typeof raw.reason !== 'string' || typeof raw.operation !== 'string') return null;
    const observed = raw.state && typeof raw.state === 'object' ? raw.state as Record<string,unknown> : {};
    const state: StoredDiagnostic['state'] = {};
    for (const field of ['enabled', 'surfaceReady', 'navigating']) { const value = observed[field]; if (typeof value === 'boolean') state[field] = value; }
    for (const [field, allowed] of Object.entries({ route: ['watch', 'browse'], mode: ['browse', 'playback', 'controls'], adaptation: ['inactive', 'waiting', 'ready', 'fallback'] })) {
      const value = observed[field];
      if (typeof value === 'string' && allowed.includes(value)) state[field] = value;
    }
    return { timestamp: now, version: text(version, 40), module: text(raw.module, 40), operation: text(raw.operation, 80),
      name: text(raw.name, 80), reason: text(raw.reason, 512), stack: text(raw.stack, 1024), state };
  }
  function bounded(raw: unknown): StoredDiagnostic[] {
    const entries = (Array.isArray(raw) ? raw.slice(-maxEntries) : []).map((entry: unknown) => {
      const value = entry && typeof entry === 'object' ? entry as Record<string,unknown> : {};
      return normalize(entry, value.version, typeof value.timestamp === 'number' && Number.isFinite(value.timestamp) ? value.timestamp : 0);
    }).filter((entry): entry is StoredDiagnostic => entry !== null);
    while (JSON.stringify(entries).length > maxCharacters) entries.shift();
    return entries;
  }
  return { key, maxEntries, maxCharacters, normalize, bounded };
})();
