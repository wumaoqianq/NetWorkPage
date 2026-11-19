export function createModalManager(getStyle) {
  const panels = [];
  let previousOverflow = '';
  const update = () => panels.forEach(panel => { panel.inert = panel !== panels.at(-1); });
  return {
    enter(panel) {
      if (!panels.length) { previousOverflow = getStyle().overflow; getStyle().overflow = 'hidden'; }
      panels.push(panel); update();
      let released = false;
      return () => {
        if (released) return;
        released = true;
        const index = panels.indexOf(panel);
        if (index !== -1) panels.splice(index, 1);
        panel.inert = false;
        update();
        if (!panels.length) getStyle().overflow = previousOverflow;
      };
    },
    isTop(panel) { return panels.at(-1) === panel; },
    hasOpen() { return panels.length > 0; },
    count() { return panels.length; },
  };
}
// 仅最后一个对话框持有键盘焦点；所有层关闭后再释放页面滚动锁。
export const modalManager = createModalManager(() => document.body.style);
