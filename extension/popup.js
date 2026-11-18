// 工具栏小弹窗：只负责交互与截图预览，全部业务写入经后台单一 IndexedDB Outbox。
// 不打开新标签页、不跳转工作台、不要求去收件箱整理；关闭弹窗后已落盘任务继续同步。
import { $, send, showMessage } from './ui.js';
import { compressInPage } from './capture-compress.js';

// 与 manifest.json 同步：识别「目录已更新但浏览器未重新加载」的混合态。
const BUILD_VERSION = '1.10.0';
const MAX_RAW = 8 * 1024 * 1024;
let draftId = null, submitted = false, pollTimer = null, lastPhase = '';

function setSave(disabled, text) {
  $('#save').disabled = disabled;
  if (text) $('#save').textContent = text;
}
function renderTarget(draft, conn) {
  const target = draft?.target || {};
  $('#page-title').textContent = target.title || target.url || '（未命名页面）';
  $('#page-address').textContent = target.url || '';
  const desc = $('#page-desc');
  if (target.description) { desc.textContent = target.description; desc.hidden = false; }
  else { desc.hidden = true; desc.textContent = ''; }
  $('#connection-label').textContent = conn ? `${conn.server} · ${conn.user?.email || ''}` : '未连接工作台';
  $('#connected-dot').classList.toggle('connected', !!conn && !conn.paused);
  if (target.unsupportedReason) {
    const messages = { 'no-active-tab': '无法确定目标标签页', incognito: '隐身窗口暂不支持收藏',
      'unsupported-url': '当前标签页不是可收藏的普通 HTTP(S) 网页', 'debug-page': '请点击工具栏图标打开收藏' };
    $('#target-issue').textContent = messages[target.unsupportedReason] || '目标不可用';
    $('#target-issue').hidden = false;
    setSave(true, '目标不可用');
  } else if (!conn || conn.paused) {
    setSave(true, '请先连接工作台');
  }
}
function renderOptions(options) {
  const select = $('#category');
  select.replaceChildren(new Option('未分类', ''));
  const categories = Array.isArray(options?.categories) ? options.categories : [];
  for (const name of categories) select.append(new Option(name, name));
  $('#options-hint').textContent = categories.length
    ? `当前账号共 ${categories.length} 个分类` : '当前账号暂无自定义分类，可留空（未分类）。';
}
function showResult(title, detail, error = false) {
  const box = $('#cap-result');
  box.hidden = false; box.classList.toggle('error', error);
  $('#cap-result-title').textContent = title;
  $('#cap-result-detail').textContent = detail;
}
function renderShot(mode, note = '', url = '') {
  const box = $('#shot');
  box.dataset.shot = mode;
  const labels = { capturing: '正在截图…', ready: '截图已就绪', unavailable: '截图不可用' };
  $('#shot-label').textContent = labels[mode] || mode;
  const img = $('#shot-img');
  if (url) { img.src = url; img.hidden = false; } else { img.hidden = true; img.removeAttribute('src'); }
  const noteEl = $('#shot-note');
  noteEl.textContent = note; noteEl.hidden = !note;
  $('#shot-retry').hidden = mode !== 'unavailable';
  $('#shot-drop').hidden = !(url && !submitted);
}
function phaseText(status) {
  switch (status.phase) {
    case 'local_saved': case 'creating_site': return ['已保存，待同步', '文字已可靠存到本机，正在向工作台确认。', false];
    case 'waiting_network': return ['已保存，待同步', '当前离线，任务与备注已保留，恢复后自动续传；关闭弹窗也会继续。', false];
    case 'uploading_assets': return ['已保存，待同步', '网站已入库，截图/图标正在后台同步。', false];
    case 'complete': return ['已同步', `已收藏到${status.category ? `「${status.category}」` : '网站库'}，截图与备注都已入库。`, false];
    case 'needs_auth': return ['需要重新连接', status.lastError || '凭据失效，请用原账号重新配对；本地任务保留。', true];
    case 'conflict': return ['资料有冲突', status.lastError || '服务器资料已变化，请到工作台确认后再重试；不会覆盖新内容。', true];
    case 'failed': return ['收藏未完成', status.lastError || '请稍后重试。', true];
    case 'cancelled': return ['已取消', '这次收藏已取消，本地任务已移除。', true];
    case 'missing': return ['草稿已过期', '请重新点击工具栏图标打开收藏。', true];
    default: return ['正在处理…', '', false];
  }
}
function renderStatus(status) {
  const [title, detail, error] = phaseText(status);
  showResult(title, detail, error);
  const done = ['complete', 'cancelled', 'missing'].includes(status.phase);
  if (done || ['needs_auth', 'conflict', 'failed'].includes(status.phase)) stopPolling();
}
function statusSignature(s) { return [s.phase, s.preview?.state, s.icon?.state, s.category, s.lastError].join('|'); }
function stopPolling() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }
function startPolling() {
  stopPolling();
  pollTimer = setInterval(async () => {
    try {
      const status = await send({ type: 'capture-status', draftId });
      const sig = statusSignature(status);
      if (sig !== lastPhase) { lastPhase = sig; renderStatus(status); }
    } catch (error) { showMessage(error.message, true); }
  }, 1200);
}

