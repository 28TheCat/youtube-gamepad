import { mingcuteIcons } from './mingcute-icons';

const materialIcons = new Set(['subscriptions', 'verified', 'artist', 'bell', 'bell-all', 'bell-off', 'down', 'more', 'close', 'volume', 'muted', 'fullscreen', 'live', 'new-content']);
const sidebarIcons: Record<string, string> = {
  refresh: 'M20 11a8 8 0 0 0-14-5L3 9m0-6v6h6M4 13a8 8 0 0 0 14 5l3-3m0 6v-6h-6',
  shorts: 'M16 3 7 8a3 3 0 0 0 0 5l1 .5-1 .5a3 3 0 0 0 3 5l8-4.5a3 3 0 0 0 0-5l-1-.5 1-.5A3 3 0 0 0 16 3Z M11 9l4 3-4 2.5Z',
  downloads: 'M12 3v12m-5-5 5 5 5-5M5 16v4h14v-4',
};

export function interfaceIcon(name: string, filled = false) {
  const key = `${name}-${filled ? 'fill' : 'line'}`;
  if (Object.hasOwn(sidebarIcons, name)) {
    return { id: `sidebar:${key}`, shapes: [{ tag: 'path', attrs: {
      d: sidebarIcons[name], fill: 'none', stroke: 'currentColor',
      'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    } }] };
  }
  return { shapes: mingcuteIcons[key] || [], id: `${materialIcons.has(name) ? 'material' : 'mingcute'}:${key}` };
}

/** One SVG renderer for Vue components and imperative controls. */
export function renderInterfaceIcon(svg: SVGSVGElement, name: string, filled = false) {
  const icon = interfaceIcon(name, filled);
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.dataset.icon = icon.id;
  svg.style.fill = 'none'; svg.style.stroke = 'none';
  const shapes = icon.shapes.map(shape => {
    const child = svg.ownerDocument.createElementNS('http://www.w3.org/2000/svg', shape.tag);
    for (const [key, value] of Object.entries(shape.attrs)) child.setAttribute(key, value);
    return child;
  });
  svg.replaceChildren(...shapes);
}

export function createInterfaceIcon(name: string, filled = false) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  renderInterfaceIcon(svg, name, filled);
  return svg;
}
