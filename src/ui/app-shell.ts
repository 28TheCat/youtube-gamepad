/** Persistent document-level owner for navigation chrome and page surfaces. */
export function createAppShell() {
  const shell = document.createElement('div');
  shell.id = 'ytg-app-shell';
  // The shell groups its children without creating a stacking context: the
  // native player and its menus must retain their existing stacking order.
  shell.style.display = 'contents';
  const content = document.createElement('div');
  content.id = 'ytg-app-content';
  content.style.display = 'contents';
  shell.append(content);
  document.documentElement.append(shell);
  return {
    // The browse surface owns the persistent chrome as well as its feed; it
    // remains mounted while the watch surface replaces the visible feed.
    mountChrome(node: HTMLElement) { content.insertBefore(node, content.firstChild); },
    mountContent(node: HTMLElement) { content.append(node); },
    destroy() { shell.remove(); }
  };
}
