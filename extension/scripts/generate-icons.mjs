import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// 将官方 Phosphor BookmarkSimple fill 定义栅格化，不手绘品牌图标。
const root = resolve(import.meta.dirname, '..');
const sourceRoot = resolve(root, '../prototype/node_modules/@phosphor-icons/react');
const runtimeRoot = process.argv[2];
if (!runtimeRoot) throw new Error('请传入含 sharp 的 node_modules 绝对路径。');
const require = createRequire(resolve(runtimeRoot, '../package.json'));
const sharp = require(resolve(runtimeRoot, 'sharp'));
const definition = await readFile(resolve(sourceRoot, 'dist/defs/BookmarkSimple.es.js'), 'utf8');
const path = definition.match(/"fill",[\s\S]*?d: "([^"]+)"/)?.[1];
if (!path) throw new Error('未找到官方图标路径。');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><rect width="256" height="256" rx="50" fill="#087e63"/><g transform="translate(40 36) scale(.69)" fill="white"><path d="${path}"/></g></svg>`;
for (const size of [16, 32, 48, 128]) {
  await sharp(Buffer.from(svg)).resize(size, size).png().toFile(resolve(root, `icons/icon-${size}.png`));
}
await writeFile(resolve(root, 'icons/PHOSPHOR-LICENSE.txt'), await readFile(resolve(sourceRoot, 'LICENSE')));
console.log('Generated official Phosphor icons: 16, 32, 48, 128 px.');
