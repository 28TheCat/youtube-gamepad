import type { Keyboard } from '../../types/ports';
export let YTGamepadKeyboard!: Keyboard;
(() => {
  // Independently implemented from the layout/action structure observed in
  // YouTube Leanback's English layout and shared numeric layout (2026-10-03).
  const textRow = (value: string) => Array.from(value, label => ({ label, action: 'TEXT' }));
  const key = (label: string, action: string, ariaLabel = label) => ({ label, action, ariaLabel });
  const footer = [key('Space', 'SPACE'), key('Clear', 'CLEAR'), key('Search', 'SEARCH')];
  const letters = ['ABCDEFG', 'HIJKLMN', 'OPQRSTU', "VWXYZ-'"].map(textRow);
  letters[0].push(key('⌫', 'BACKSPACE', 'Delete'));
  letters[1].push(key('&123', 'NUMBER_LAYOUT', 'Symbols'));
  letters[2].push(key('◎', 'SWITCH_LANGUAGE', 'Switch input language'));
  const numbers = ['123&#()', '456@!?:', '789.-_"', '0/$%+[]'].map(textRow);
  numbers[0].push(key('⌫', 'BACKSPACE', 'Delete'));
  numbers[1].push(key('ABC', 'LETTER_LAYOUT'));
  YTGamepadKeyboard = {
    frames: new Map([['LETTER_LAYOUT', letters], ['NUMBER_LAYOUT', numbers]]),
    rows(frame = 'LETTER_LAYOUT', uppercase = true) {
      return [...this.frames.get(frame)!.map((row) => row.map((item) => ({
        ...item, label: item.action === 'TEXT' && !uppercase ? item.label.toLowerCase() : item.label
      }))), footer.map(item => ({ ...item }))];
    }
  };
})();
