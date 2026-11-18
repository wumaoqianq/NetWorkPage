import { writeFileSync } from 'node:fs';
import { siGithub, siNotion, siPhotopea, siFigma } from 'simple-icons';

// 直接保存图标库提供的品牌源文件，不用手工绘制或内联近似品牌图形。
for (const [name, icon, color] of [['github', siGithub, '#111111'], ['notion', siNotion, '#111111'], ['photopea', siPhotopea, '#18a497'], ['figma', siFigma, '#7b61ff']]) {
  writeFileSync(`public/assets/${name}.svg`, icon.svg.replace('<svg ', `<svg fill="${color}" `));
}
