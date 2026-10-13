<script setup lang="ts">
import { useI18n } from '../shared/use-i18n';
const { t } = useI18n();
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
const props = defineProps<{ route: string }>();
const emit = defineEmits<{ changed: [] }>();
type Entry = { id: string; label: string; href: string; icon: string };
const personalOpen = ref(true), exploreOpen = ref(false);
const personal = ref<Entry[]>([]), explore = ref<Entry[]>([]);
const paths: Record<string, string> = {
  home: 'M3 10 12 3l9 7M5 9v12h5v-7h4v7h5V9',
  subscriptions: 'M4 3h16M2 7h20v14H2zM10 10l5 4-5 4z',
  person: 'M4 3h16v18H4zM8 9a4 4 0 1 0 8 0 4 4 0 0 0-8 0M6 21v-2a6 6 0 0 1 12 0v2',
  history: 'M3 5v6h6M3 11a9 9 0 1 1 2 7M12 7v5l3 2',
  playlists: 'M3 5h16M3 10h16M3 15h9M16 14l5 4-5 4z',
  later: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 7v5l4 2',
  liked: 'M8 21H3V10h5M8 10l4-7h2v7h6l1 2-3 9H8z',
  videos: 'M2 4h20v16H2zM10 8l6 4-6 4z',
  explore: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M16 8l-3 5-5 3 3-5z'
};
const primary: Entry[] = [
  { id: 'home', label: '首页', href: '/', icon: 'home' },
  { id: 'subscriptions', label: '订阅', href: '/feed/subscriptions', icon: 'subscriptions' }
];
const defaults: Entry[] = [
  { id: 'history', label: '历史记录', href: '/feed/history', icon: 'history' },
  { id: 'playlists', label: '播放列表', href: '/feed/playlists', icon: 'playlists' },
  { id: 'later', label: '稍后观看', href: '/playlist?list=WL', icon: 'later' },
  { id: 'liked', label: '赞过的视频', href: '/playlist?list=LL', icon: 'liked' },
  { id: 'videos', label: '我的视频', href: 'https://studio.youtube.com/', icon: 'videos' }
];
const current = computed(() => new URL(props.route || location.pathname + location.search, location.origin));
function active(href: string) {
  const target = new URL(href, location.origin);
  return target.origin === current.value.origin && target.pathname === current.value.pathname && target.search === current.value.search;
}
function safeHref(anchor: HTMLAnchorElement): string | undefined {
  try {
    const url = new URL(anchor.getAttribute('href') || '', location.origin);
    if (url.protocol !== 'https:' || !['www.youtube.com', 'studio.youtube.com'].includes(url.hostname)) return;
    return url.origin === location.origin ? url.pathname + url.search : url.href;
  } catch { return; }
}
function readLinks() {
  const anchors = [...document.querySelectorAll<HTMLAnchorElement>('ytd-guide-renderer a[href],ytd-mini-guide-renderer a[href]')];
  personal.value = defaults.map(entry => {
    const match = anchors.find(anchor => entry.id === 'videos' && /^(我的视频|你的影片|您的视频|Your videos)$/i.test(
      (anchor.textContent || anchor.getAttribute('title') || '').trim()));
    return match ? { ...entry, href: safeHref(match) || entry.href } : entry;
  });
  const section = [...document.querySelectorAll<HTMLElement>('ytd-guide-section-renderer')].find(node =>
    /^(探索|Explore)$/i.test(node.querySelector('#guide-section-title')?.textContent?.trim() || ''));
  const links = [...section?.querySelectorAll<HTMLAnchorElement>('a[href]') || []];
  const entries = links.flatMap(anchor => {
    const href = safeHref(anchor), label = anchor.querySelector('yt-formatted-string')?.textContent?.trim() || anchor.textContent?.trim();
    return href && label ? [{ id: `explore:${href}`, href, label, icon: 'explore' }] : [];
  });
  // Prefer region-specific native destinations; otherwise offer topic searches.
  explore.value = entries.length ? entries : ['音乐', '游戏', '新闻', '体育'].map(label => ({
    id: `explore:${label}`, label, href: `/results?search_query=${encodeURIComponent(label)}`, icon: 'explore'
  }));
}
function open(entry: Entry, event: MouseEvent) {
  if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
  const native = [...document.querySelectorAll<HTMLAnchorElement>('ytd-guide-renderer a[href],ytd-mini-guide-renderer a[href]')]
    .find(anchor => safeHref(anchor) === entry.href);
  if (native) { event.preventDefault(); native.click(); }
}
async function toggle(group: 'personal' | 'explore') {
  if (group === 'personal') personalOpen.value = !personalOpen.value;
  else exploreOpen.value = !exploreOpen.value;
  await nextTick(); emit('changed');
}
let observer: MutationObserver;
onMounted(() => {
  readLinks();
  observer = new MutationObserver(records => {
    const selector = 'ytd-guide-renderer,ytd-mini-guide-renderer';
    if (records.some(record => (record.target as Element).closest?.(selector) || [...record.addedNodes].some(node =>
      node instanceof Element && (node.matches(selector) || node.querySelector(selector))))) readLinks();
  });
  observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['href'] });
});
watch(() => props.route, readLinks);
onBeforeUnmount(() => observer?.disconnect());
</script>
<template>
  <nav id="ytg-browse-sidebar" :aria-label="t('侧边目录')">
    <a v-for="entry in primary" :key="entry.id" :href="entry.href" :data-sidebar-id="entry.id"
      :aria-label="t(entry.label)" :aria-current="active(entry.href) ? 'page' : undefined" @click="open(entry, $event)">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="paths[entry.icon]" /></svg><span>{{ t(entry.label) }}</span>
    </a>
    <section>
      <button id="ytg-sidebar-personal" data-sidebar-id="personal" type="button" :aria-expanded="personalOpen"
        :aria-label="t('我的频道')" aria-controls="ytg-sidebar-personal-links" @click="toggle('personal')">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="paths.person" /></svg><span>{{ t("我的频道") }}</span>
        <svg class="sidebar-chevron" :class="{ expanded: personalOpen }" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>
      </button>
      <div id="ytg-sidebar-personal-links" class="sidebar-group" :data-open="personalOpen"
        :inert="!personalOpen" :aria-hidden="!personalOpen" @transitionend.self="emit('changed')"><div class="sidebar-group-content">
        <a v-for="entry in personal" :key="entry.id" :href="entry.href" :data-sidebar-id="entry.id"
          :target="entry.href.startsWith('https://studio.') ? '_blank' : undefined" rel="noopener"
          :aria-label="t(entry.label)" :aria-current="active(entry.href) ? 'page' : undefined" @click="open(entry, $event)">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="paths[entry.icon]" /></svg><span>{{ t(entry.label) }}</span>
        </a>
      </div></div>
    </section>
    <section>
      <button id="ytg-sidebar-explore" data-sidebar-id="explore" type="button" :aria-expanded="exploreOpen"
        :aria-label="t('探索')" aria-controls="ytg-sidebar-explore-links" @click="toggle('explore')">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="paths.explore" /></svg><span>{{ t("探索") }}</span>
        <svg class="sidebar-chevron" :class="{ expanded: exploreOpen }" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>
      </button>
      <div id="ytg-sidebar-explore-links" class="sidebar-group" :data-open="exploreOpen"
        :inert="!exploreOpen" :aria-hidden="!exploreOpen" @transitionend.self="emit('changed')"><div class="sidebar-group-content">
        <a v-for="entry in explore" :key="entry.id" :href="entry.href" :data-sidebar-id="entry.id"
          :aria-label="t(entry.label)" :aria-current="active(entry.href) ? 'page' : undefined" @click="open(entry, $event)">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="paths.explore" /></svg><span>{{ t(entry.label) }}</span>
        </a>
      </div></div>
    </section>
  </nav>
</template>
