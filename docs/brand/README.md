# 网站工作台 Logo

2026-11-16，项目原创 SVG 设计，已接入工作台、分享/登录页和扩展 1.3.0。

概念：多张网站卡片收拢成一枚书签，表达“替用户收好网站”；不再使用面向程序员的花括号。保持绿色体系，符号可独立用于插件工具栏与浏览器标签。

- `workspace-mark.svg`：主标志，绿色圆角底，64×64 坐标系。
- `workspace-mark-mono.svg`：单色线条版，用于浅色背景或印刷；反白版可统一改为白色。
- `workspace-logo.svg`：横向展示版，名称沿用“网站工作台”，没有擅自改产品名称。

接入规范：应用侧栏 32px、登录页 40px、插件头部 32px；图形四周至少保留其宽度 1/8 的净空。不要在绿底标志上额外叠加阴影/渐变。favicon 使用独立标志，插件从矢量输出 16/32/48/128px PNG。16px 时可省略卡片上的两条短线，以保证辨认。

横版文字使用系统中文字体，跨机器显示可能略有区别；正式印刷或跨平台定稿时应将合法授权字体的文字转为轮廓。符号不依赖字体、无外链资源。不得声称已完成商标检索或注册。

## 开发接入与可复现 PNG

- 网页 SVG 位于 `prototype/public/assets/`，侧栏、登录/初始化、连接状态、分享页和 favicon 均使用 `workspace-mark.svg`；横版与单色源保留供后续场景使用。
- 扩展 popup/options 和 manifest 使用同一标志。`scripts/generate_brand_assets.py` 调用开发机 Chrome/Edge 将 `workspace-mark.svg` 渲染为 16/32/48/128 PNG，不要求生产服务器安装浏览器。
- 重新生成：`.venv/Scripts/python.exe scripts/generate_brand_assets.py`；也可用 `--browser` 指定浏览器。脚本校验 PNG 尺寸，生成后应读取图片复核。
