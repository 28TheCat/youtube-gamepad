/** Reattach updated bundles to existing documents without navigating the tab. */
export async function updateYouTubeTabs() {
  const manifest = chrome.runtime.getManifest();
  const tabs = await chrome.tabs.query({ url: 'https://www.youtube.com/*' });
  await Promise.allSettled(tabs.map(async tab => {
    if (tab.id === undefined || tab.discarded) return;
    const target = { tabId: tab.id };
    try {
      // DOM events also reach an orphaned ISOLATED world from the old extension.
      // The symbol covers versions released before the handoff listener existed.
      await chrome.scripting.executeScript({ target, world: 'ISOLATED', func: () => {
        document.dispatchEvent(new Event('ytg-extension-handoff'));
        const host = window as unknown as Record<symbol, (() => void) | undefined>;
        host[Symbol.for('yt-gamepad.main.dispose')]?.();
        host[Symbol.for('yt-gamepad.bridge.dispose')]?.();
      } });
      for (const entry of (manifest.content_scripts || []) as (NonNullable<chrome.runtime.Manifest['content_scripts']>[number] & { world?: chrome.scripting.ExecutionWorld })[]) {
        if (!entry.matches?.includes('https://www.youtube.com/*')) continue;
        if (entry.css?.length) {
          await chrome.scripting.removeCSS({ target, files: entry.css });
          await chrome.scripting.insertCSS({ target, files: entry.css });
        }
        if (entry.js?.length) await chrome.scripting.executeScript({ target, files: entry.js,
          world: entry.world || 'ISOLATED' });
      }
    } catch (error) {
      // Closed tabs and withdrawn host access must not block the other tabs.
      console.warn('YouTube Gamepad update:', tab.id, error);
    }
  }));
}
