import { useState } from 'react';
import { Plus, Trash } from '@phosphor-icons/react';
import { categories as defaultCategories, collections as defaultCollections } from '../data.js';
import { validateSiteInput } from '../model.js';
import { Dialog } from './Dialog.jsx';

function createDraft(site) {
  return site ? { description: '', homepageUrl: '', ...structuredClone(site) } : {
    name: '', description: '', homepageUrl: '', purpose: '', notes: '', tags: [], category: '', kind: 'external', icon: 'generic',
    pinned: false, inbox: false, collections: [], accounts: [],
    endpoints: [{ id: crypto.randomUUID(), label: '默认入口', url: '', scope: '公网' }],
  };
}

export function SiteForm({ site, categories = defaultCategories, collections = defaultCollections, demo = false, onClose, onSave }) {
  const [draft, setDraft] = useState(() => {
    const value = createDraft(site);
    if (!site && !categories.includes(value.category)) value.category = categories[0] || '';
    return value;
  });
  const [tags, setTags] = useState(site?.tags.join('，') || '');
  const [aliases, setAliases] = useState(site?.aliases?.join('，') || '');
  const [error, setError] = useState('');
  const [tab, setTab] = useState('basic');
  const [saving, setSaving] = useState(false);
  const field = (key, value) => setDraft(current => ({ ...current, [key]: value }));
  const entryField = (index, key, value) => field('endpoints', draft.endpoints.map((e, i) => i === index ? { ...e, [key]: value } : e));
  const accountField = (index, key, value) => field('accounts', draft.accounts.map((a, i) => i === index ? { ...a, [key]: value } : a));
  async function submit(event) {
    event.preventDefault();
    if (saving) return;
    const problem = validateSiteInput(draft);
    if (problem) { setError(problem); setTab('basic'); return; }
    setSaving(true); setError('');
    try {
      await onSave({ ...draft, id: site?.id || crypto.randomUUID(), name: draft.name.trim(),
        description: draft.description.trim(), homepageUrl: draft.homepageUrl.trim(), purpose: draft.purpose.trim(),
        aliases: [...new Set(aliases.split(/[,，]/).map(t => t.trim()).filter(Boolean))].slice(0, 20),
        tags: [...new Set(tags.split(/[,，]/).map(t => t.trim()).filter(Boolean))].slice(0, 30),
        inbox: draft.inbox === true });
      onClose();
    } catch (failure) { setError(failure.message); }
    finally { setSaving(false); }
  }
  return <Dialog title={site ? '编辑网站资料' : '收藏一个新网站'} onClose={onClose} wide>
    <form onSubmit={submit} className="site-form" noValidate>
      <p className="form-intro">补一句用途，下次只记得“能做什么”也能找到它。</p>
      <div className="detail-tabs"><button type="button" className={tab === 'basic' ? 'selected' : ''} onClick={() => setTab('basic')}>基本资料与入口</button><button type="button" className={tab === 'accounts' ? 'selected' : ''} onClick={() => setTab('accounts')}>账号说明</button></div>
      <div className="form-scroll">
        {error && <p className="form-error" role="alert">{error}</p>}
        {tab === 'basic' ? <>
          <label className="field">网站名称 <span className="required">*</span><input name="name" value={draft.name} maxLength={100} onChange={e => field('name', e.target.value)} placeholder="例如：图片批量处理工具" required /></label>
          <label className="field">简介 <span className="character-count">{draft.description.length}/500</span><textarea rows={3} name="description" value={draft.description} maxLength={500} onChange={e => field('description', e.target.value)} placeholder="这个网站是什么、提供什么服务？" /></label>
          <p className="field-help">简介描述网站是什么；“我的用途”记录你为什么收藏。来源：{site?.descriptionSource === 'page_meta' ? '页面描述' : site?.descriptionSource === 'server_meta' ? '服务器元信息' : '手动'}。</p>
          <label className="field">首页地址 <span className="muted">· 选填</span><input name="homepageUrl" type="url" value={draft.homepageUrl || ''} maxLength={2048} onChange={e => field('homepageUrl', e.target.value)} placeholder="https://example.com/" /></label>
          <label className="field">我的用途<textarea rows={2} name="purpose" value={draft.purpose} maxLength={1000} onChange={e => field('purpose', e.target.value)} placeholder="以后你会因为什么来找它？" /></label>
          <div className="form-columns"><label className="field">网站分类<select value={draft.category} onChange={e => field('category', e.target.value)}><option value="">未分类</option>{categories.map(c => <option key={c}>{c}</option>)}</select></label><label className="field">网站类型<select value={draft.kind} onChange={e => field('kind', e.target.value)}><option value="external">第三方网站</option><option value="selfhosted">自己部署的服务</option></select></label></div>
          <div className="field"><span>访问入口 <span className="required">*</span></span>{draft.endpoints.map((entry, i) => <div className="entry-form" key={entry.id}>
            <div className="entry-form-heading"><strong>{i === 0 ? '默认入口' : `其他入口 ${i}`}</strong>{i > 0 && <button className="icon-button danger-text" type="button" aria-label={`删除入口${i}`} onClick={() => { const remaining = draft.endpoints.filter((_, n) => n !== i); setDraft(current => ({ ...current, endpoints: remaining, defaultEndpointId: remaining.some(e => e.id === current.defaultEndpointId) ? current.defaultEndpointId : remaining[0].id })); }}><Trash size={17} /></button>}</div>
            <input aria-label={`入口${i + 1}名称`} value={entry.label} maxLength={40} onChange={e => entryField(i, 'label', e.target.value)} placeholder="入口名称" />
            <div className="entry-url-row"><input aria-label={`入口${i + 1}网址`} value={entry.url} maxLength={2000} onChange={e => entryField(i, 'url', e.target.value)} placeholder="https://example.com" inputMode="url" required /><select aria-label={`入口${i + 1}访问条件`} value={entry.scope} onChange={e => entryField(i, 'scope', e.target.value)}>{['公网', '局域网', '本机', '需 VPN'].map(s => <option key={s}>{s}</option>)}</select></div>
          </div>)}{draft.endpoints.length < 6 && <button className="text-button add-entry" type="button" onClick={() => field('endpoints', [...draft.endpoints, { id: crypto.randomUUID(), label: '其他入口', url: '', scope: '公网' }])}><Plus size={17} />添加一个访问入口</button>}</div>
          {draft.endpoints.length > 1 && <label className="field">默认访问入口<select value={draft.defaultEndpointId || draft.endpoints[0].id} onChange={e => field('defaultEndpointId', e.target.value)}>{draft.endpoints.map(entry => <option key={entry.id} value={entry.id}>{entry.label || entry.url || '未命名入口'}</option>)}</select></label>}
          <label className="field">标签<input value={tags} maxLength={250} onChange={e => setTags(e.target.value)} placeholder="用逗号分隔，例如：图片压缩，批量处理" /></label>
          <label className="field">别名与搜索关键词<input value={aliases} maxLength={500} onChange={e => setAliases(e.target.value)} placeholder="用逗号分隔，例如：图片瘦身，压图工具" /></label>
          <label className="field">我的备注<textarea value={draft.notes} maxLength={2000} rows={3} onChange={e => field('notes', e.target.value)} placeholder="记下使用经验、限制或容易忘记的事情。请勿填写密码。" /></label>
          <div className="field"><span>加入工作集</span><div className="checkbox-group">{collections.map(c => <label key={c.id}><input type="checkbox" checked={draft.collections.includes(c.id)} onChange={e => field('collections', e.target.checked ? [...draft.collections, c.id] : draft.collections.filter(id => id !== c.id))} />{c.name}</label>)}</div></div>
          <label className="checkbox-line"><input type="checkbox" checked={Boolean(draft.pinned)} onChange={e => field('pinned', e.target.checked)} />置顶优先显示（不影响是否出现在首页）</label>
          <label className="checkbox-line"><input type="checkbox" checked={Boolean(draft.inbox)} onChange={e => field('inbox', e.target.checked)} />暂存收件箱，稍后整理</label>
        </> : <><p className="info-banner">只记录账号用途和登录方式，密码请保存在独立密码管理器中。请勿在此填写密码、恢复码或 API 密钥。</p>{draft.accounts.map((account, i) => <div className="entry-form" key={i}><div className="entry-form-heading"><strong>账号 {i + 1}</strong><button className="icon-button danger-text" type="button" aria-label={`移除账号${i + 1}`} onClick={() => field('accounts', draft.accounts.filter((_, n) => i !== n))}><Trash size={17} /></button></div><label className="field">账号用途<input value={account.label} onChange={e => accountField(i, 'label', e.target.value)} placeholder="日常使用 / 管理员" maxLength={60} /></label><label className="field">用户名或邮箱<input value={account.username} onChange={e => accountField(i, 'username', e.target.value)} maxLength={200} /></label><label className="field">登录方式<select value={account.method} onChange={e => accountField(i, 'method', e.target.value)}>{['邮箱密码', '用户名密码', 'Google 登录', '微信登录', '统一身份登录', '无需登录'].map(m => <option key={m}>{m}</option>)}</select></label><label className="field">关联入口<select value={account.endpointId || ''} onChange={e => accountField(i, 'endpointId', e.target.value)}><option value="">网站通用</option>{draft.endpoints.map(entry => <option key={entry.id} value={entry.id}>{entry.label || entry.url}</option>)}</select></label><label className="field">登录页网址（可选）<input value={account.loginUrl || ''} maxLength={2000} placeholder="留空则使用网站入口" onChange={e => accountField(i, 'loginUrl', e.target.value)} /></label><label className="field">登录备注<input value={account.notes} onChange={e => accountField(i, 'notes', e.target.value)} maxLength={300} placeholder="例如：使用工作邮箱对应的账号" /></label></div>)}<button className="secondary-button full-width" type="button" onClick={() => field('accounts', [...draft.accounts, { label: '', username: '', method: '邮箱密码', notes: '' }])}><Plus size={18} />添加账号说明</button></>}
      </div>
      <footer className="form-footer"><span className="muted small-text">{demo ? '本次演示仅保存在内存' : '资料仅保存到你的账号'}</span><button type="button" className="secondary-button" disabled={saving} onClick={onClose}>取消</button><button type="submit" className="primary-button" disabled={saving}>{saving ? '正在保存…' : site ? '保存修改' : '收藏网站'}</button></footer>
    </form>
  </Dialog>;
}
