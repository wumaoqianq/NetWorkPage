// 普通扩展收藏标签页：不因失焦消失；所有业务写入经后台单一 Outbox。
// 阶段 C：原始截图在本页 DOM/canvas 中压缩（worker 无 document），结果经后台原子替换。
import { $, send, showMessage } from './ui.js';
import { compressInPage } from './capture-compress.js';

const params = new URLSearchParams(location.search);
const draftId = params.get('draft') || '';
let connection = null;
let target = null;
let submitted = false;
let pollTimer = null;
let lastPhase = '';

function setSaveState(disabled, text) {
  $('#save').disabled = disabled;
  if (text) $('#save').textContent = text;
}

/** 页面内展示自动取得的小预览（只作 display，绝不当作 sourceUrl）。 */
function renderAssets(status) {
  const preview = status?.preview;
  const icon = status?.icon;
  const box = $('#asset-panel');
  const has = preview || icon;
  box.hidden = !has;
  if (!has) return;
  $('#preview-thumb').hidden = !preview?.displayUrl;
  if (preview?.displayUrl) $('#preview-thumb').src = preview.displayUrl;
  const labels = [];
  if (preview) labels.push(`截图：${assetLabel(preview.state)}`);
  if (icon) labels.push(`图标：${assetLabel(icon.state)}`);
  $('#asset-status').textContent = labels.join(' · ');
  const cancellable = [preview, icon].some(asset => asset && ['raw', 'ready', 'conflict'].includes(asset.state));
  $('#cancel-preview').hidden = !(preview && ['raw', 'ready', 'conflict'].includes(preview.state));
  $('#cancel-icon').hidden = !(icon && ['raw', 'ready', 'conflict'].includes(icon.state));
  void cancellable;
}
function assetLabel(state) {
  return ({ raw: '已取得，待压缩', ready: '已压缩，等待上传', uploading: '上传中',
    uploaded: '已上传', conflict: '资料冲突，已保留本地文件', cancelled: '已移除' })[state] || state;
}

/** 原始快照在本页 canvas 压缩；失败/超限则省略截图，不阻塞文字草稿。 */
async function compressDraft(draft) {
  const preview = draft.preview;
  if (!preview || preview.state !== 'raw' || !preview.displayUrl) return;
  const compressed = await compressInPage(preview.displayUrl);
  if (!compressed) {
    // 转换失败：明确取消该素材（删除有界原始快照），文字照常可提交。
    try { await send({ type: 'capture-cancel-asset', draftId, kind: 'preview' }); } catch { /* 后台可能已清理 */ }
    return;
  }
  await send({ type: 'capture-compress', draftId, kind: 'preview', dataUrl: compressed.dataUrl,
    bytes: compressed.bytes, width: compressed.width, height: compressed.height });
}
function showResult(title, detail, error = false) {
  $('#result').hidden = false;
  $('#result').classList.toggle('error', error);
  $('#result-title').textContent = title;
  $('#result-detail').textContent = detail;
}
function phaseText(status) {
  switch (status.phase) {
    case 'local_saved': case 'creating_site': return ['已保存本地，正在同步…', '本地事务已成功，联网确认后才会显示「已入库」。', false];
    case 'waiting_network': return ['已保存本地，等待网络', '当前无法连接工作台，任务与备注都已保留，恢复后自动重试。', false];
    case 'uploading_assets': return ['网站已入库', '文字已确认，素材在后台同步。', false];
    case 'complete': {
      const base = `已收藏到${status.category ? `「${status.category}」` : '网站库'}。`;
      const queued = status.iconJob?.queued === true && !status.icon?.displayUrl;
      return queued
        ? ['已入库，图标获取中', `${base} 缺图已由工作台在后台补齐，稍后自动完成，不影响这次收藏。` , false]
        : ['已入库', base, false];
    }
    case 'needs_auth': return ['需要重新连接', status.lastError || '凭据失效，请用原账号重新配对；本地任务保留。', true];
    case 'conflict': return ['资料有冲突', status.lastError || '服务器资料已变化，请到工作台确认后再重试；不会覆盖新内容。', true];
    case 'failed': return ['收藏未完成', status.lastError || '请稍后重试或取消这次收藏。', true];
    case 'cancelled': return ['已取消', '这次收藏已取消，本地任务已移除。', true];
    case 'missing': return ['草稿已过期', '请回到目标网站，点击工具栏图标重新打开收藏。', true];
    default: return ['正在处理…', '', false];
  }
}
function renderStatus(status) {
  const [title, detail, error] = phaseText(status);
  showResult(title, detail, error);
  renderAssets(status);
  const done = ['complete', 'cancelled', 'missing'].includes(status.phase);
  const waiting = ['needs_auth', 'conflict', 'failed'].includes(status.phase);
  const local = ['waiting_network', 'uploading_assets'].includes(status.phase);
  $('#view').hidden = status.phase !== 'complete';
  $('#retry').hidden = !(waiting || local);
  $('#cancel').hidden = done;
  if (done || waiting) stopPolling();
}
function statusSignature(status) {
  return [status.phase, status.preview?.state, status.icon?.state,
    status.category, status.lastError].join('|');
}
function stopPolling() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }
function startPolling() {
  stopPolling();
  pollTimer = setInterval(async () => {
    try { const status = await send({ type: 'capture-status', draftId });
      const signature = statusSignature(status);
      if (signature !== lastPhase) { lastPhase = signature; renderStatus(status); }
    } catch (error) { showMessage(error.message, true); }
  }, 1200);
}

