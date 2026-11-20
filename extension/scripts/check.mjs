import { readdir, readFile, access } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const manifest = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'));
assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.background.type, 'module');
assert.deepEqual(manifest.permissions, ['activeTab', 'storage', 'alarms', 'scripting']);
assert.deepEqual(manifest.optional_permissions, ['bookmarks']);
assert.equal(manifest.host_permissions, undefined);
assert.deepEqual(manifest.content_scripts, [{
  matches: ['https://wumaoqian.top/*', 'https://www.wumaoqian.top/*', 'http://127.0.0.1/*', 'http://localhost/*'],
  js: ['workspace-presence.js'], run_at: 'document_start',
}]);
await access(resolve(root, 'workspace-presence.js'));
assert.equal(manifest.externally_connectable, undefined);
const popupSource = await readFile(resolve(root, 'popup.js'), 'utf8');
assert.match(popupSource, new RegExp(`const BUILD_VERSION = '${manifest.version.replaceAll('.', '\\.')}'`),
  'popup.js 构建版本必须与 manifest.json 一致');
for (const file of ['popup.html', 'options.html', 'bookmarks.html', 'capture.html', manifest.background.service_worker]) {
  await access(resolve(root, file));
}
for (const size of [16, 32, 48, 128]) {
  const data = await readFile(resolve(root, `icons/icon-${size}.png`));
  assert.equal(data.readUInt32BE(16), size);
  assert.equal(data.readUInt32BE(20), size);
}
let count = 0;
async function check(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) { assert.notEqual(entry.name, 'node_modules'); await check(path); continue; }
    if (!/\.(m?js|css|html)$/.test(entry.name)) continue;
    const text = await readFile(path, 'utf8');
    assert.ok(text.split('\n').length <= 300, `${path} 超过 300 行`);
    if (/\.m?js$/.test(entry.name)) execFileSync(process.execPath, ['--check', path]);
    if (/\.html$/.test(entry.name)) {
      assert.equal(/<script(?![^>]*\bsrc=)[^>]*>/i.test(text), false, '禁止 inline script');
      for (const [, asset] of text.matchAll(/(?:src|href)="([^"#]+)"/g)) {
        await access(resolve(root, asset));
      }
    }
    count++;
  }
}
await check(root);
console.log(`Manifest、HTML 资源、4 个 PNG 尺寸、${count} 个源码文件语法与 300 行约束通过；无 node_modules。`);
