import { useState } from 'react';
import { PencilSimple, Plus, Trash } from '@phosphor-icons/react';
import { api } from '../api.js';

export function OrganizationSettings({ workspace }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState('');
  async function mutate(key, path, method, body) {
    if (busy) return null;
    setBusy(key); setError(''); setFeedback('');
    try {
      const result = await api.request(path, { method, body });
      await workspace.refresh(); setDeleting(null); return result;
    } catch (failure) { setError(`${failure.message} 输入和当前确认框已保留，可修正或重试。`); return null; }
    finally { setBusy(''); }
  }
  async function submitCategory(event) {
    event.preventDefault();
    const value = category.trim();
    const result = await mutate('category-add', '/api/categories', 'POST', { name: value });
    if (!result) return;
    setCategory('');
    const message = result.created ? `已添加分类「${value}」` : `分类「${value}」已存在`;
    setFeedback(message); workspace.setToast(message);
  }
  async function deleteCategory(value) {
    const result = await mutate(`category-delete:${value}`, `/api/categories/${encodeURIComponent(value)}`, 'DELETE', { name: value });
    if (!result) return;
    const message = `已删除分类「${value}」，${result.affected} 个网站保留在未分类`;
    setFeedback(message); workspace.setToast(message);
  }
  async function submitCollection(event) {
    event.preventDefault();
    const result = await mutate('collection-save', editing ? `/api/collections/${editing}` : '/api/collections', editing ? 'PATCH' : 'POST', { name, description });
    if (!result) return;
    setName(''); setDescription(''); setEditing(null); setFeedback('工作集已保存'); workspace.setToast('工作集已保存');
  }
  return <><p className="muted small-text">分类和工作集操作后即时保存，无需另点全页保存。</p>{error && <p role="alert" className="form-error">{error}</p>}{feedback && <p role="status" className="form-success">{feedback}</p>}<section className="detail-section"><h3>网站分类</h3><p className="muted small-text">删除分类只取消分类标记，网站仍保留在网站库。</p><div className="organization-tags">{workspace.categories.map(item => <div key={item}><span>{item}</span>{deleting === `category:${item}` ? <><button disabled={Boolean(busy)} onClick={() => setDeleting(null)}>取消</button><button className="danger-text" disabled={Boolean(busy)} onClick={() => deleteCategory(item)}>{busy === `category-delete:${item}` ? '正在删除…' : '确认删除'}</button></> : <button aria-label={`删除分类${item}`} disabled={Boolean(busy)} onClick={() => { setDeleting(`category:${item}`); setError(''); setFeedback(''); }}><Trash size={14} /></button>}</div>)}</div><form className="inline-form" onSubmit={submitCategory}><input aria-label="新分类名称" value={category} maxLength={100} required disabled={Boolean(busy)} onChange={e => setCategory(e.target.value)} placeholder="添加一个分类" /><button type="submit" className="secondary-button" disabled={Boolean(busy)}><Plus size={17} />{busy === 'category-add' ? '正在添加…' : '添加'}</button></form></section>
    <section className="detail-section"><h3>工作集</h3><p className="muted small-text">围绕任务组合网站；删除工作集不会删除其中的网站。</p><div className="device-list">{workspace.collections.map(item => <div className="device-item" key={item.id}><div><strong>{item.name}</strong><p>{item.description || '还没有说明'}</p></div>{deleting === item.id ? <><button className="text-button" disabled={Boolean(busy)} onClick={() => setDeleting(null)}>取消</button><button className="danger-button" disabled={Boolean(busy)} onClick={() => mutate(`collection-delete:${item.id}`, `/api/collections/${item.id}`, 'DELETE', {}).then(result => { if (result) { setFeedback('工作集已删除'); workspace.setToast('工作集已删除'); } })}>{busy === `collection-delete:${item.id}` ? '正在删除…' : '确认删除'}</button></> : <><button className="icon-button" aria-label={`编辑${item.name}`} onClick={() => { setEditing(item.id); setName(item.name); setDescription(item.description); }}><PencilSimple size={17} /></button><button className="icon-button danger-text" aria-label={`删除工作集${item.name}`} onClick={() => setDeleting(item.id)}><Trash size={17} /></button></>}</div>)}</div>
      <form onSubmit={submitCollection} className="organization-form"><h4>{editing ? '编辑工作集' : '新建工作集'}</h4><label className="field">名称<input value={name} required maxLength={100} onChange={e => setName(e.target.value)} /></label><label className="field">用途说明<input value={description} maxLength={500} onChange={e => setDescription(e.target.value)} placeholder="例如：发布一个网站时需要的工具" /></label><div className="settings-actions">{editing && <button className="secondary-button" type="button" onClick={() => { setEditing(null); setName(''); setDescription(''); }}>取消编辑</button>}<button className="primary-button" type="submit" disabled={Boolean(busy)}>{busy === 'collection-save' ? '正在保存…' : editing ? '保存工作集' : '创建工作集'}</button></div></form>
    </section></>;
}