function renderOptions(options) {
  const select = $('#category');
  select.replaceChildren(new Option('未分类', ''));
  const categories = Array.isArray(options?.categories) ? options.categories : [];
  for (const name of categories) select.append(new Option(name, name));
  $('#options-hint').textContent = categories.length
    ? `当前账号共 ${categories.length} 个分类` : '当前账号暂无自定义分类，可留空（未分类）。';
}
function renderTarget(draft, conn) {
  connection = conn;
  target = draft.target || {};
  $('#page-title').textContent = target.title || target.url || '（未命名页面）';
  $('#page-address').textContent = target.url || '';
  const version = chrome.runtime.getManifest?.().version;
  $('#connection-label').textContent = conn
    ? `${conn.server} · ${conn.user?.email || ''} · v${version}` : '未连接工作台';
  $('#connected-dot').classList.toggle('connected', !!conn && !conn.paused);
  if (target.unsupportedReason) {
    const messages = { 'no-active-tab': '无法确定目标标签页', incognito: '隐身窗口暂不支持收藏',
      'unsupported-url': '当前标签页不是可收藏的普通 HTTP(S) 网页' };
    $('#target-issue').textContent = `${messages[target.unsupportedReason] || '目标不可用'}。请回到目标网站重新点击工具栏图标。`;
    $('#target-issue').hidden = false;
    setSaveState(true, '目标不可用');
  } else if (!conn || conn.paused) {
    setSaveState(true, '请先连接工作台');
    showMessage('尚未连接或连接已暂停；请在「连接设置」里配对原账号。', true);
  }
}

$('#notes').addEventListener('input', () => { $('#notes-count').textContent = `${$('#notes').value.length}/2000`; });
$('#capture-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (submitted || $('#save').disabled) return;
  submitted = true; setSaveState(true, '正在保存…');
  try {
    const result = await send({ type: 'capture-submit', draftId,
      form: { title: $('#page-title').textContent, notes: $('#notes').value,
        category: $('#category').value, later: $('#later').checked,
        autoIcon: !$('#no-auto-icon').checked } });
    lastPhase = statusSignature(result);
    showMessage('已保存本地。');
    renderStatus({ phase: result.phase });
    startPolling();
    setSaveState(true, '已保存本地');
  } catch (error) {
    submitted = false; setSaveState(false, '收藏到网站库');
    showMessage(error.message, true);
  }
});
$('#retry').addEventListener('click', async () => {
  try { const status = await send({ type: 'capture-retry', draftId });
    lastPhase = ''; renderStatus(status); startPolling(); showMessage('已请求重试。');
  } catch (error) { showMessage(error.message, true); }
});
$('#cancel').addEventListener('click', async () => {
  if (!confirm('确定取消这次收藏？本地任务会被移除，不影响服务器已有收藏。')) return;
  try { const status = await send({ type: 'capture-cancel', draftId }); renderStatus(status); }
  catch (error) { showMessage(error.message, true); }
});
$('#view').addEventListener('click', () => { if (connection?.server) chrome.tabs.create({ url: connection.server }); });
$('#back').addEventListener('click', async () => {
  try {
    if (typeof target?.tabId === 'number') {
      await chrome.windows.update(target.windowId, { focused: true });
      await chrome.tabs.update(target.tabId, { active: true });
    }
  } catch { /* 源标签已关闭：保留当前页供查看结果，不自动关闭导致看不到错误 */ }
});
$('#settings').addEventListener('click', () => chrome.runtime.openOptionsPage());
for (const [id, kind] of [['cancel-preview', 'preview'], ['cancel-icon', 'icon']]) {
  $('#' + id).addEventListener('click', async () => {
    try {
      const status = await send({ type: 'capture-cancel-asset', draftId, kind });
      renderAssets(status); showMessage(`已移除${kind === 'icon' ? '图标' : '截图'}任务，文字收藏不受影响。`);
    } catch (error) { showMessage(error.message, true); }
  });
}

async function init() {
  if (!draftId) { showResult('缺少草稿标识', '请从工具栏图标打开收藏页，不要直接输入本页地址。', true); setSaveState(true); return; }
  try {
    const data = await send({ type: 'capture-draft', draftId });
    renderTarget(data.draft, data.connection);
    renderOptions(data.options);
    // 后台刷新分类缓存，失败不阻塞（用上次缓存的分类）。
    send({ type: 'options' }).then(renderOptions).catch(() => {});
    // 浏览器重启恢复已提交表单时，capture-draft 直接给出真实阶段，无需再查。
    let status = data.restoredStatus || await send({ type: 'capture-status', draftId });
    if (status.phase === 'draft') {
      // 草稿：在本页把原始截图压缩成有界 WebP，转换成功即由后台清除原始快照。
      await compressDraft(data.draft).catch(error => showMessage(`截图处理失败，已省略截图：${error.message}`));
      status = await send({ type: 'capture-status', draftId });
      renderAssets({ phase: 'draft', preview: data.draft.preview?.state === 'raw'
        ? { state: 'ready', displayUrl: data.draft.preview.displayUrl } : data.draft.preview,
        icon: data.draft.icon });
    }
    if (status.phase !== 'draft' && status.phase !== 'missing') {
      submitted = true; lastPhase = statusSignature(status); renderStatus(status);
      setSaveState(true, '已保存本地');
      if (!['complete', 'cancelled', 'needs_auth', 'conflict', 'failed'].includes(status.phase)) startPolling();
    }
  } catch (error) { showResult('无法打开草稿', error.message, true); setSaveState(true); }
}
void init();
