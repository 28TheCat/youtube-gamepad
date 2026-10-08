// Minimal presenter for VM policy tests; extension tests exercise WatchPanel.vue.
export const watchPanelRendererSource = `
function mountWatchPanel(container, style, actions) {
  let disposed = false, buttons = [];
  const make = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
  container.querySelectorAll = () => buttons;
  return {
    update(view) {
      if (disposed) return;
      buttons = [];
      if (view.panel === 'description') { container.replaceChildren(); container.textContent = view.text; return; }
      const threads = view.records.map(item => {
        const collapsed = view.collapsed.includes(item.key), node = make('div', 'comment');
        const header = make('button', 'comment-header'); header.dataset.focusId = 'comment:' + item.key;
        header.setAttribute('aria-expanded', String(!collapsed)); header.closest = () => null;
        header.append(make('span', 'comment-author', item.author)); header.addEventListener('click', () => actions.toggle(item.key)); buttons.push(header);
        const body = make('div', 'comment-body'); body.hidden = collapsed; body.append(make('div', '', item.text));
        for (const reply of item.expanded) body.append(make('div', 'comment-reply', '↳ ' + reply));
        if (item.hasReplies) { const replies = make('button', 'comment-replies', item.repliesLabel); replies.closest = () => collapsed ? body : null; replies.addEventListener('click', () => actions.replies(item.key)); body.append(replies); buttons.push(replies); }
        node.append(header, body); return node;
      });
      if (!view.records.length) threads.push(make('p', '', 'Comments are still loading or disabled for this video. Press ↓ to load more, B to go back.'));
      else { const more = make('button', 'control', 'Load more comments'); more.closest = () => null; more.addEventListener('click', actions.load); threads.push(more); buttons.push(more); }
      container.replaceChildren(...threads);
    },
    buttons() { return buttons.filter(button => !button.closest('[hidden]')); },
    dispose() { disposed = true; buttons = []; container.replaceChildren(); }
  };
}
`;
