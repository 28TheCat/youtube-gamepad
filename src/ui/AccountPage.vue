<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from '../shared/use-i18n';
import LoadStatus from './LoadStatus.vue';
import InterfaceIcon from './InterfaceIcon.vue';
import type { AccountSnapshot } from '../sites/youtube-account';
const props = defineProps<{ snapshot?: AccountSnapshot; loading: boolean; failed: boolean;
  retry: () => void; refresh: () => void; focus: (node: HTMLElement) => void }>();
const emit = defineEmits<{ close: [] }>();
const { t } = useI18n();
const root = ref<HTMLElement>(), imageFailed = ref(false);
const profile = computed(() => props.snapshot?.accounts.find(item => item.selected));
const avatar = computed(() => profile.value?.avatar || '');
const links = [
  { label: 'Google Account', href: 'https://myaccount.google.com/' },
  { label: 'Switch account', href: '/channel_switcher' },
  { label: 'YouTube settings', href: '/account' }
];
let disposed = false;
function close() { emit('close'); }
function navigate(href: string) { location.assign(href); }
function keydown(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
  if (event.key === 'Tab' && root.value) {
    const buttons = Array.from(root.value.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
    const owner = root.value.getRootNode() as ShadowRoot;
    const index = buttons.indexOf(owner.activeElement as HTMLButtonElement);
    if ((event.shiftKey && index <= 0) || (!event.shiftKey && index === buttons.length - 1)) {
      event.preventDefault(); buttons[event.shiftKey ? buttons.length - 1 : 0]?.focus();
    }
  }
}
watch(avatar, () => { imageFailed.value = false; });
watch(() => [props.snapshot, props.loading, props.failed], () => { void nextTick().then(() => { if (!disposed) props.refresh(); }); });
onMounted(() => {
  document.documentElement.classList.add('ytg-account-open'); props.refresh();
  const back = root.value?.querySelector<HTMLElement>('[data-account-close]');
  if (back) props.focus(back);
});
onBeforeUnmount(() => { disposed = true; document.documentElement.classList.remove('ytg-account-open'); });
</script>

<template>
  <section id="ytg-account-page" ref="root" role="dialog" aria-modal="true" aria-labelledby="ytg-account-title" @keydown="keydown">
    <div class="account-layout">
      <header class="account-toolbar">
        <button data-account-close type="button" :aria-label="t('Close')" @click="close"><InterfaceIcon name="left" /><span>{{ t('Back') }}</span></button>
        <span class="account-brand">YouTube <span>Gamepad</span></span>
      </header>
      <div class="account-heading"><span class="account-eyebrow">{{ t('Account') }}</span><h1 id="ytg-account-title">{{ t('Your account') }}</h1><p>{{ t('Manage your profile and YouTube preferences.') }}</p></div>
      <div class="account-columns">
        <aside class="account-profile">
          <img v-if="avatar && !imageFailed" :src="avatar" alt="" @error="imageFailed = true" />
          <InterfaceIcon v-else name="person" class="account-avatar-fallback" />
          <h2>{{ profile?.name || t('Account') }}</h2><p v-if="profile?.handle">{{ profile.handle }}</p>
          <span class="account-profile-note">{{ t('YouTube account') }}</span>
        </aside>
        <div class="account-options" :aria-busy="loading">
          <LoadStatus class="account-empty" :loading="loading" :failed="failed" error-role="status"
            :loading-message="t('Loading account…')" :error-message="t('Could not load your account menu.')"
            retryable :retry-attributes="{ 'data-account-action': '' }" @retry="retry" />
          <template v-if="!loading && !failed && snapshot?.signedIn">
            <div class="account-group" :aria-label="t('Accounts')">
              <div v-for="item in snapshot.accounts" :key="item.key" class="account-list-item" :class="{ 'is-current': item.selected }" :aria-current="item.selected ? 'true' : undefined">
                <img v-if="item.avatar" :src="item.avatar" alt="" referrerpolicy="no-referrer" />
                <span><strong>{{ item.name }}</strong><small v-if="item.handle">{{ item.handle }}</small></span>
                <span v-if="item.selected" class="account-current">{{ t('Current account') }}</span>
                <span v-else-if="item.disabled" class="account-current">{{ t('Unavailable') }}</span>
              </div>
            </div>
            <div class="account-group">
              <button v-for="item in links" :key="item.href" type="button" data-account-action @click="navigate(item.href)">
                <span>{{ t(item.label) }}</span><InterfaceIcon name="right" class="account-chevron" />
              </button>
            </div>
          </template>
          <div v-else-if="!loading && !failed" class="account-group"><button type="button" data-account-action @click="navigate('/signin?next=%2F')">{{ t('Sign in') }}</button></div>
        </div>
      </div>
    </div>
  </section>
</template>

