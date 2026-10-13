<script setup lang="ts">
import { useI18n } from '../shared/use-i18n';
import { onMounted, onBeforeUnmount, ref } from 'vue';
const { t } = useI18n();
const accountAvailable = ref(false);
const account = () => document.querySelector<HTMLElement>('ytd-masthead button#avatar-btn,ytd-masthead a[href*="accounts.google.com"]');
function home() {
  const link = document.querySelector<HTMLAnchorElement>('ytd-masthead a#logo');
  if (link) link.click(); else location.assign('/');
}
let observer: MutationObserver;
onMounted(() => {
  const sync = () => { accountAvailable.value = !!account(); };
  sync(); observer = new MutationObserver(sync);
  observer.observe(document.documentElement, { childList: true, subtree: true });
});
onBeforeUnmount(() => observer?.disconnect());
</script>

<template>
  <header id="ytg-browse-top">
    <button class="client-brand" type="button" :aria-label="t('首页')" @click="home">
      <svg viewBox="0 0 32 24" aria-hidden="true"><rect y="1" width="32" height="22" rx="7"/><path d="m13 7 9 5-9 5z"/></svg>
      <span>YouTube <small>Gamepad</small></span>
    </button>
    <div id="ytg-client-search"></div>
    <button v-if="accountAvailable" class="client-account" type="button" :aria-label="t('Account')" @click="account()?.click()">
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/></svg>
    </button>
  </header>
</template>
