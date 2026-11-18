import { $ } from './ui.js';

export function renderOptions(options, cachedAt) {
  const category = $('#category');
  const selected = category.value || category.dataset.selected || '';
  if (!options) {
    $('#options-cache').textContent = '分类暂时无法刷新，已保留当前选择；可使用未分类收藏。';
    return '';
  }
  const names = options.categories || [];
  category.replaceChildren(new Option('未分类', ''));
  for (const name of names) category.add(new Option(name, name));
  const missing = selected && !names.includes(selected) ? selected : '';
  if (missing) category.add(new Option(`${selected}（已删除）`, selected));
  category.value = selected;
  delete category.dataset.selected;
  const collections = $('#collections');
  let restored = [];
  try { restored = JSON.parse(collections.dataset.selected || '[]'); } catch { restored = []; }
  const checked = new Set([...restored, ...collections.querySelectorAll('input:checked')].map(input => input.value ?? input));
  collections.replaceChildren();
  for (const item of options.collections || []) {
    const label = document.createElement('label'); label.className = 'check';
    const input = document.createElement('input'); input.type = 'checkbox'; input.value = item.id;
    input.checked = checked.has(item.id);
    label.append(input, document.createTextNode(item.name)); collections.append(label);
  }
  $('#options-cache').textContent = `${cachedAt ? '离线分类缓存' : '当前账号分类'}${cachedAt ? ` · ${new Date(cachedAt).toLocaleString('zh-CN')}` : ''}`;
  return missing;
}

export function collectForm() {
  return { title: $('#title').value, url: $('#url').value, description: $('#description').value,
    descriptionSource: $('#description').dataset.source || 'manual', purpose: $('#purpose').value,
    notes: $('#notes').value, category: $('#category').value,
    tags: $('#tags').value.split(/[,，]/).map(value => value.trim()).filter(Boolean).slice(0, 30),
    collectionIds: [...$('#collections').querySelectorAll('input:checked')].map(input => input.value),
    pinned: $('#pinned').checked, later: $('#later').checked, range: $('#scope').value,
    scope: $('#access-scope').value };
}

export function fillForm(value) {
  for (const key of ['title', 'url', 'description', 'purpose', 'notes', 'category', 'tags']) {
    if (value[key] == null) continue;
    $(`#${key}`).value = Array.isArray(value[key]) ? value[key].join('，') : value[key];
  }
  $('#description').dataset.source = value.descriptionSource || 'manual';
  $('#description-source').textContent = `来源：${value.descriptionSource === 'page_meta' ? '页面描述' : '手动填写'}`;
  if (value.category) $('#category').dataset.selected = value.category;
  $('#collections').dataset.selected = JSON.stringify(value.collectionIds || []);
  $('#scope').value = value.range || (['page', 'home'].includes(value.scope) ? value.scope : 'page');
  $('#access-scope').value = ['公网', '局域网', '本机', '需 VPN'].includes(value.scope) ? value.scope : '公网';
  $('#pinned').checked = value.pinned === true; $('#later').checked = value.later === true;
  for (const input of $('#collections').querySelectorAll('input')) input.checked = (value.collectionIds || []).includes(input.value);
}

export function selectedUpdates() {
  return [...$('#update-fields').querySelectorAll('input:checked')].map(input => input.value);
}
