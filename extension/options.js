import { normalizeServer } from './queue.js';
import { loadPreferences, savePreferences } from './preferences.js';
import { $, send, showMessage, queueLabel, permissionPattern } from './ui.js';

let currentState;
let pairing = false;
function renderQueue(state) {
  $('#queue-count').textContent = `${queueLabel(state.summary)} · 本地总计 ${state.summary.total} 条`;
  $('#delete-all').disabled = !state.queue.length;
  const list = $('#queue-list');
  list.replaceChildren();
  for (const item of state.queue) {
    const row = document.createElement('article');
    row.className = 'queue-item';
    const title = document.createElement('strong');
    title.textContent = item.payload.title || item.payload.url;
    const details = document.createElement('p');
    details.className = 'muted';
    const label = { pending: '等待同步', preview_pending: '网站已确认，截图待上传', auth: '凭据失效，需重新配对',
      blocked: '资料或图片被拒绝，请检查后重试', conflict: '版本冲突，请刷新对比', cancelled: '已由新修订替代' };
    details.textContent = `${label[item.state] || item.state} · ${item.server} · 账号 #${item.userId}`;
    const url = document.createElement('p');
    url.className = 'queue-url';
    url.textContent = item.payload.url;
    const error = document.createElement('p');
    error.className = 'error';
    error.textContent = item.lastError || '';
    const remove = document.createElement('button');
    remove.className = 'quiet danger-text';
    remove.textContent = '删除此本地待同步项';
    remove.addEventListener('click', async () => {
      if (!confirm(`确定删除本地待同步项“${item.payload.title}”？此操作不会删除服务器收藏。`)) return;
      try { render(await send({ type: 'delete', ids: [item.id] })); }
      catch (failure) { showMessage(failure.message, true); }
    });
    row.append(title, details, url, error);
    if (item.attachment) {
      const cancel = document.createElement('button'); cancel.className = 'quiet'; cancel.textContent = '移除图片任务（保留网站文字）';
      cancel.addEventListener('click', async () => {
        try { render(await send({ type: 'cancel-attachment', id: item.id })); }
        catch (failure) { showMessage(failure.message, true); }
      });
      row.append(cancel);
    }
    row.append(remove);
    list.append(row);
  }
  if (!state.queue.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = '暂无本地待同步项。';
    list.append(empty);
  }
}
function render(state) {
  currentState = state;
  const connection = state.connection;
  $('#connection').textContent = connection
    ? `${connection.user.name || connection.user.email} · ${connection.user.email} · ${connection.server}`
    : '尚未连接工作台';
  $('#expiry').textContent = connection
    ? `设备：${connection.device.name || connection.device.id} · 凭据有效期至 ${new Date(connection.expiresAt).toLocaleString('zh-CN')}` : '';
  $('#pause').textContent = connection?.paused ? `同步已暂停：${connection.pauseReason} 请重新配对。` : '';
  const release = state.release;
  $('#release-status').textContent = release?.version
    ? `当前版本 ${release.currentVersion} / 可用版本 ${release.version} · 协议 ${release.protocolRange?.min}–${release.protocolRange?.max}`
    : `当前版本 ${chrome.runtime.getManifest().version}；兼容检查失败不会影响收藏。`;
  $('#disconnect').disabled = !connection;
  $('#open-workspace').disabled = !connection;
  if (!$('#server').value && connection) $('#server').value = connection.server;
  const key = connection ? `${connection.server}|${connection.user.id}` : '';
  void loadPreferences(connection).then(value => {
    if (!connection || key !== `${currentState?.connection?.server}|${currentState?.connection?.user?.id}`) return;
    $('#preference-auto-preview').checked = value.autoPreview;
    $('#preference-remember-category').checked = value.rememberCategory;
  }).catch(error => showMessage(`自动素材设置读取失败：${error.message}`, true));
  renderQueue(state);
}
for (const [id, key] of [['preference-auto-preview', 'autoPreview'], ['preference-remember-category', 'rememberCategory']]) {
  $(`#${id}`).addEventListener('change', async event => {
    if (!currentState?.connection) { event.target.checked = !event.target.checked; showMessage('请先连接账号，再保存此偏好。', true); return; }
    event.target.disabled = true;
    try { await savePreferences(currentState.connection, { [key]: event.target.checked }); showMessage('自动素材偏好已即时保存。'); }
    catch (error) { showMessage(`偏好保存失败：${error.message} 请重试。`, true); }
    finally { event.target.disabled = false; }
  });
}
$('#pair-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (pairing) return;
  pairing = true;
  $('#pair').disabled = true;
  try {
    const server = normalizeServer($('#server').value);
    $('#pair').textContent = `正在连接 ${server}…`;
    // 权限申请直接发生在用户点击事件中，不在后台自动申请。
    const granted = await chrome.permissions.request({ origins: [permissionPattern(server)] });
    if (!granted) throw new Error('未授权服务器访问，尚未配对。');
    render(await send({ type: 'pair', server, code: $('#code').value, name: $('#device-name').value }));
    $('#code').value = '';
    showMessage(`已连接到 ${server}。收藏时自动保存当前页面预览、网站图标和简介；截图可能包含登录内容，可在自动素材设置关闭。`);
  } catch (error) { showMessage(error.message, true); }
  finally { pairing = false; $('#pair').disabled = false; $('#pair').textContent = '授权此服务器并连接'; }
});
$('#disconnect').addEventListener('click', async () => {
  try {
    const server = currentState.connection?.server;
    render(await send({ type: 'disconnect' }));
    if (server) await chrome.permissions.remove({ origins: [permissionPattern(server)] });
    showMessage('已移除本地凭据和服务器权限。待同步项保留；服务器设备需在网页撤销。');
  } catch (error) { showMessage(error.message, true); }
});
$('#retry').addEventListener('click', async () => {
  try { render(await send({ type: 'retry' })); showMessage('已请求重试。凭据失效时请重新配对原账号。'); }
  catch (error) { showMessage(error.message, true); }
});
$('#delete-all').addEventListener('click', async () => {
  if (!confirm(`确定永久删除全部 ${currentState.queue.length} 条本地待同步项（含其他账号）？尚未同步的资料将丢失。`)) return;
  try {
    render(await send({ type: 'delete', ids: currentState.queue.map(item => item.id) }));
    showMessage('所选本地待同步项已删除。');
  } catch (error) { showMessage(error.message, true); }
});
$('#open-workspace').addEventListener('click', () => {
  if (currentState.connection) void chrome.tabs.create({ url: currentState.connection.server });
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.workspaceState) {
    void send({ type: 'status' }).then(render).catch(error => showMessage(error.message, true));
  }
});
void send({ type: 'status' }).then(render).catch(error => showMessage(error.message, true));

$('#check-release').addEventListener('click', async () => {
  try { const release = await send({ type: 'release' });
    $('#release-status').textContent = `当前版本 ${release.currentVersion} / 可用版本 ${release.version}；检查时间 ${new Date(release.checkedAt).toLocaleString('zh-CN')}`;
  } catch (error) { showMessage(`${error.message} 收藏功能保持可用。`, true); }
});
