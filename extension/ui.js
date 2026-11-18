export const $ = selector => document.querySelector(selector);
export async function send(message) {
  const result = await chrome.runtime.sendMessage(message);
  if (!result?.ok) throw Object.assign(new Error(result?.error || '扩展后台暂时不可用，请重新打开。'),
    { code: result?.code, status: result?.status });
  return result.data;
}
export function showMessage(value, error = false) {
  const element = $('#message');
  element.textContent = value;
  element.classList.toggle('error', error);
}
export function queueLabel(summary) {
  return `待同步 ${summary.current} 条${summary.other ? ` · 其他账号/服务器保留 ${summary.other} 条` : ''}`;
}
export function permissionPattern(server) {
  return `${new URL(server).origin}/*`;
}
