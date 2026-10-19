<script setup lang="ts">
import InterfaceIcon from './InterfaceIcon.vue';
import BrowseModeSwitch from './BrowseModeSwitch.vue';
import AccountPage from './AccountPage.vue';
import type { mountBrowseMode } from './browse-mode';
const props = defineProps<{ browseMode: ReturnType<typeof mountBrowseMode>; refreshNavigation?: () => void; focusAccount?: (node: HTMLElement) => void }>();
import { useI18n } from '../shared/use-i18n';
import { createPageClient } from '../bridge/page-client';
import { ui } from './ui-api';
import type { AccountSnapshot } from '../sites/youtube-account';
import { computed, nextTick, onMounted, onBeforeUnmount, ref, watch } from 'vue';
const { t } = useI18n();
const account = ref<AccountSnapshot>();
const accountLoading = ref(false), accountFailed = ref(false);
const currentAccount = computed(() => account.value?.accounts.find(item => item.selected));
const accountAvatar = computed(() => currentAccount.value?.avatar || '');
const accountName = computed(() => currentAccount.value?.name || '');
const page = createPageClient();
let disposed = false, generation = 0;
async function loadAccount(force = false) {
  if (disposed || accountLoading.value && !force) return;
  const version = ++generation; accountLoading.value = true; accountFailed.value = false;
  try {
    const value = await page.readAccount?.(force);
    if (disposed || version !== generation) return;
    account.value = value; accountFailed.value = !value;
  } catch { if (!disposed && version === generation) { account.value = undefined; accountFailed.value = true; } }
  finally { if (!disposed && version === generation) { accountLoading.value = false; if (accountOpen.value) void nextTick(refresh); } }
}
const reloadAccount = () => { void loadAccount(true); };
const avatarFailed = ref(false);
const accountOpen = ref(false);
const accountButton = ref<HTMLElement>();
const refresh = () => props.refreshNavigation?.();
const focus = (node: HTMLElement) => props.focusAccount ? props.focusAccount(node) : node.focus();
function showAccount() {
  if (ui.state.openPanels.some(id => id === 'settings' || id === 'search')) return false;
  accountOpen.value = true; reloadAccount();
}
function closeAccount(restore = true) {
  accountOpen.value = false;
  void nextTick().then(() => { refresh(); if (restore && accountButton.value) focus(accountButton.value); });
}
const routeChanged = () => closeAccount(false);
watch(accountAvatar, () => { avatarFailed.value = false; });
const home = () => { if (!page.openBrowseRoute?.('/')) location.assign('/'); };
const releases: (() => void)[] = [];
onMounted(() => {
  releases.push(ui.registerPanel('account', { isOpen: () => accountOpen.value,
    open: showAccount, close: () => closeAccount() }));
  releases.push(ui.registerFocus('account', () => {
    if (!accountButton.value?.isConnected || ui.state.openPanels.length) return false;
    focus(accountButton.value);
    return (accountButton.value.getRootNode() as Document | ShadowRoot).activeElement === accountButton.value;
  }));
  void loadAccount();
  document.addEventListener('yt-navigate-start', routeChanged);
  document.addEventListener('yt-navigate-finish', reloadAccount);
  document.addEventListener('yt-page-data-updated', reloadAccount);
  window.addEventListener('focus', reloadAccount);
});
onBeforeUnmount(() => {
  for (const release of releases) release();
  disposed = true; ++generation; page.destroy?.();
  document.removeEventListener('yt-navigate-start', routeChanged);
  document.removeEventListener('yt-navigate-finish', reloadAccount);
  document.removeEventListener('yt-page-data-updated', reloadAccount);
  window.removeEventListener('focus', reloadAccount);
  document.documentElement.classList.remove('ytg-account-open');
});
</script>

<template>
  <header id="ytg-browse-top">
    <button class="client-brand" type="button" :aria-label="t('首页')" @click="home">
      <svg viewBox="0 0 32 24" aria-hidden="true"><rect y="1" width="32" height="22" rx="7"/><path d="m13 7 9 5-9 5z"/></svg>
      <span>YouTube <small>Gamepad</small></span>
    </button>
    <div id="ytg-client-search"></div>
    <BrowseModeSwitch :state="browseMode.state" :change="browseMode.change" />
    <button ref="accountButton" :title="accountName" class="client-account" :class="{ 'has-avatar': accountAvatar && !avatarFailed }" type="button" :aria-label="t('Account')" aria-haspopup="dialog" :aria-expanded="accountOpen" @click="ui.openPanel('account')">
      <img v-if="accountAvatar && !avatarFailed" :src="accountAvatar" alt="" @error="avatarFailed = true" />
      <InterfaceIcon v-else name="person" />
    </button>
  </header>
  <AccountPage v-if="accountOpen" :snapshot="account" :loading="accountLoading" :failed="accountFailed" :retry="reloadAccount" :refresh="refresh" :focus="focus" @close="ui.closePanel('account')" />
</template>
