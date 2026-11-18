import test from 'node:test';
import assert from 'node:assert/strict';
import { iconAssetText, iconTaskText } from '../popup-tasks.js';

test('素材状态文案区分跨源兜底、SVG-only 与普通失败', () => {
  assert.match(iconAssetText({ status: 'ready' }), /已就绪/);
  assert.match(iconAssetText({ status: 'unavailable', code: 'icon_cross_origin', diagnostics: { crossOriginHosts: ['img.alicdn.com'] } }), /公共 CDN.*img\.alicdn\.com.*兜底/);
  assert.match(iconAssetText({ status: 'unavailable', code: 'icon_svg_only' }), /仅提供 SVG/);
  assert.match(iconAssetText({ status: 'unavailable', code: 'icon_no_candidates' }), /默认路径/);
  assert.match(iconAssetText({ status: 'unavailable', reason: '超时' }), /自动重试.*超时/);
});

test('只有真实终态才显示素材已确认，等待/重试明确后台继续', () => {
  assert.match(iconTaskText({ state: 'complete' }, {}), /已补齐/);
  assert.match(iconTaskText({ state: 'unsupported', reason: '仅提供 SVG' }, {}), /暂不可用.*SVG/);
  assert.match(iconTaskText({ state: 'retryable_failure', reason: '网络错误' }, {}), /稍后自动重试/);
  assert.match(iconTaskText({ state: 'pending_acquisition' }, {}), /获取中.*关闭此窗口也会继续/);
  assert.match(iconTaskText({ state: 'ready_to_upload' }, {}), /获取中/);
  assert.equal(iconTaskText(null, { previewPending: false, iconPending: false }), '资料和可用素材已确认');
  assert.match(iconTaskText(null, { iconPending: true }), /素材同步中/);
});
