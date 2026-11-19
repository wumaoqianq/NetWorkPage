import test from 'node:test';
import assert from 'node:assert/strict';
import { createModalManager } from '../src/dialogStack.js';

test('两层对话框只有最上层处理按键，关闭顶层后恢复下层', () => {
  const style = { overflow: '' }, manager = createModalManager(() => style);
  const detail = {}, confirmation = {};
  const closeDetail = manager.enter(detail);
  const closeConfirmation = manager.enter(confirmation);
  assert.equal(manager.isTop(detail), false);
  assert.equal(manager.isTop(confirmation), true);
  closeConfirmation();
  assert.equal(manager.isTop(detail), true);
  assert.equal(style.overflow, 'hidden');
  closeDetail();
  assert.equal(style.overflow, '');
});
test('无论关闭顺序如何，只在最后一层关闭时恢复原始滚动状态', () => {
  const style = { overflow: 'auto' }, manager = createModalManager(() => style);
  const releaseFirst = manager.enter({}), releaseSecond = manager.enter({});
  releaseFirst();
  assert.equal(style.overflow, 'hidden');
  releaseSecond(); releaseSecond();
  assert.equal(style.overflow, 'auto');
});
