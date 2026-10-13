import type { BrowseSnapshot } from '../sites/youtube-browse';
import type { Scope } from '../../types/ports';

interface NativeBrowsePagerDependencies {
  read: () => BrowseSnapshot;
  loadMore: () => boolean;
  canLoad: () => boolean;
  now: () => number;
  timeout: Scope['timeout'];
  clearTimeout: Scope['clearTimeout'];
}

// Native continuation is observed as snapshots; the surface owns DOM and focus.
export function createNativeBrowsePager({ read, loadMore, canLoad, now, timeout, clearTimeout }: NativeBrowsePagerDependencies) {
  let lastMore = 0, timer: number | undefined;
  let batch: { route: string; ids: Set<string>; remaining: number; deadline: number } | undefined;
  function stop() { clearTimeout(timer); timer = undefined; batch = undefined; }
  function poll() {
    if (!batch) return;
    if (!canLoad() || now() > batch.deadline) { stop(); return; }
    const next = read();
    const ids = new Set(next.items.map(item => item.id));
    if (next.route !== batch.route || [...batch.ids].some(id => !ids.has(id))) { stop(); return; }
    if (ids.size > batch.ids.size) {
      if (!batch.remaining || !next.canLoadMore) { stop(); return; }
      if (now() - lastMore >= 1500) {
        batch.ids = ids;
        batch.remaining--;
        batch.deadline = now() + 15000;
        lastMore = now();
        if (!loadMore()) { stop(); return; }
      }
    }
    timer = timeout(poll, 300);
  }
  function more(snapshot: BrowseSnapshot) {
    if (batch || !canLoad() || !snapshot.canLoadMore || now() - lastMore < 1500) return;
    batch = { route: snapshot.route, ids: new Set(snapshot.items.map(item => item.id)), remaining: 2, deadline: now() + 15000 };
    lastMore = now();
    if (!loadMore()) { stop(); return; }
    timer = timeout(poll, 300);
  }
  return { more, stop };
}
