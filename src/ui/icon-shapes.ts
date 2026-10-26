import { mingcuteIcons } from './mingcute-icons';

const materialIcons = new Set(['subscriptions', 'verified', 'artist', 'bell', 'bell-all', 'bell-off', 'down', 'more', 'close', 'volume', 'muted']);

export function interfaceIcon(name: string, filled = false) {
  const key = `${name}-${filled ? 'fill' : 'line'}`;
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
