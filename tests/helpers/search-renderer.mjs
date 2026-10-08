// Synchronous renderer for old DOM doubles. Policy is the real TypeScript model;
// the actual Vue renderer is exercised by the bundled browser/extension suites.
function mountSearch(container, initial, actions) {
  const make = (tag, id) => { const node = document.createElement(tag); if (id) node.id = id; return node; };
  const input = make('input', 'query'), keys = make('div', 'keys'), recent = make('div', 'recent');
  const message = make('p', 'message'), shortcuts = make('p', 'shortcuts');
  input.setAttribute('aria-label', 'Search query');
  input.addEventListener('input', () => actions.input(input));
  input.addEventListener('select', () => actions.input(input));
  container.replaceChildren(input, recent, keys, message, shortcuts);
  let layout = '';
  const button = (label, row, column, action, click) => {
    const node = make('button'); node.textContent = label;
    Object.assign(node.dataset, { row: String(row), column: String(column), action });
    node.addEventListener('focus', () => actions.focus(node));
    node.addEventListener('click', click); return node;
  };
  function update(view) {
    input.value = view.query;
    const nextLayout = JSON.stringify(view.rows);
    if (layout !== nextLayout) {
      layout = nextLayout;
      keys.replaceChildren(...view.rows.map((row, i) => {
        const group = make('div');
        group.append(...row.map((key, j) => {
          const node = button(key.label, i, j, key.action, () => actions.key(key));
          node.setAttribute('aria-label', key.ariaLabel || key.label); return node;
        })); return group;
      }));
    }
    recent.replaceChildren();
    if (view.composing) {
      const composition = make('div', 'composition');
      const label = make('p'); label.textContent = 'Pinyin: ' + view.composing; composition.append(label);
      composition.append(...view.candidates.map((candidate, i) => button(candidate.text, -1, i, 'CANDIDATE', () => actions.candidate(candidate))));
      if (view.previous) composition.append(button('Previous page', -1, view.candidates.length, 'PAGE', () => actions.page(-1)));
      if (view.next) composition.append(button('Next page', -1, view.candidates.length + Number(view.previous), 'PAGE', () => actions.page(1)));
      recent.append(composition);
    } else {
      recent.append(...view.recent.map((query, i) => button('↶  ' + query, i, -1, 'RECENT', () => actions.recent(query))));
    }
  }
  update(initial);
  return { update, dispose() { container.replaceChildren(); } };
}
export const searchRendererSource = mountSearch.toString();
