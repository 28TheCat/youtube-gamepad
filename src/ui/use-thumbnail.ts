import { ref, watch } from 'vue';

interface ThumbnailItem {
  id?: string;
  thumbnail?: string;
  thumbnailFallback?: string;
}

export function useThumbnail(item: () => ThumbnailItem) {
  const source = ref(''), failed = ref(false), loaded = ref(false);
  watch(() => [item().id, item().thumbnail, item().thumbnailFallback], () => {
    const value = item();
    const nextSource = value.thumbnail || value.thumbnailFallback || '';
    if (source.value !== nextSource) loaded.value = false;
    source.value = nextSource;
    failed.value = !nextSource;
  }, { immediate: true });

  function imageError() {
    loaded.value = false;
    const fallback = item().thumbnailFallback;
    if (fallback && source.value !== fallback) source.value = fallback;
    else failed.value = true;
  }

  return { source, failed, loaded, imageError };
}
