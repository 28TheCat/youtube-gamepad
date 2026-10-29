import { onBeforeUnmount, onMounted, shallowRef, watch } from 'vue';
import { createPageClient } from '../bridge/page-client';
import type { SidebarSnapshot } from '../shared/sidebar-data';

/** One guide snapshot and refresh lifecycle for the browse page's two rails. */
export function useBrowseSidebar(route: () => string) {
  const snapshot = shallowRef<SidebarSnapshot>();
  const page = createPageClient();
  let disposed = false, generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  async function read() {
    timer = undefined;
    const version = ++generation;
    let value: SidebarSnapshot | undefined;
    try { value = await page.readSidebar?.(); } catch { /* Clear stale account links. */ }
    if (!disposed && version === generation) snapshot.value = value;
  }
  function refresh() {
    // Navigation events and the matching Vue route update share one request.
    if (!disposed && timer === undefined) timer = setTimeout(read, 0);
  }
  onMounted(() => {
    refresh();
    document.addEventListener('yt-navigate-finish', refresh);
    document.addEventListener('yt-page-data-updated', refresh);
    window.addEventListener('focus', refresh);
    window.addEventListener('popstate', refresh);
  });
  watch(route, refresh, { flush: 'post' });
  onBeforeUnmount(() => {
    disposed = true; ++generation; clearTimeout(timer); page.destroy?.();
    document.removeEventListener('yt-navigate-finish', refresh);
    document.removeEventListener('yt-page-data-updated', refresh);
    window.removeEventListener('focus', refresh);
    window.removeEventListener('popstate', refresh);
  });
  return { snapshot, openRoute: (href: string) => page.openBrowseRoute?.(href) === true };
}
