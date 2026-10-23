"""Local briefing console. This preview never invokes Git or the daily scheduler."""

import json
import os
import re
import secrets
import tempfile
import threading
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WRITE_LOCK = threading.RLock()


def default_config():
    # New installations start optional and have no discipline-specific interests.
    return {
        'version': 1,
        'revision': 0,
        'display': {'enabled': False, 'title': '每日选刊', 'subtitle': '为兴趣留一点时间',
                    'archiveDays': 90, 'carouselDays': 7, 'autoPlay': True,
                    'intervalSeconds': 8, 'showCovers': True, 'showTerraNotes': False},
        'selection': {'topics': [], 'excludedKeywords': [], 'preferredSources': [],
                      'language': 'zh-CN', 'maxItems': 6},
        'channels': [{'id': 'news', 'name': '动态精选', 'enabled': True},
                     {'id': 'reading', 'name': '深度阅读', 'enabled': True}],
        'agent': {'enabled': False, 'publishMode': 'review', 'preferredTime': '09:00'},
    }


def validate_config(value):
    if not isinstance(value, dict):
        raise ValueError('配置必须是一个对象')
    if value.get('version') != 1:
        raise ValueError('不支持此配置版本')
    result = default_config()
    for key in ('display', 'selection', 'agent'):
        if not isinstance(value.get(key), dict):
            raise ValueError('缺少配置项：' + key)
        result[key].update({k: v for k, v in value[key].items() if k in result[key]})
    display = result['display']
    for key in ('enabled', 'autoPlay', 'showCovers', 'showTerraNotes'):
        if type(display[key]) is not bool:
            raise ValueError('开关值无效：' + key)
    for key, low, high in (('archiveDays', 1, 90), ('carouselDays', 1, 14), ('intervalSeconds', 5, 60)):
        if type(display[key]) is not int or not low <= display[key] <= high:
            raise ValueError('数值超出范围：' + key)
    if display['carouselDays'] > display['archiveDays']:
        raise ValueError('轮播范围不能大于往期展示范围')
    for key, maximum in (('title', 40), ('subtitle', 100)):
        if not isinstance(display[key], str) or not display[key].strip() or len(display[key]) > maximum:
            raise ValueError('请填写有效的板块名称和简介')
        display[key] = display[key].strip()
    selection = result['selection']
    for key in ('topics', 'excludedKeywords', 'preferredSources'):
        items = selection[key]
        if not isinstance(items, list) or len(items) > 40 or any(not isinstance(x, str) or not x.strip() or len(x) > 200 for x in items):
            raise ValueError('选题列表格式无效：' + key)
        selection[key] = list(dict.fromkeys(x.strip() for x in items))
    if selection['language'] not in ('zh-CN', 'en-US', 'ja-JP'):
        raise ValueError('摘要语言无效')
    if type(selection['maxItems']) is not int or not 1 <= selection['maxItems'] <= 20:
        raise ValueError('每期条目数应在 1–20 之间')
    channels = value.get('channels')
    if not isinstance(channels, list) or not 1 <= len(channels) <= 6:
        raise ValueError('栏目数量应在 1–6 之间')
    clean_channels = []
    for channel in channels:
        if not isinstance(channel, dict) or not re.fullmatch(r'[a-z][a-z0-9-]{0,31}', channel.get('id', '')):
            raise ValueError('栏目标识只能使用小写字母、数字和短横线')
        if not isinstance(channel.get('name'), str) or not 1 <= len(channel['name'].strip()) <= 24 or type(channel.get('enabled')) is not bool:
            raise ValueError('栏目名称或开关无效')
        clean_channels.append({'id': channel['id'], 'name': channel['name'].strip(), 'enabled': channel['enabled']})
    if len({x['id'] for x in clean_channels}) != len(clean_channels) or not any(x['enabled'] for x in clean_channels):
        raise ValueError('栏目标识不能重复，并且至少保留一个启用栏目')
    result['channels'] = clean_channels
    agent = result['agent']
    if type(agent['enabled']) is not bool:
        raise ValueError('Agent 接收开关无效')
    if agent['publishMode'] not in ('review', 'auto') or not re.fullmatch(r'(?:[01]\d|2[0-3]):[0-5]\d', agent['preferredTime']):
        raise ValueError('审核方式或期望更新时间无效')
    revision = value.get('revision')
    if type(revision) is not int or revision < 0:
        raise ValueError('配置版本无效，请重新读取')
    result['revision'] = revision
    return result


def public_config(config):
    return {'display': config['display'], 'topics': config['selection']['topics'], 'channels': config['channels']}


def atomic_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    handle, temporary = tempfile.mkstemp(prefix='.briefing-', suffix='.tmp', dir=str(path.parent))
    try:
        with os.fdopen(handle, 'w', encoding='utf-8') as stream:
            json.dump(value, stream, ensure_ascii=False, indent=2)
            stream.write('\n')
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


