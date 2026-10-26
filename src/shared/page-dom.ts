// Only traverse our own open root. Native YouTube roots and temporary overlays
// keep their existing ownership; never patch document or browser DOM APIs.
export const browseHostId = 'ytg-browse-root';
export function browseShadow(): ShadowRoot | null {
  return document.getElementById?.(browseHostId)?.shadowRoot || null;
}
export function pageShadowRoots(): ShadowRoot[] {
  return [browseShadow(), document.getElementById?.('ytg-native-mode')?.shadowRoot].filter((root): root is ShadowRoot => !!root);
}
export function pageQueryAll<T extends Element = HTMLElement>(selector: string): T[] {
  return [...document.querySelectorAll<T>(selector), ...pageShadowRoots().flatMap(root => [...root.querySelectorAll<T>(selector)])];
}
export function pageQuery<T extends Element = HTMLElement>(selector: string): T | null {
  if (/^#[\w-]+$/.test(selector)) {
    const element = document.getElementById?.(selector.slice(1));
    if (element) return element as unknown as T;
  }
  return document.querySelector?.<T>(selector) || pageShadowRoots().map(root => root.querySelector<T>(selector)).find(Boolean) || null;
}
export function pageActiveElement(): Element | null {
  let element = document.activeElement;
  while (element?.shadowRoot?.activeElement) element = element.shadowRoot.activeElement;
  return element;
}
