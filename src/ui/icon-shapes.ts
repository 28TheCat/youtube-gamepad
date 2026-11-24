import { mingcuteIcons } from './mingcute-icons';
import { youtubeBrandIcons } from './youtube-brand-icons';

const materialIcons = new Set(['subscriptions', 'verified', 'artist', 'bell', 'bell-all', 'bell-off', 'down', 'more', 'close', 'volume', 'muted', 'fullscreen', 'live', 'new-content']);
const sidebarIcons: Record<string, string> = {
  refresh: 'M20 11a8 8 0 0 0-14-5L3 9m0-6v6h6M4 13a8 8 0 0 0 14 5l3-3m0 6v-6h-6',
  shorts: 'M16 3 7 8a3 3 0 0 0 0 5l1 .5-1 .5a3 3 0 0 0 3 5l8-4.5a3 3 0 0 0 0-5l-1-.5 1-.5A3 3 0 0 0 16 3Z M11 9l4 3-4 2.5Z',
  downloads: 'M12 3v12m-5-5 5 5 5-5M5 16v4h14v-4',
  music: 'M9 18V6l10-2v12M9 9l10-2M9 18c0 1.1-1.3 2-3 2s-3-.7-3-1.8 1.3-2 3-2 3 .7 3 1.8Zm10-2c0 1.1-1.3 2-3 2s-3-.7-3-1.8 1.3-2 3-2 3 .7 3 1.8Z',
  movies: 'M4 8h16v11H4zM4 8V5h16v3M8 5 6 8m7-3-2 3m7-3-2 3',
  gaming: 'M7 9h10c2 0 3.3 1.5 3.8 3.5l.7 3c.5 2-1.6 3-3 1.7L16 15H8l-2.5 2.2c-1.4 1.3-3.5.3-3-1.7l.7-3C3.7 10.5 5 9 7 9Zm0 2v3m-1.5-1.5h3m7-.5h.01m2 2h.01',
  news: 'M4 5h16v14H4zM7 8h4v4H7zm7 0h3m-3 3h3M7 15h10',
  sports: 'M8 4h8v4c0 3-1.7 5-4 5S8 11 8 8V4Zm0 2H5v2c0 2 1 3 3.5 3M16 6h3v2c0 2-1 3-3.5 3M12 13v4m-4 3h8m-7-3h6',
  report: 'M5 21V4m0 1c5-3 9 3 14 0v10c-5 3-9-3-14 0',
};

export function interfaceIcon(name: string, filled = false) {
  const key = `${name}-${filled ? 'fill' : 'line'}`;
  if (Object.hasOwn(youtubeBrandIcons, name)) return { id: `sidebar:${key}`, shapes: youtubeBrandIcons[name] };
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
