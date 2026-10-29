<script setup lang="ts">
import InterfaceIcon from './InterfaceIcon.vue';
import SidebarLinks from './SidebarLinks.vue';
import { useI18n } from '../shared/use-i18n';
import type { SidebarEntry, SidebarSnapshot } from '../shared/sidebar-data';
import { computed, watch } from 'vue';
const props = defineProps<{ route: string; snapshot?: SidebarSnapshot; openRoute: (href: string) => boolean; refreshHome?: () => void }>();
const emit = defineEmits<{ changed: []; settings: [] }>();
const { t } = useI18n();
const fallback = computed<SidebarSnapshot>(() => ({ sections: [{ id: 'primary', entries: [
  { id: 'home', label: t('首页'), href: '/', icon: 'home' },
  { id: 'subscriptions', label: t('Subscribed channels'), href: '/feed/subscriptions', icon: 'subscriptions' }
] }] }));
const sections = computed(() => (props.snapshot || fallback.value).sections.map(section => section.id === 'subscriptions' ? {
  ...section, label: undefined, entries: [{ id: 'subscription-channels', label: t('Subscribed channels'),
    href: '', icon: 'subscriptions', children: section.entries, expanded: false }]
} : section));
watch(sections, () => emit('changed'), { flush: 'post' });
function open(entry: Pick<SidebarEntry, 'id' | 'href'>, event: MouseEvent) {
  if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
  if (entry.href.startsWith('https:')) return;
  if (entry.id === 'home') {
    props.refreshHome?.();
    if (location.pathname === '/' && props.refreshHome) { event.preventDefault(); return; }
  }
  if (entry.href === location.pathname + location.search || props.openRoute(entry.href)) event.preventDefault();
}
</script>
<template>
  <nav id="ytg-browse-sidebar" :aria-label="t('侧边目录')" @transitionend.self="emit('changed')">
    <section v-for="section in sections" :key="section.id" :data-sidebar-section="section.id">
      <h3 v-if="section.label" class="sidebar-section-title">{{ section.label }}</h3>
      <SidebarLinks :entries="section.entries" :route="props.route" @open="open" @changed="emit('changed')" />
    </section>
    <section>
      <button id="ytg-sidebar-settings" data-sidebar-id="settings" type="button"
        :aria-label="t('Settings')" :title="t('Settings')" aria-haspopup="dialog" @click="emit('settings')">
        <InterfaceIcon name="settings" />
        <span>{{ t('Settings') }}</span>
      </button>
    </section>
  </nav>
</template>
