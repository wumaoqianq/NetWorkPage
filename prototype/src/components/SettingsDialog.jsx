import { useState } from 'react';
import { Dialog } from './Dialog.jsx';
import { SettingsDialog as DemoSettingsDialog } from './DemoSettingsDialog.jsx';
import { DataSettings } from './DataSettings.jsx';
import { DevicesSettings } from './DevicesSettings.jsx';
import { AccountSettings } from './AccountSettings.jsx';
import { OrganizationSettings } from './OrganizationSettings.jsx';
import { AdminSettings } from './AdminSettings.jsx';
import { SharingSettings } from './SharingSettings.jsx';
import { UpdateSettings } from './UpdateSettings.jsx';

export function SettingsDialog({ workspace, user, demo, initialTab = 'data', onClose, onLogout }) {
  const [tab, setTab] = useState(initialTab);
  if (demo) return <DemoSettingsDialog sites={workspace.sites} onClose={onClose} onReset={workspace.reset} onImport={workspace.importSites} notify={workspace.setToast} />;
  const tabs = [['data', '资料与导入'], ['organization', '分类与工作集'], ['devices', '浏览器扩展'], ['sharing', '分享与通知'], ['account', '我的账号'], ...(user.isAdmin ? [['admin', '用户管理'], ['updates', '系统更新']] : [])];
  return <Dialog title="工作台设置" onClose={onClose} wide><p className="muted small-text settings-save-hint">各操作按钮提交后即时保存；未提交的表单修改需点击对应“保存”按钮。</p><nav className="settings-tabs" aria-label="设置分类">{tabs.map(([id, name]) => <button key={id} className={tab === id ? 'selected' : ''} onClick={() => setTab(id)}>{name}</button>)}</nav><div className="settings-content">
    {tab === 'data' && <DataSettings workspace={workspace} onConnectExtension={() => setTab('devices')} />}
    {tab === 'organization' && <OrganizationSettings workspace={workspace} />}
    {tab === 'devices' && <DevicesSettings notify={workspace.setToast} />}
    {tab === 'sharing' && <SharingSettings workspace={workspace} />}
    {tab === 'account' && <AccountSettings user={user} onLogout={onLogout} />}
    {tab === 'admin' && user.isAdmin && <AdminSettings user={user} notify={workspace.setToast} />}
    {tab === 'updates' && user.isAdmin && <UpdateSettings />}
  </div></Dialog>;
}
