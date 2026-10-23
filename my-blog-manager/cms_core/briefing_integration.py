"""Share the existing CMS port, resolving the selected website without Git operations."""
import hashlib
import json
import os
import secrets
import threading
from pathlib import Path

from fastapi.responses import JSONResponse
from cms_core.briefing_console import BriefingStore, create_app


class BriefingIntegration:
    def __init__(self, manager_root=None):
        self.root = Path(manager_root or os.environ.get('XHS_MANAGER_ROOT') or Path(__file__).resolve().parents[1]).resolve()
        self.private = self.root / 'manager_data/briefing'
        self.private.mkdir(parents=True, exist_ok=True)
        self.token_path = self.private / '.admin-token'
        try:
            with self.token_path.open('x', encoding='utf-8') as stream:
                stream.write(secrets.token_urlsafe(32))
        except FileExistsError:
            pass
        self.apps = {}
        self.lock = threading.RLock()

    def selected_site(self):
        explicit = os.environ.get('XHS_BRIEFING_SITE_ROOT')
        if explicit:
            return Path(explicit).resolve()
        config_path = self.root / 'data/deploy_config.json'
        config = json.loads(config_path.read_text(encoding='utf-8')) if config_path.exists() else {}
        configured = config.get('blogPath', '').strip()
        return Path(configured).resolve() if configured else (self.root.parent / 'XHBlogs').resolve()

    async def __call__(self, scope, receive, send):
        try:
            site = self.selected_site()
            with self.lock:
                key = str(site)
                if key not in self.apps:
                    private = self.private / 'sites' / hashlib.sha256(key.encode()).hexdigest()[:24]
                    self.apps[key] = create_app(BriefingStore(private, site), self.token_path.read_text(encoding='utf-8').strip())
                app = self.apps[key]
        except (ValueError, OSError, TypeError):
            await JSONResponse({'detail': '请先在仓库设置中选择已更新到 0.4.0 的网站目录。'}, status_code=503)(scope, receive, send)
            return
        await app(scope, receive, send)
