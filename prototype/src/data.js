export const categories = ['图片与视频', '开发工具', '办公协作'];
export const collections = [
  { id: 'publish', name: '开发与发布', description: '从代码、部署到发布，一次找到需要的工具。' },
  { id: 'design', name: '图片与素材', description: '修图、压缩和流程草图，集中在这里。' },
];

const endpoint = (url, label = '默认入口', scope = '公网') => ({ id: `${label}-${url}`, label, url, scope });
const account = (label, username, method, notes = '') => ({ label, username, method, notes });
export const initialSites = [
  {
    id: 'tinypng', name: 'TinyPNG', icon: 'tinypng', purpose: '压缩图片体积，适合网站上传前处理。',
    notes: '上次整理商品图片时用过。透明 PNG 先预览压缩效果。', aliases: ['图片瘦身', '压图'],
    tags: ['图片压缩', '图片处理'], category: '图片与视频', pinned: true, kind: 'external',
    endpoints: [endpoint('https://tinypng.com')], accounts: [account('日常使用', '', '无需登录')], collections: ['design', 'publish'],
  },
  {
    id: 'excalidraw', name: 'Excalidraw', icon: 'excalidraw', purpose: '快速画流程图和架构草图，记录想法更直观。',
    notes: '适合梳理产品结构，画完可以直接导出 PNG 或 SVG。', aliases: ['画图', '白板'],
    tags: ['流程图', '思维绘图'], category: '开发工具', pinned: true, kind: 'external',
    endpoints: [endpoint('https://excalidraw.com')], accounts: [account('个人使用', '', '无需登录')], collections: ['design', 'publish'],
  },
  {
    id: 'resources', name: '资源管理系统', icon: 'resources', purpose: '管理自己部署的网站与资源文件，统一查看和维护。',
    notes: '以下为示例入口。云端适合日常使用，本机保留开发环境。', aliases: ['资源库', '管理后台'],
    tags: ['自部署', '云端 · 本机'], category: '开发工具', pinned: true, kind: 'selfhosted',
    endpoints: [endpoint('https://resource.example.com', '云端正式版'), endpoint('http://192.168.1.10:8080', '家中服务器', '局域网'), endpoint('http://localhost:3000', '本机开发版', '本机')],
    accounts: [account('管理账号', 'admin@example.com', '邮箱密码', '示例账号；实际密码由独立密码管理器填充。')], collections: ['publish'],
  },
  {
    id: 'photopea', name: 'Photopea', icon: 'photopea', purpose: '在浏览器里编辑 PSD 和处理图片，无需安装软件。',
    notes: '临时修改设计文件、裁剪封面或调整图片尺寸。', tags: ['图片编辑', '在线工具'],
    category: '图片与视频', pinned: true, kind: 'external', endpoints: [endpoint('https://www.photopea.com')], accounts: [account('基础功能', '', '无需登录')], collections: ['design'],
  },
  {
    id: 'github', name: 'GitHub', icon: 'github', purpose: '查找开源项目，管理代码与版本，跟进技术动态。',
    notes: '个人项目与工作项目使用不同账号，打开后按实际仓库选择。', tags: ['代码托管', '开源社区'],
    category: '开发工具', pinned: true, kind: 'external', endpoints: [endpoint('https://github.com')],
    accounts: [account('个人账号', 'demo-personal', '用户名密码'), account('工作账号', 'demo-work', '统一身份登录')], collections: ['publish'],
  },
  {
    id: 'notion', name: 'Notion', icon: 'notion', purpose: '整理项目笔记和常用资料，构建个人知识库。',
    notes: '产品方案、读书笔记和每周计划集中放在个人工作区。', tags: ['知识管理', '笔记'],
    category: '办公协作', pinned: true, kind: 'external', endpoints: [endpoint('https://www.notion.so')],
    accounts: [account('个人工作区', 'demo@example.com', 'Google 登录')], collections: [],
  },
  {
    id: 'squoosh', name: 'Squoosh', icon: 'squoosh', purpose: '对比压缩前后的画质，将图片转换成 WebP。',
    notes: '刚收藏，还没有整理。', tags: ['格式转换'], category: '图片与视频', kind: 'external', inbox: true,
    endpoints: [endpoint('https://squoosh.app')], accounts: [], collections: ['design'],
  },
  {
    id: 'mdn', name: 'MDN Web Docs', icon: 'generic', purpose: '查询前端 API 和浏览器兼容性说明。',
    notes: '', tags: ['开发文档'], category: '开发工具', kind: 'external', inbox: true,
    endpoints: [endpoint('https://developer.mozilla.org/zh-CN/')], accounts: [], collections: ['publish'],
  },
  {
    id: 'figma', name: 'Figma', icon: 'figma', purpose: '协作设计界面，查看设计稿与组件。',
    notes: '', tags: ['界面设计'], category: '办公协作', kind: 'external', inbox: true,
    endpoints: [endpoint('https://www.figma.com')], accounts: [], collections: ['design'],
  },
];

export const viewMeta = {
  home: ['常用的网站，随时找回来', '记住用途，不必记住名字。', '工作台'],
  all: ['你的网站，都在这里', '按用途整理，按需要找到。', '全部网站'],
  deployments: ['自己的服务，一处直达', '云端、局域网与本机入口，清楚区分。', '我的部署'],
  inbox: ['先收藏，慢慢整理', '为新发现补一句用途，下次更容易找回来。', '收件箱'],
  collections: ['围绕任务，组合常用工具', '一个网站可以加入多个工作集，资料只维护一份。', '工作集'],
  archive: ['暂时收起，随时找回', '归档网站保留全部资料，可以恢复到网站库。', '归档网站'],
  trash: ['删除的网站，暂存在这里', '可以恢复；永久删除后无法撤销。', '回收站'],
};
