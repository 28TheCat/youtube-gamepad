// Framework-independent direction rules; DOM measurement belongs to core.js.
(() => {
  if (window.YTGamepadNavigation) return;
  const center = r => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
  function ranked(from, items, direction, alignedOnly = false) {
    const a = center(from.rect), horizontal = direction === 'left' || direction === 'right';
    return items.map(item => {
      const b = center(item.rect), dx = b.x - a.x, dy = b.y - a.y;
      const primary = direction === 'left' ? -dx : direction === 'right' ? dx : direction === 'up' ? -dy : dy;
      const cross = Math.abs(horizontal ? dy : dx);
      const overlap = horizontal
        ? Math.min(from.rect.top + from.rect.height, item.rect.top + item.rect.height) - Math.max(from.rect.top, item.rect.top)
        : Math.min(from.rect.left + from.rect.width, item.rect.left + item.rect.width) - Math.max(from.rect.left, item.rect.left);
      return { item, primary, cross, overlap, score: primary + cross * 3 };
    }).filter(x => x.item !== from && x.primary > 1 && (!alignedOnly || x.overlap > 1))
      .sort((a, b) => a.score - b.score);
  }
  // Row membership uses the top edge so different title heights do not split a row.
  const rowTolerance = item => Math.max(8, Math.min(24, item.rect.height * .15));
  function rowOf(from, items) {
    return items.filter(item => item.section === from.section && (from.row
      ? item.row === from.row
      : !item.row && Math.abs(item.rect.top - from.rect.top) <= rowTolerance(from)));
  }
  function adjacentRow(from, items, direction) {
    const sign = direction === 'down' ? 1 : -1;
    const currentRow = new Set(rowOf(from, items));
    const ahead = items.filter(item => !currentRow.has(item) && sign * (item.rect.top - from.rect.top) > rowTolerance(from));
    if (!ahead.length) return null;
    const nearest = ahead.reduce((a, b) => sign * a.rect.top < sign * b.rect.top ? a : b);
    const row = rowOf(nearest, items);
    const x = center(from.rect).x;
    return row.sort((a, b) => Math.abs(center(a.rect).x - x) - Math.abs(center(b.rect).x - x))[0];
  }
  const orderedRow = (from, items) => rowOf(from, items).sort((a, b) => a.rect.left - b.rect.left);
  const itemKey = item => item.key ?? item.el ?? item;
  // Row memories use video keys, so replacing DOM nodes does not lose selection.
  function createRowFocus() {
    const sections = new Map();
    function state(section) {
      if (!sections.has(section)) sections.set(section, { column: null, rows: [] });
      return sections.get(section);
    }
    function remember(item, items, keepColumn = false) {
      const row = orderedRow(item, items), s = state(item.section);
      if (!keepColumn || s.column === null) s.column = row.indexOf(item);
      const keys = new Set(row.map(itemKey));
      s.rows = s.rows.filter(saved => !row.some(card => saved.keys.has(itemKey(card))));
      s.rows.push({ keys, selected: itemKey(item) });
      if (s.rows.length > 100) s.rows.shift();
    }
    function target(from, next, items) {
      const row = orderedRow(next, items), s = state(from.section);
      const saved = s.rows.find(entry => row.some(card => entry.keys.has(itemKey(card))));
      return row.find(card => itemKey(card) === saved?.selected)
        || row[Math.min(s.column ?? 0, row.length - 1)];
    }
    return { remember, target, reset() { sections.clear(); } };
  }
  function rowScroll(from, items, viewport) {
    const row = rowOf(from, items);
    const top = Math.min(...row.map(item => item.rect.top));
    const bottom = Math.max(...row.map(item => item.rect.top + item.rect.height));
    if (top >= viewport.top - 1 && bottom <= viewport.bottom + 1) return 0;
    // Oversized rows align at the top instead of oscillating between their edges.
    return top - viewport.top;
  }
  function choose(from, items, direction, sections = {}, rowFocus = null) {
    if (!from || !['left', 'right', 'up', 'down'].includes(direction)) return null;
    const section = sections[from.section] || {};
    const horizontal = direction === 'left' || direction === 'right';
    const blockedAxis = (section.axis === 'vertical' && horizontal) || (section.axis === 'horizontal' && !horizontal);
    const local = items.filter(item => item.section === from.section);
    if (section.retainRowFocus) rowFocus?.remember(from, local, true);
    if (!blockedAxis) {
      if (section.layout === 'grid' && !horizontal) {
        const next = adjacentRow(from, local, direction);
        if (next) return section.retainRowFocus && rowFocus ? rowFocus.target(from, next, local) : next;
      }
      if (section.layout === 'grid' && horizontal) {
        const row = orderedRow(from, local);
        const next = row[row.indexOf(from) + (direction === 'right' ? 1 : -1)];
        if (next) {
          if (section.retainRowFocus) rowFocus?.remember(next, local);
          return next;
        }
      }
      const aligned = section.layout === 'grid' ? null : ranked(from, local, direction, true)[0];
      if (aligned) return aligned.item;
      // Do not wrap horizontally into another row of a video grid.
      if (section.layout !== 'grid') {
        const fallback = ranked(from, local, direction)[0];
        if (fallback) return fallback.item;
      }
    }
    const exits = section.exits?.[direction] || [];
    for (const id of exits) {
      const pool = items.filter(item => item.section === id);
      const target = ranked(from, pool, direction, true)[0] || ranked(from, pool, direction)[0];
      if (target) return target.item;
    }
    return null;
  }
  window.YTGamepadNavigation = { choose, rowOf, rowScroll, createRowFocus };
})();
