// Minimal presenter for VM policy tests; extension tests exercise WatchPanel.vue.
export const watchPanelRendererSource = `
function backCommentComposer() { return false; }
function mountWatchPanel(container, style, actions) {
  let disposed = false, buttons = [];
  const make = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
  container.querySelectorAll = () => buttons;
  return {
    update(view) {
      if (disposed) return;
      buttons = [];
      if (view.panel === 'description') { container.replaceChildren(); container.textContent = view.text; return; }
      const comment = (item, reply = false) => {
        const node = make('div', reply ? 'comment-reply' : 'comment');
        const header = make('button', 'comment-header');
        header.dataset.focusId = reply ? 'comment:reply:' + JSON.stringify([view.thread.key, item.key]) : 'comment:' + item.key;
        header.closest = () => null;
        header.append(make('span', 'comment-author', item.author));
        if (!view.thread) header.addEventListener('click', () => actions.openThread(item.key));
        buttons.push(header);
        const body = make('div', 'comment-body'); body.append(make('div', '', reply ? '↳ ' + item.text : item.text));
        node.append(header, body);
        if (!view.thread && (item.hasReplies || item.replies.length)) {
          const replies = make('button', 'comment-replies', 'View replies'); replies.dataset.focusId = 'replies:' + item.key;
          replies.closest = () => null; replies.addEventListener('click', () => actions.openThread(item.key)); node.append(replies); buttons.push(replies);
        }
        return node;
      };
      const threads = view.thread ? [comment(view.thread), ...view.thread.replies.slice(0, view.replyLimit).map(item => comment(item, true))] : view.records.map(item => comment(item));
      if (view.thread && (view.thread.hasReplies || view.thread.replies.length > view.replyLimit)) {
        const more = make('button', 'control', 'Show more replies'); more.dataset.focusId = 'replies:more'; more.closest = () => null;
        more.addEventListener('click', actions.replies); threads.push(more); buttons.push(more);
      } else if (!view.thread && !view.records.length) threads.push(make('p', '', 'Comments are still loading or disabled for this video. Press ↓ to load more, B to go back.'));
      else if (!view.thread) { const more = make('button', 'control', 'Load more comments'); more.closest = () => null; more.addEventListener('click', actions.load); threads.push(more); buttons.push(more); }
      container.replaceChildren(...threads);
    },
    buttons() { return buttons.filter(button => !button.closest('[hidden]')); },
    dispose() { disposed = true; buttons = []; container.replaceChildren(); }
  };
}
`;
