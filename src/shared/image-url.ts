/** Bounded HTTPS display images; credentials are never accepted. */
export function safeImageUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 4096) return;
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && !url.username && !url.password && url.href.length <= 4096) return url.href;
  } catch { /* Invalid images use the caller's fallback. */ }
}
