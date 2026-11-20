import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';

const stages = {
  verified: '发布包已验证', maintenance_on: '维护中', backed_up: '已备份',
  backup_verified: '备份已试恢复', migrating: '正在迁移', migrated: '迁移完成',
  switched: '正在验证新版', complete: '升级完成', failed: '升级失败',
  rollback_restored: '已恢复备份，正在检查旧版', rolled_back: '已回退到旧版',
  rollback_failed: '回退未完成，需要管理员处理',
};

function releaseLink(repo, tag) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !/^v?[0-9]+\.[0-9]+\.[0-9]+(?:-[\w.-]+)?$/.test(tag)) return null;
  return `https://github.com/${repo}/releases/tag/${encodeURIComponent(tag)}`;
}

export function UpdateSettings() {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState({ loading: true });
  const refresh = useCallback(() => setAttempt(value => value + 1), []);
  useEffect(() => {
    let active = true;
    setState({ loading: true });
    api.request('/api/update/status').then(data => {
      if (active) setState({ data });
    }).catch(error => {
      if (active) setState({ error: error.message });
    });
    return () => { active = false; };
  }, [attempt]);

  const data = state.data;
  const latest = data?.available;
  const link = latest && releaseLink(data.repo, latest.tag);
  const last = data?.lastUpgrade;
  const availability = {
    update: `发现新版本 ${latest?.version || ''}`,
    current: '当前轨道暂无更新', unavailable: '暂时无法连接 GitHub，收藏和同步不受影响。',
  };
  return <section className="detail-section" aria-busy={Boolean(state.loading)}>
    <div className="section-heading"><h3>系统更新</h3><button type="button" className="text-button" onClick={refresh} disabled={state.loading}>刷新状态</button></div>
    {state.loading && <p role="status" className="muted">正在读取更新状态…</p>}
    {state.error && <p role="alert" className="form-error">{state.error}</p>}
    {data && <>
      <p>当前版本：<strong>{data.currentVersion === 'unknown' ? '本地开发版 / 未配置' : data.currentVersion}</strong> · {data.track === 'prerelease' ? '预发布' : '稳定'}轨道</p>
      <p role="status">{availability[data.upstream] || '暂无可用的检查记录'}</p>
      {data.lastCheck && <p className="small-text muted">上次检查：{new Date(data.lastCheck).toLocaleString('zh-CN')}</p>}
      {link && <p><a href={link} target="_blank" rel="noreferrer">查看 GitHub 发布说明</a></p>}
      {data.maintenance && <p role="status">工作台正在维护，扩展收藏会保留在本地队列。</p>}
      {last?.stage && <p>最近升级：{stages[last.stage] || '请查看服务器记录'}{last.target && `（目标 ${last.target}）`}</p>}
      {last?.timerFailures?.length > 0 && <p role="alert">部分定时任务未恢复，请检查服务器升级日志。</p>}
      {data.currentVersion !== 'unknown' && <details><summary>服务器操作</summary><p className="muted small-text">刷新状态只读取服务器的检查结果。需要立即检查更新时，请在服务器运行：</p><code style={{ overflowWrap: 'anywhere' }}>{data.commands?.check}</code><p className="muted small-text">下载安装、备份和回退由服务器管理员执行。</p></details>}
    </>}
  </section>;
}