class BriefingStore:
    def __init__(self, root, site):
        self.root = Path(root).resolve()
        self.site = Path(site).resolve()
        self.config_path = self.root / 'config.json'
        if not (self.site / 'data/dailyBriefing.json').is_file():
            raise ValueError('未配置有效的网站预览副本')

    def read(self):
        if not self.config_path.is_file():
            value = default_config()
            public_path = self.site / 'data/briefingConfig.json'
            if public_path.is_file():
                public = json.loads(public_path.read_text(encoding='utf-8'))
                value['display'].update(public.get('display', {}))
                value['selection']['topics'] = public.get('topics', [])
                value['channels'] = public.get('channels', value['channels'])
            return validate_config(value)
        return validate_config(json.loads(self.config_path.read_text(encoding='utf-8')))

    def save(self, incoming):
        validated = validate_config(incoming)
        with WRITE_LOCK:
            current = self.read()
            if incoming['revision'] != current['revision']:
                raise RuntimeError('配置已被其他窗口修改，请重新读取后再保存')
            validated['revision'] += 1
            # The private config remains canonical if a write is interrupted.
            atomic_json(self.root / 'previous-config.json', current)
            try:
                atomic_json(self.site / 'data/briefingConfig.json', public_config(validated))
                atomic_json(self.config_path, validated)
            except OSError:
                atomic_json(self.site / 'data/briefingConfig.json', public_config(current))
                raise
        return validated

    def issues(self):
        latest = json.loads((self.site / 'data/dailyBriefing.json').read_text(encoding='utf-8'))
        archive = json.loads((self.site / 'data/dailyBriefingArchive.json').read_text(encoding='utf-8'))
        by_date = {}
        for issue in [latest] + archive.get('issues', []):
            if issue.get('items'):
                by_date.setdefault(issue['edition']['date'], issue)
        return [by_date[key] for key in sorted(by_date, reverse=True)]


def create_app(store, admin_token):
    from cms_core.briefing_content import ContentStore
    from cms_core.briefing_routes import install_routes
    app = FastAPI(title='每日选刊本机服务', docs_url=None, redoc_url=None)
    content = ContentStore(store, atomic_json, WRITE_LOCK)

    @app.middleware('http')
    async def local_only(request: Request, call_next):
        if request.url.path.startswith('/api/briefing-agent/'):
            from fastapi.responses import JSONResponse
            try:
                authorization = request.headers.get('authorization', '')
                if not authorization.startswith('Bearer '):
                    raise PermissionError('需要独立的 Agent 授权')
                request.state.agent = content.authenticate(authorization[7:])
            except PermissionError as exc:
                return JSONResponse({'detail': str(exc)}, status_code=401)
            return await call_next(request)
        if request.headers.get('x-briefing-admin') != admin_token:
            from fastapi.responses import JSONResponse
            return JSONResponse({'detail': '需要本机控制台授权'}, status_code=401)
        return await call_next(request)

    @app.get('/api/briefing/connection-info')
    def connection_info(request: Request):
        return {'baseUrl': str(request.base_url).rstrip('/')}

    @app.get('/api/briefing/settings')
    def settings():
        return {'config': store.read(), 'previewOnly': True}

    @app.put('/api/briefing/settings')
    async def save_settings(request: Request):
        try:
            if len(await request.body()) > 64000:
                raise ValueError('配置过大')
            return {'config': store.save(await request.json()), 'previewOnly': True}
        except RuntimeError as exc:
            raise HTTPException(409, str(exc))
        except (ValueError, TypeError) as exc:
            raise HTTPException(422, str(exc))
        except OSError:
            raise HTTPException(503, '保存未完成，请检查本机目录是否可写后重试')

    @app.get('/api/briefing/issues')
    def issues():
        return {'issues': store.issues()}

    @app.get('/api/briefing/status')
    def status():
        issues = store.issues()
        return {'localService': True, 'agentConnected': any(agent['active'] and agent['lastSeen'] for agent in content.agents()), 'schedulerChanged': False,
                'previewOnly': True, 'latestDate': issues[0]['edition']['date'] if issues else None,
                'issueCount': len(issues), 'sitePreview': os.environ.get('XHS_BRIEFING_PREVIEW_URL', ''),
                'draftCount': sum(draft['status'] == 'draft' for draft in content.read()['drafts'])}

    install_routes(app, content)
    return app


def main():
    import uvicorn
    site = os.environ.get('XHS_BRIEFING_SITE_ROOT')
    if not site:
        raise RuntimeError('必须显式指定 XHS_BRIEFING_SITE_ROOT，避免修改其他开发目录')
    root = PROJECT_ROOT / 'manager_data/briefing'
    root.mkdir(parents=True, exist_ok=True)
    token_path = root / '.admin-token'
    if not token_path.exists():
        token_path.write_text(secrets.token_urlsafe(32), encoding='utf-8')
    store = BriefingStore(root, site)
    uvicorn.run(create_app(store, token_path.read_text(encoding='utf-8').strip()), host='127.0.0.1', port=8873)


if __name__ == '__main__':
    main()
