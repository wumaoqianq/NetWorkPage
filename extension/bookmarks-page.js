import { $, send, showMessage } from './ui.js';
import { bookmarkFolders, collectBookmarks } from './bookmark-data.js';

let tree = null, snapshot = null, plan = null, connection = null, busy = false, stopRequested = false;
const unfinished = () => plan && !['complete', 'cancelled'].includes(plan.phase);
function buttons() {
  $('#read').disabled = busy || !connection || connection.paused;
  $('#confirm').disabled = busy || unfinished() || !snapshot?.items.length;
  $('#resume').disabled = busy || !plan?.canResume || !unfinished();
  $('#stop').disabled = !unfinished();
}
function renderPlan(value) {
  plan = value;
  $('#progress').hidden = !plan;
  if (plan) {
    $('#destination').textContent = `${plan.owner} · ${plan.server}`;
    $('#bar').max = plan.totalBatches || 1; $('#bar').value = plan.completedBatches;
    $('#counts').textContent = `${plan.phase === 'complete' ? '已完成' : plan.phase === 'cancelled' ? '已停止' : '已处理'} ${plan.completedBatches}/${plan.totalBatches} 批 · 新增 ${plan.imported} 个 · 跳过 ${plan.skipped} 个重复网址`;
    $('#import-error').textContent = plan.error || (!plan.canResume && unfinished() ? '请连接原账号后继续；旧任务不会发送到其他账号。' : '');
    $('#resume').hidden = !unfinished(); $('#stop').hidden = !unfinished();
  }
  buttons();
}
function preview() {
  snapshot = null; $('#sample').replaceChildren();
  try {
    snapshot = collectBookmarks(tree, $('#folder').value);
    $('#summary').textContent = `可导入 ${snapshot.items.length} 个网址 · 已合并 ${snapshot.duplicates} 个本机重复 · 跳过 ${snapshot.skipped} 个不支持的网址`;
    for (const item of snapshot.items.slice(0, 12)) {
      const row = document.createElement('li'), name = document.createElement('strong'), detail = document.createElement('small');
      name.textContent = item.title; detail.textContent = `${item.folder || '未分类'} · ${item.url}`;
      row.append(name, detail); $('#sample').append(row);
    }
  } catch (error) { $('#summary').textContent = error.message; }
  buttons();
}
async function run() {
  busy = true; stopRequested = false; buttons();
  try {
    while (!stopRequested && unfinished()) renderPlan(await send({ type: 'bookmarks-step' }));
    if (plan?.phase === 'complete') showMessage('导入已完成，原浏览器收藏没有改动。');
  } catch (error) { showMessage(error.message, true); renderPlan(await send({ type: 'bookmarks-status' })); }
  finally { busy = false; buttons(); }
}
$('#settings').addEventListener('click', () => chrome.runtime.openOptionsPage());
$('#read').addEventListener('click', async () => {
  // 权限请求紧随用户点击，不在页面打开、后台启动或网页消息中触发。
  const granted = await chrome.permissions.request({ permissions: ['bookmarks'] }).catch(() => false);
  if (!granted) { showMessage('你没有授权书签读取，没有读取或上传任何收藏。', true); return; }
  if (unfinished()) { showMessage('读取权限已确认，请继续之前已确认的导入任务。'); buttons(); return; }
  busy = true; buttons();
  try {
    tree = await chrome.bookmarks.getTree();
    $('#folder').replaceChildren(...bookmarkFolders(tree).map(item => { const option = document.createElement('option'); option.value = item.id; option.textContent = item.label; return option; }));
    $('#preview').hidden = false; preview();
    showMessage('已在本机读取收藏。请选择范围并确认，还没有向服务器发送。');
  } catch (error) { showMessage(error.message, true); }
  finally { busy = false; buttons(); }
});
$('#folder').addEventListener('change', preview);
$('#confirm').addEventListener('click', async () => {
  if (busy || !snapshot?.items.length) return;
  busy = true; buttons();
  try {
    renderPlan(await send({ type: 'bookmarks-start', confirmed: true, items: snapshot.items }));
    snapshot = null; $('#preview').hidden = true;
    await run();
  } catch (error) { busy = false; buttons(); showMessage(error.message, true); }
});
$('#resume').addEventListener('click', () => { if (!busy) void run(); });
$('#stop').addEventListener('click', async () => {
  if (!confirm('停止剩余导入？已完成的收藏会保留，不会改动原浏览器收藏。')) return;
  stopRequested = true;
  renderPlan(await send({ type: 'bookmarks-cancel' }));
  showMessage('已停止剩余导入，已完成的收藏保留。');
});
$('#revoke').addEventListener('click', async () => {
  if (unfinished()) { showMessage('请先停止剩余导入，再撤回读取权限。', true); return; }
  await chrome.permissions.remove({ permissions: ['bookmarks'] }); tree = null; snapshot = null;
  $('#preview').hidden = true; buttons(); showMessage('已撤回书签权限，已导入的收藏保留。');
});
$('#open-workspace').addEventListener('click', () => { if (connection) chrome.tabs.create({ url: connection.server }); });
async function refresh() {
  const state = await send({ type: 'status' }); connection = state.connection;
  $('#account').textContent = connection ? `将导入到 ${connection.user.email} · ${connection.server}` : '请先在连接设置中连接自己的工作台，然后回来读取收藏。';
  renderPlan(await send({ type: 'bookmarks-status' }));
}
chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.workspaceState) void refresh().catch(error => showMessage(error.message, true)); });
void refresh().catch(error => showMessage(error.message, true));
