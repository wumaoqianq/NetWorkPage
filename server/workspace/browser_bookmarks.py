"""只读取书签树白名单字段；忽略浏览器 Profile 中的登录态或其他资料。"""
import json
from workspace.bookmarks import parse_bookmarks
from workspace.http import ApiError
from workspace.validation import safe_url

SOURCES = {'chrome', 'edge', 'ego-lite', 'firefox', 'safari', 'other'}


def chromium_bookmarks(content):
    if isinstance(content, str):
        try:
            content = json.loads(content.lstrip('\ufeff'))
        except (ValueError, RecursionError):
            raise ApiError('Bookmarks JSON 格式不正确')
    roots = content.get('roots') if isinstance(content, dict) else None
    if not isinstance(roots, dict) or not roots or len(roots) > 100:
        raise ApiError('请选择含 roots 书签树的 Bookmarks 文件，不要上传完整浏览器备份')
    stack = [(node, [], 0) for node in reversed(list(roots.values()))]
    sites, visited = [], 0
    # 显式栈避免递归深度异常；节点、层级与网址数分别限额，适配低内存服务器。
    while stack:
        node, path, depth = stack.pop()
        visited += 1
        if visited > 5000 or depth > 64 or not isinstance(node, dict):
            raise ApiError('书签树过大、层级过深或结构不正确')
        if node.get('type') == 'url':
            if len(sites) >= 500:
                raise ApiError('一次最多导入 500 条网站，请分批导入')
            url = node.get('url')
            name = node.get('name') or url
            if not isinstance(url, str) or not isinstance(name, str):
                raise ApiError('书签名称或网址格式不正确')
            sites.append({'name': name[:100], 'notes': ('导入文件夹：' + ' / '.join(path))[:10000] if path else '',
                          'endpoints': [{'url': url}], 'inbox': True})
        elif node.get('type') == 'folder':
            children, name = node.get('children', []), node.get('name', '')
            if not isinstance(children, list) or len(children) > 5000 or not isinstance(name, str):
                raise ApiError('书签文件夹格式不正确')
            next_path = path + [name[:100]] if name else path
            stack.extend((child, next_path, depth + 1) for child in reversed(children))
        else:
            raise ApiError('Bookmarks 中包含不支持的节点类型')
    return sites


def browser_content(content, format_name):
    sites = chromium_bookmarks(content) if format_name == 'chromium' else parse_bookmarks(content)
    accepted, skipped = [], 0
    for site in sites:
        try:
            safe_url(site['endpoints'][0]['url'])
        except ApiError:
            skipped += 1
            continue
        # 浏览器的长标题保留前 100 字；原路径保留为私人备注，导入后进入收件箱。
        accepted.append({**site, 'name': site['name'][:100]})
    return {'sites': accepted, 'collections': [], 'categories': [], 'skippedUnsupported': skipped}
