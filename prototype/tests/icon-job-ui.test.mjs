import test from 'node:test';
import assert from 'node:assert/strict';
import { iconJobState } from '../src/model.js';

test('缺图且服务端 Job 排队中：显示「图标获取中」，不假报已有图标', () => {
  const site = { presentation: { icon: { present: false } },
    iconJob: { queued: true, phase: 'pending', attempts: 0 } };
  assert.deepEqual(iconJobState(site), { fetching: true, label: '图标获取中', present: false });
});

test('已有图标（含自定义/客户端上传）时，即使 Job 残留也不显示获取中、不被覆盖', () => {
  const site = { presentation: { icon: { present: true, revision: 'r1' } },
    iconJob: { queued: true, phase: 'leased', attempts: 1 } };
  assert.deepEqual(iconJobState(site), { fetching: false, label: '', present: true });
});

test('无 Job / Job 已终态：不显示获取中', () => {
  assert.deepEqual(iconJobState({ presentation: { icon: { present: false } } }),
    { fetching: false, label: '', present: false });
  assert.deepEqual(iconJobState({ presentation: { icon: { present: false } },
    iconJob: { queued: false, phase: 'no_icon', attempts: 3 } }),
    { fetching: false, label: '', present: false });
});

test('phase 是终态但 queued 误传 true 时仍以 present/queued 双重判定为准', () => {
  const site = { presentation: { icon: { present: false } },
    iconJob: { queued: false, phase: 'complete', attempts: 1 } };
  assert.equal(iconJobState(site).fetching, false);
});
