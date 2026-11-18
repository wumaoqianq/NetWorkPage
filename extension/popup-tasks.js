import { buildIconCandidates } from './icon-format.js';
/** popup 的图标任务展示：把“获取中/跨源兜底/不支持/已补齐”翻译成准确文案。 */
export async function loadIconTaskStatus({ connection, captureId, store }) {
  if (!connection) return { iconTask: null, iconNotice: null, pendingIconTasks: 0 };
  const server = connection.server, userId = String(connection.user?.id || '');
  const iconTask = await store.get(server, userId, captureId).catch(() => null);
  const iconNotice = await store.takeNotice(server, userId).catch(() => null);
  const pendingIconTasks = await store.pendingCount(server, userId).catch(() => 0);
  return { iconTask, iconNotice, pendingIconTasks };
}

export function iconAssetText(icon) {
  if (icon?.status === 'ready') return '网站图标已就绪';
  if (icon?.code === 'icon_cross_origin') {
    const hosts = (icon.diagnostics?.crossOriginHosts || []).join('、') || '页面声明域名';
    return `图标位于公共 CDN（${hosts}），收藏后由工作台安全兜底获取`;
  }
  if (icon?.code === 'icon_svg_only') return '该站仅提供 SVG 图标，暂不支持安全获取；收藏后可在卡片菜单重试';
  if (icon?.code === 'icon_no_candidates') return '页面未声明可用图标，收藏后会尝试默认路径';
  return `图标暂不可用，收藏后会自动重试：${icon?.reason || '正在准备'}`;
}

/** 保存同源栅格候选，供 service worker 在 popup 关闭后继续在页面上下文获取。 */
export async function collectClientCandidates({ tab, readPageMetadata }) {
  try {
    const metadata = await readPageMetadata(tab.id);
    return buildIconCandidates({ pageUrl: tab.url, favIconUrl: tab.favIconUrl || '',
      iconLinks: metadata.iconLinks || metadata.icons || [] })
      .filter(candidate => !candidate.crossOrigin && !candidate.data && candidate.format !== 'svg')
      .slice(0, 4).map(candidate => candidate.url);
  } catch { return []; }
}

export async function runBackgroundAssetAttach({ waitForAssets, waitForIcon = null, persistAutomaticAssets, store, connection, captureId,
  assets, savedUrl, includePreview, includeIcon, send, iconTaskStore, iconTask, onError = () => {} }) {
  try {
    await waitForAssets();
    const stored = await persistAutomaticAssets({ store, connection, captureId, assets, savedUrl, includePreview, includeIcon });
    let task = iconTask;
    if (stored.iconAttachment && task) task = await iconTaskStore.update(task, { state: 'ready_to_upload' });
    if (stored.attachment || stored.iconAttachment) {
      await send({ type: 'attach', captureId, savedUrl, attachment: stored.attachment, iconAttachment: stored.iconAttachment });
    }
    // popup 仍打开时再给图标一次短窗口；关闭后由持久化任务兜底，不阻塞文字。
    if (includeIcon && !stored.iconAttachment && waitForIcon) {
      const late = await waitForIcon();
      if (late?.status === 'ready') {
        const iconOnly = await persistAutomaticAssets({ store, connection, captureId, assets: { icon: late },
          savedUrl, includePreview: false, includeIcon: true });
        if (iconOnly.iconAttachment) {
          if (task) task = await iconTaskStore.update(task, { state: 'ready_to_upload' });
          await send({ type: 'attach', captureId, savedUrl, iconAttachment: iconOnly.iconAttachment });
        }
      }
    }
    if (stored.errors.length) onError(stored.errors.join('；'));
    return { stored, iconTask: task };
  } catch (error) {
    onError(`素材稍后重试：${error.message}`);
    return null;
  }
}

export function iconTaskText(task, result) {
  if (!task) return result?.previewPending || result?.iconPending ? '素材同步中' : '资料和可用素材已确认';
  if (task.state === 'complete') return '图标已补齐';
  if (task.state === 'unsupported') return `图标暂不可用：${task.reason || '格式或站点类型不支持自动获取'}`;
  if (task.state === 'retryable_failure') return `图标获取中，稍后自动重试（${task.reason || '暂时失败'}）`;
  if (task.state === 'cancelled') return '图标未更新（按你的选择保留原资料）';
  return '图标获取中，稍后自动补齐；关闭此窗口也会继续';
}