/** 只把不可猜的 draftId 与点击时的 tab 交给后台；URL/标题由后台复核，不猜别的窗口。 */
async function resolveActiveTab() {
  const own = await chrome.tabs.getCurrent().catch(() => null);
  if (own && typeof own.id === 'number') return { tab: null, reason: 'debug-page' };
  for (const query of [{ active: true, currentWindow: true }, { active: true, lastFocusedWindow: true }, { active: true }]) {
    let list = [];
    try { list = await chrome.tabs.query(query); } catch { continue; }
    const tab = (list || []).find(t => t && typeof t.id === 'number' && /^https?:/i.test(t.url || ''));
    if (tab) return { tab: { id: tab.id, windowId: tab.windowId, index: tab.index,
      url: tab.url, title: tab.title || '', incognito: tab.incognito === true }, reason: '' };
  }
  return { tab: null, reason: 'no-active-tab' };
}

/** 截图压缩在弹窗 DOM/canvas 完成；成功原子替换原始快照，失败明确「这次未附截图」。 */
async function compressDraft(preview) {
  if (!preview || preview.state !== 'raw' || !preview.displayUrl) return null;
  try {
    const compressed = await compressInPage(preview.displayUrl, { maxRawBytes: MAX_RAW });
    if (!compressed) {
      await send({ type: 'capture-cancel-asset', draftId, kind: 'preview' }).catch(() => {});
      return null;
    }
    await send({ type: 'capture-compress', draftId, kind: 'preview', dataUrl: compressed.dataUrl,
      bytes: compressed.bytes, width: compressed.width, height: compressed.height });
    return compressed.dataUrl;
  } catch { return null; }
}
async function showShotFromDraft(draft) {
  const preview = draft?.preview;
  if (preview?.state === 'raw' && preview.displayUrl) {
    const url = await compressDraft(preview);
    if (url) renderShot('ready', '', url);
    else renderShot('unavailable', '这次未附截图（截图压缩失败或超过有界上限），收藏仍可保存。');
  } else if (preview?.displayUrl) {
    renderShot('ready', '', preview.displayUrl);
  } else {
    renderShot('unavailable', '这次未附截图（当前页截图不可用），收藏仍可保存。');
  }
}

$('#notes').addEventListener('input', () => { $('#notes-count').textContent = `${$('#notes').value.length}/2000`; });
$('#settings').addEventListener('click', () => chrome.runtime.openOptionsPage());
$('#capture-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (submitted || $('#save').disabled) return;
  submitted = true; setSave(true, '正在保存…');
  try {
    const result = await send({ type: 'capture-submit', draftId,
      form: { title: $('#page-title').textContent, notes: $('#notes').value,
        category: $('#category').value, later: $('#later').checked,
        autoIcon: !$('#no-auto-icon').checked } });
    lastPhase = statusSignature({ phase: result.phase });
    showResult('已保存，待同步', '文字已可靠存到本机；已取得的截图关联同一收藏，正在后台同步。');
    $('#shot-drop').hidden = true;
    startPolling();
  } catch (error) {
    submitted = false; setSave(false, '收藏到网站库');
    showMessage(error.message, true);
  }
});
$('#shot-retry').addEventListener('click', async () => {
  renderShot('capturing', '正在重新截图…');
  try {
    const result = await send({ type: 'capture-recapture', draftId });
    if (!result.ok) { renderShot('unavailable', result.reason || '原页面已切换或权限不可确认，不采集新页面。'); return; }
    const data = await send({ type: 'capture-draft', draftId });
    await showShotFromDraft(data.draft);
  } catch (error) { renderShot('unavailable', error.message); }
});
$('#shot-drop').addEventListener('click', async () => {
  try { await send({ type: 'capture-cancel-asset', draftId, kind: 'preview' });
    renderShot('unavailable', '这次未附截图，收藏仍可保存。'); } catch (error) { showMessage(error.message, true); }
});

async function init() {
  const { tab, reason } = await resolveActiveTab();
  if (!tab) {
    renderTarget({ target: { title: '（未命名页面）', url: '', unsupportedReason: reason } }, null);
    renderShot('unavailable', '当前没有可收藏的普通网页。');
    setSave(true, '目标不可用');
    return;
  }
  renderShot('capturing');
  try {
    const opened = await send({ type: 'capture-open', tab });
    draftId = opened.draftId;
    if (BUILD_VERSION !== chrome.runtime.getManifest?.().version) {
      showMessage('扩展文件已更新但浏览器尚未重新加载，请在 edge://extensions 点击「重新加载」。', true);
    }
    const data = await send({ type: 'capture-draft', draftId });
    renderTarget(data.draft, data.connection);
    renderOptions(data.options);
    send({ type: 'options' }).then(renderOptions).catch(() => {});
    let status = data.restoredStatus || await send({ type: 'capture-status', draftId });
    if (data.restoredStatus) { submitted = true; lastPhase = statusSignature(status); renderStatus(status); }
    await showShotFromDraft(data.draft);
    if (status.phase === 'draft' || status.phase === 'missing') setSave(false, '收藏到网站库');
    else { submitted = true; setSave(true, '已保存本地'); }
  } catch (error) {
    renderShot('unavailable', error.message);
    showResult('无法打开收藏', error.message, true);
    setSave(true, '暂不可用');
  }
}
void init();
