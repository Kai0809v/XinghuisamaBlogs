import base64
import hashlib
import json
import os
import tempfile
from fastapi import Request
from fastapi.responses import JSONResponse
from cms_core.briefing_content import ConflictError


async def body(request, maximum=256000):
    raw = await request.body()
    if len(raw) > maximum:
        raise ValueError('提交内容过大')
    value = json.loads(raw)
    if not isinstance(value, dict):
        raise ValueError('提交内容必须是一个对象')
    return value


def install_routes(app, content):
    @app.exception_handler(ConflictError)
    async def conflict(request, error):
        return JSONResponse({'detail': str(error)}, status_code=409)

    @app.exception_handler(ValueError)
    async def invalid(request, error):
        return JSONResponse({'detail': str(error)}, status_code=422)

    @app.exception_handler(KeyError)
    async def missing(request, error):
        return JSONResponse({'detail': str(error.args[0])}, status_code=404)

    @app.exception_handler(PermissionError)
    async def denied(request, error):
        return JSONResponse({'detail': str(error)}, status_code=403)

    @app.exception_handler(OSError)
    async def disk_error(request, error):
        return JSONResponse({'detail': '本地文件操作未完成，请检查目录权限后重试'}, status_code=503)

    @app.get('/api/briefing/drafts')
    def drafts():
        return {'drafts': content.read()['drafts']}

    @app.post('/api/briefing/drafts')
    async def create_draft(request: Request):
        value = await body(request)
        return {'draft': content.create(value.get('issue'), cover=value.get('cover'))}

    @app.post('/api/briefing/issues/{date}/draft')
    def edit_issue(date: str):
        return {'draft': content.edit_published(date)}

    @app.put('/api/briefing/drafts/{draft_id}')
    async def update_draft(draft_id: str, request: Request):
        value = await body(request)
        return {'draft': content.update(draft_id, value.get('revision'), value.get('issue'), value.get('cover'))}

    @app.post('/api/briefing/drafts/{draft_id}/publish')
    async def publish_draft(draft_id: str, request: Request):
        value = await body(request)
        return {'draft': content.publish(draft_id, value.get('revision'), value.get('reviewed'))}

    @app.post('/api/briefing/drafts/{draft_id}/withdraw')
    async def withdraw_draft(draft_id: str, request: Request):
        value = await body(request)
        return {'draft': content.withdraw(draft_id, value.get('revision'))}

    @app.get('/api/briefing/events')
    def events():
        return {'events': content.read()['events']}

    @app.get('/api/briefing/agents')
    def agents():
        return {'agents': content.agents()}

    @app.post('/api/briefing/agents')
    async def create_agent(request: Request):
        value = await body(request)
        return content.create_agent(value.get('name'))

    @app.post('/api/briefing/agents/{agent_id}/revoke')
    def revoke_agent(agent_id: str):
        content.revoke(agent_id)
        return {'revoked': True}

    @app.get('/api/briefing/assets')
    def assets():
        root = content.site / 'public'
        paths = sorted((root / 'images/daily-briefing').glob('*'))
        return {'assets': [{'src': '/' + path.relative_to(root).as_posix(), 'name': path.name} for path in paths if path.suffix.lower() in ('.webp', '.jpg', '.jpeg', '.png')][:300]}

    @app.post('/api/briefing/covers')
    async def upload_cover(request: Request):
        value = await body(request, 4300000)
        try:
            image = base64.b64decode(value.get('data', ''), validate=True)
        except (ValueError, TypeError):
            raise ValueError('图片编码无效')
        if not 16 <= len(image) <= 3000000:
            raise ValueError('封面大小需小于 3 MB')
        if image.startswith(b'\x89PNG\r\n\x1a\n'):
            extension = '.png'
        elif image.startswith(b'\xff\xd8\xff'):
            extension = '.jpg'
        elif image[:4] == b'RIFF' and image[8:12] == b'WEBP':
            extension = '.webp'
        else:
            raise ValueError('封面只接受 PNG、JPEG 或 WebP 图片')
        name = 'console-' + hashlib.sha256(image).hexdigest()[:24] + extension
        target = content.site / 'public/images/daily-briefing' / name
        target.parent.mkdir(parents=True, exist_ok=True)
        if not target.exists() or hashlib.sha256(target.read_bytes()).digest() != hashlib.sha256(image).digest():
            handle, temporary = tempfile.mkstemp(prefix='.cover-', suffix='.tmp', dir=target.parent)
            try:
                with os.fdopen(handle, 'wb') as stream:
                    stream.write(image)
                os.replace(temporary, target)
            finally:
                if os.path.exists(temporary):
                    os.unlink(temporary)
        return {'cover': {'src': '/images/daily-briefing/' + name, 'alt': '', 'model': 'user-upload'}}

    @app.get('/api/briefing-agent/v1/config')
    def agent_config():
        config = content.settings.read()
        return {'version': 1, 'revision': config['revision'], 'selection': config['selection'],
                'channels': config['channels'], 'publishMode': config['agent']['publishMode'],
                'scope': 'local-preview', 'submissionEndpoint': '/api/briefing-agent/v1/submissions'}

    @app.get('/api/briefing-agent/v1/history')
    def agent_history():
        return {'issues': content.settings.issues()[:14],
                'occupiedDates': sorted({draft['issue']['edition']['date'] for draft in content.read()['drafts']})}

    @app.post('/api/briefing-agent/v1/submissions')
    async def submit(request: Request):
        value = await body(request)
        try:
            return content.submit(request.state.agent, request.headers.get('idempotency-key'), value.get('issue'))
        except (ValueError, OSError) as exc:
            with content.lock:
                state = content.read()
                content.event(state, 'submission.failed', request.state.agent['name'], message=str(exc)[:200] if isinstance(exc, ValueError) else '本地保存失败')
                content.write(content.path, state)
            raise

    @app.get('/api/briefing-agent/v1/receipts/{receipt_id}')
    def receipt(receipt_id: str, request: Request):
        state = content.read()
        record = next((x for x in state['receipts'] if x['id'] == receipt_id and x['agentId'] == request.state.agent['id']), None)
        if record is None:
            raise KeyError('未找到本 Agent 的提交记录')
        draft = content.find(state, record['draftId'])
        return {'receiptId': record['id'], 'draftId': draft['id'], 'status': draft['status'], 'updatedAt': draft['updatedAt']}
