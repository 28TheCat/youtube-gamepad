/** Text editing uses UTF-16 selection offsets, as native input elements do. */
export function createSearchText() {
  const state = { query: '', selection: [0, 0] as [number, number] };
  function setQuery(query: string, selection: [number, number] = [query.length, query.length]) {
    state.query = query;
    state.selection = selection.map(value => Math.max(0, Math.min(query.length, value))) as [number, number];
  }
  function insertText(text: string, remove = false) {
    let [start, end] = state.selection;
    if (remove && start === end && start > 0) start -= Array.from(state.query.slice(0, start)).at(-1)!.length;
    setQuery(state.query.slice(0, start) + text + state.query.slice(end), [start + text.length, start + text.length]);
  }
  function moveCursor(delta: number) {
    let position = delta < 0 ? state.selection[0] : state.selection[1];
    if (state.selection[0] === state.selection[1]) {
      if (delta < 0 && position > 0) position -= Array.from(state.query.slice(0, position)).at(-1)!.length;
      if (delta > 0 && position < state.query.length) position += Array.from(state.query.slice(position))[0]!.length;
    }
    state.selection = [position, position];
  }
  return { state, setQuery, insertText, moveCursor };
}
