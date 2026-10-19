// Browser assertions explicitly cross our root just as the application does.
// Keep native document APIs intact so tests can also assert real isolation.
export function installPageDOM() {
  const root = () => document.getElementById('ytg-browse-root')?.shadowRoot;
  window.__pageDOM = {
    querySelector(selector) { return document.querySelector(selector) || root()?.querySelector(selector) || null; },
    querySelectorAll(selector) { return [...document.querySelectorAll(selector), ...(root()?.querySelectorAll(selector) || [])]; },
    getElementById(id) { return document.getElementById(id) || root()?.getElementById(id) || null; },
    elementFromPoint(x, y) {
      const hit = document.elementFromPoint(x, y);
      return hit?.id === 'ytg-browse-root' ? root()?.elementFromPoint(x, y) || hit : hit;
    },
    get activeElement() {
      let node = document.activeElement;
      while (node?.shadowRoot?.activeElement) node = node.shadowRoot.activeElement;
      return node;
    }
  };
}
