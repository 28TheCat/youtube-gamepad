(() => {
  // Independently implemented from the layout/action structure observed in
  // YouTube Leanback's English layout and shared numeric layout (2026-10-03).
  const textRow = value => Array.from(value, label => ({ label, action: 'TEXT' }));
  const key = (label, action, ariaLabel = label) => ({ label, action, ariaLabel });
  const footer = [key('空格', 'SPACE'), key('清除', 'CLEAR'), key('搜索', 'SEARCH')];
  const letters = ['ABCDEFG', 'HIJKLMN', 'OPQRSTU', "VWXYZ-'"].map(textRow);
  letters[0].push(key('⌫', 'BACKSPACE', '删除'));
  letters[1].push(key('&123', 'NUMBER_LAYOUT', '符号'));
  letters[2].push(key('◎', 'SWITCH_LANGUAGE', '切换语言'));
  const numbers = ['123&#()', '456@!?:', '789.-_"', '0/$%+[]'].map(textRow);
  numbers[0].push(key('⌫', 'BACKSPACE', '删除'));
  numbers[1].push(key('ABC', 'LETTER_LAYOUT'));
  window.YTGamepadKeyboard = {
    frames: new Map([['LETTER_LAYOUT', letters], ['NUMBER_LAYOUT', numbers]]),
    rows(frame = 'LETTER_LAYOUT', uppercase = true) {
      return [...this.frames.get(frame).map(row => row.map(item => ({
        ...item, label: item.action === 'TEXT' && !uppercase ? item.label.toLowerCase() : item.label
      }))), footer.map(item => ({ ...item }))];
    }
  };
})();
