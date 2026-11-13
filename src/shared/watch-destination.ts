/** Match a committed episode, ignoring navigation-only query parameters. */
export function sameWatchDestination(target: string | null, route: string): boolean {
  if (!target) return false;
  if (target === route) return true;
  try {
    const expected = new URL(target, 'https://www.youtube.com');
    const actual = new URL(route, 'https://www.youtube.com');
    if (expected.origin !== actual.origin || expected.pathname !== '/watch' || actual.pathname !== '/watch') return false;
    for (const key of ['v', 'list', 'index']) {
      if (expected.searchParams.getAll(key).length > 1 || actual.searchParams.getAll(key).length > 1 ||
          expected.searchParams.get(key) !== actual.searchParams.get(key)) return false;
    }
    return !!expected.searchParams.get('v');
  } catch { return false; }
}
