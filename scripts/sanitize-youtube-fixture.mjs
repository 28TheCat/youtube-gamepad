import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Preserve renderer structure, never original text, identifiers, URLs or tokens.
// This is intentionally conservative; a capture still needs parser review.
export function sanitizeYouTubeFixture(raw) {
  let budget = 50000;
  const identities = new Map();
  const discarded = /^(?:responseContext|trackingParams|clickTrackingParams|loggingDirectives|adTrackingParams|visitorData|serviceTrackingParams|context|headers|cookie|authorization|apiKey)$/i;
  const identity = value => {
    if (!identities.has(value)) identities.set(value, String(identities.size + 1).padStart(11, '0'));
    return identities.get(value);
  };
  function walk(value, key = '', depth = 0) {
    if (--budget < 0 || depth > 40) throw new Error('Fixture exceeds structural limit');
    if (typeof value === 'string') {
      if (key === 'videoId') return identity(value);
      if (key === 'browseId' || key === 'channelId') return 'UC' + identity(value).padStart(22, '0');
      if (key === 'playlistId') return 'PL' + identity(value);
      if (key === 'url') return 'https://i.ytimg.com/vi/00000000001/hqdefault.jpg';
      if (/^(?:continuation|token|params|commentId|commentKey|entityKey|key)$/.test(key)) return 'fixture-' + identity(value);
      if (['WEB', 'VIDEO', 'PLAYLIST', 'SHORTS', 'CONTINUATION_REQUEST_TYPE_SEARCH',
        'CONTINUATION_REQUEST_TYPE_BROWSE', 'CONTINUATION_REQUEST_TYPE_WATCH_NEXT',
        'CONTINUATION_TRIGGER_ON_ITEM_SHOWN'].includes(value)) return value;
      return 'Fixture text';
    }
    if (Array.isArray(value)) return value.map(item => walk(item, key, depth + 1));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
      .filter(([name]) => !discarded.test(name))
      .map(([name, item]) => [name, walk(item, name, depth + 1)]));
    return value;
  }
  return walk(raw);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const input = readFileSync(0, 'utf8');
  if (input.length > 10000000) throw new Error('Capture exceeds 10 MB');
  process.stdout.write(JSON.stringify(sanitizeYouTubeFixture(JSON.parse(input)), null, 2) + '\n');
}
