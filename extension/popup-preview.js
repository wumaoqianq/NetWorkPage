import { $ } from './ui.js';
import { captureUrl } from './queue.js';
import { captureVisible, deriveImage, homepageMatch } from './screenshot.js';

export class PreviewController {
  constructor({ tab, scope, homepage, notify, store }) {
    this.tab = tab; this.scope = scope; this.homepage = homepage; this.notify = notify; this.store = store;
    this.raw = null; this.derived = null; this.accepted = null; this.sequence = 0;
    $('#add-screenshot').addEventListener('click', () => this.capture());
    $('#retake-screenshot').addEventListener('click', () => this.capture());
    $('#remove-screenshot').addEventListener('click', () => this.reset());
    $('#use-screenshot').addEventListener('click', () => this.use());
    $('#crop-offset').addEventListener('input', () => this.derive());
  }
  supported() {
    try { captureUrl(this.tab?.url || ''); return !this.tab?.incognito; }
    catch { return false; }
  }
  reset() {
    this.sequence++; this.raw = this.derived = this.accepted = null;
    $('#screenshot-preview').hidden = true; $('#preview-status').textContent = '尚未添加';
    $('#homepage-confirm').checked = false;
  }
  async capture() {
    if (!this.supported()) return this.notify('此页面不支持截图。', true);
    if (this.scope() === 'home' && !homepageMatch(this.tab.url, this.homepage())) {
      return this.notify('请先打开指定首页，在新标签页再次点击扩展后截图。', true);
    }
    try {
      this.raw = await captureVisible(this.tab); this.accepted = null;
      $('#homepage-confirm-row').hidden = this.scope() !== 'home';
      $('#homepage-confirm').checked = false;
      await this.derive();
    } catch (error) { this.reset(); this.notify(error.message, true); }
  }
  async derive() {
    if (!this.raw) return;
    const sequence = ++this.sequence;
    try {
      const derived = await deriveImage(this.raw.blob, Number($('#crop-offset').value) / 100);
      if (sequence !== this.sequence) return;
      this.derived = derived; $('#screenshot-image').src = derived.url;
      $('#screenshot-source').textContent = `${this.raw.url} · ${new Date(this.raw.capturedAt).toLocaleString('zh-CN')} · ${this.scope() === 'home' ? '首页（待确认）' : '当前页截图'}`;
      $('#screenshot-preview').hidden = false; $('#preview-status').textContent = '等待确认';
    } catch (error) { this.notify(error.message, true); }
  }
  use() {
    if (!this.derived) return;
    if (this.scope() === 'home' && !$('#homepage-confirm').checked) {
      return this.notify('首页截图需要明确确认当前页面就是首页。', true);
    }
    this.accepted = { sourceUrl: this.raw.url, displayUrl: this.derived.url,
      blob: this.derived.blob, capturedAt: this.raw.capturedAt };
    $('#screenshot-preview').hidden = true;
    $('#preview-status').textContent = this.scope() === 'home' ? '已添加 · 首页（用户确认）' : '已添加 · 当前页截图';
    this.notify('截图已加入本次收藏，点击保存后才会持久化和上传。');
  }
  async persist(connection, captureId, savedUrl) {
    if (!this.accepted) return null;
    if (captureUrl(this.accepted.sourceUrl) !== captureUrl(savedUrl)) throw new Error('保存地址已在截图后变化，请重新截图。');
    const id = crypto.randomUUID();
    const record = { id, blob: this.accepted.blob, sourceUrl: this.accepted.sourceUrl,
      server: connection.server, userId: String(connection.user.id), captureId, createdAt: Date.now() };
    await this.store.put(record);
    return { id, bytes: record.blob.size, createdAt: record.createdAt, capturedAt: this.accepted.capturedAt,
      sourceEndpointId: '', sourceUrl: this.accepted.sourceUrl, homepageUrl: this.scope() === 'home' ? captureUrl(savedUrl) : '',
      pageKind: this.scope() === 'home' ? 'home' : 'current', userConfirmedHomepage: this.scope() === 'home' };
  }
}
