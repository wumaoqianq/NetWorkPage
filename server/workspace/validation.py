"""DTO 白名单校验；嵌套入口与账号只存放在其所属 Site 内。"""
import uuid
import json
import re
from urllib.parse import urlsplit, urlunsplit
from django.utils import timezone
from workspace.http import ApiError
from workspace.models import Category, Collection


def text(value, limit=2000, required=False):
    if not isinstance(value, str) or len(value) > limit or '\x00' in value:
        raise ApiError('文字格式不正确或超出长度限制')
    value = value.strip()
    if required and not value:
        raise ApiError('必填内容不能为空')
    return value


def password_value(value):
    # 密码属于不透明凭据，不能像普通表单文本一样自动去掉首尾空格。
    if not isinstance(value, str) or not 1 <= len(value) <= 1024 or '\x00' in value:
        raise ApiError('密码格式不正确')
    return value


def safe_url(value):
    value = text(value, 2048, True)
    if any(ord(char) <= 32 or ord(char) == 127 for char in value) or '\\' in value:
        raise ApiError('网址包含无效字符')
    try:
        parts = urlsplit(value)
        if parts.scheme.lower() not in ('http', 'https') or not parts.hostname or parts.username is not None or parts.password is not None:
            raise ValueError()
        port = parts.port
        host = parts.hostname.encode('idna').decode('ascii').lower()
        if ':' in host:
            host = '[' + host + ']'
        netloc = host + (':' + str(port) if port and (parts.scheme.lower(), port) not in [('http', 80), ('https', 443)] else '')
        return urlunsplit((parts.scheme.lower(), netloc, parts.path or '/', parts.query, parts.fragment))
    except (ValueError, UnicodeError):
        raise ApiError('请填写 HTTP(S) 网址，且不要包含用户名或密码')


def string_list(value, maximum=30, limit=100):
    if not isinstance(value, list) or len(value) > maximum:
        raise ApiError('列表格式不正确或项目过多')
    return list(dict.fromkeys(text(item, limit, True) for item in value))


def description_text(value):
    value = text(value, 500)
    return re.sub(r'\s+', ' ', ''.join(char for char in value if ord(char) >= 32 and ord(char) != 127)).strip()


def normalized_site(data, user, previous=None, check_relations=True, description_source='manual'):
    if not isinstance(data, dict):
        raise ApiError('网站资料必须是对象')
    result = dict(previous or {})
    for key, limit in [('name', 100), ('purpose', 1000), ('notes', 10000), ('category', 100), ('icon', 80)]:
        if key in data or not previous:
            result[key] = text(data.get(key, 'generic' if key == 'icon' else ''), limit, key == 'name')
    if 'description' in data or not previous:
        result['description'] = description_text(data.get('description', ''))
        result['descriptionSource'] = description_source if result['description'] else 'none'
        result['descriptionUpdatedAt'] = timezone.now().isoformat()
    if 'homepageUrl' in data or not previous:
        result['homepageUrl'] = safe_url(data['homepageUrl']) if data.get('homepageUrl') else ''
    for key in ('pinned', 'inbox', 'archived', 'deleted'):
        value = data.get(key, result.get(key, False))
        if not isinstance(value, bool):
            raise ApiError('状态字段必须是布尔值')
        result[key] = value
    result['kind'] = data.get('kind', result.get('kind', 'external'))
    if result['kind'] not in ('external', 'selfhosted'):
        raise ApiError('网站类型不正确')
    for key in ('tags', 'aliases', 'collections'):
        result[key] = string_list(data.get(key, result.get(key, [])))
    if check_relations:
        if result['collections'] and Collection.objects.filter(owner=user, pk__in=result['collections']).count() != len(result['collections']):
            raise ApiError('工作集不存在或不属于当前账号')
        if result['category'] and not Category.objects.filter(owner=user, name=result['category']).exists():
            raise ApiError('分类不存在或不属于当前账号')
    entries = data.get('endpoints', result.get('endpoints', []))
    if not isinstance(entries, list) or not 1 <= len(entries) <= 20:
        raise ApiError('每个网站需要 1 至 20 个入口')
    endpoints = []
    for entry in entries:
        if not isinstance(entry, dict):
            raise ApiError('入口格式不正确')
        endpoints.append({'id': text(entry.get('id', str(uuid.uuid4())), 100, True),
            'label': text(entry.get('label', '默认入口'), 100), 'url': safe_url(entry.get('url', '')),
            'scope': text(entry.get('scope', '公网'), 100)})
    if len({e['id'] for e in endpoints}) != len(endpoints) or len({e['url'] for e in endpoints}) != len(endpoints):
        raise ApiError('入口编号或网址不能重复')
    result['endpoints'] = endpoints
    result['defaultEndpointId'] = data.get('defaultEndpointId', result.get('defaultEndpointId', endpoints[0]['id']))
    if result['defaultEndpointId'] not in {e['id'] for e in endpoints}:
        if 'defaultEndpointId' in data:
            raise ApiError('默认入口不存在')
        result['defaultEndpointId'] = endpoints[0]['id']
    accounts = data.get('accounts', result.get('accounts', []))
    if not isinstance(accounts, list) or len(accounts) > 20:
        raise ApiError('账号说明格式不正确或项目过多')
    result['accounts'] = []
    for account in accounts:
        if not isinstance(account, dict) or set(account) - {'label', 'username', 'method', 'notes', 'endpointId', 'loginUrl'}:
            raise ApiError('账号说明不能包含密码、密钥或未支持字段')
        item = {key: text(account.get(key, ''), 2000) for key in ('label', 'username', 'method', 'notes')}
        if account.get('endpointId'):
            if account['endpointId'] not in {e['id'] for e in endpoints}:
                raise ApiError('账号说明关联的入口不存在')
            item['endpointId'] = account['endpointId']
        if account.get('loginUrl'):
            item['loginUrl'] = safe_url(account['loginUrl'])
        result['accounts'].append(item)
    # 单字段均合规时仍可能累积成巨大 JSON；先限制整条资料再写入数据库。
    if len(json.dumps(result, ensure_ascii=False).encode('utf-8')) > 65536:
        raise ApiError('单个网站的全部资料不能超过 64KiB，请缩短账号说明或备注', 'site_payload_limit')
    return result
