import copy
import threading
import time
import socket
import base64
import unittest
from fastapi.testclient import TestClient
from test_editorial import EditorialTests
from cms_core import briefing_console as console
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "my-blog-manager/public"))
from briefing_agent import Client


class ApiTests(EditorialTests):
    def setUp(self):
        super().setUp()
        self.app = console.create_app(self.settings, 'test-admin-only')
        self.client = TestClient(self.app)
        self.admin = {'x-briefing-admin': 'test-admin-only'}
        self.auth = {'Authorization': 'Bearer ' + self.access['token']}

    def test_http_agent_scope_and_receipt_ownership(self):
        self.assertEqual(self.client.get('/api/briefing/drafts', headers=self.auth).status_code, 401)
        self.assertEqual(self.client.get('/api/briefing-agent/v1/config', headers=self.auth).status_code, 200)
        first = self.client.post('/api/briefing-agent/v1/submissions', headers={**self.auth, 'Idempotency-Key': 'http-run'}, json={'issue': self.issue()})
        self.assertEqual(first.status_code, 200, first.text)
        duplicate = self.client.post('/api/briefing-agent/v1/submissions', headers={**self.auth, 'Idempotency-Key': 'http-run'}, json={'issue': self.issue()})
        self.assertTrue(duplicate.json()['duplicate'])
        other = self.store.create_agent('Other Agent')
        denied = self.client.get('/api/briefing-agent/v1/receipts/' + first.json()['receiptId'], headers={'Authorization': 'Bearer ' + other['token']})
        self.assertEqual(denied.status_code, 404)
        allowed = self.client.get('/api/briefing-agent/v1/receipts/' + first.json()['receiptId'], headers=self.auth)
        self.assertEqual(allowed.json()['status'], 'draft')

    def test_http_edit_review_publish_workflow(self):
        created = self.client.post('/api/briefing/drafts', headers=self.admin, json={'issue': self.issue()})
        self.assertEqual(created.status_code, 200, created.text)
        draft = created.json()['draft']
        result = self.client.post('/api/briefing/drafts/' + draft['id'] + '/publish', headers=self.admin, json={'revision': draft['revision'], 'reviewed': True})
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(self.client.get('/api/briefing/status', headers=self.admin).json()['issueCount'], 2)

    def test_http_invalid_issue_is_reported_without_content_change(self):
        issue = self.issue()
        issue['items'][0]['url'] = 'javascript:alert(1)'
        response = self.client.post('/api/briefing-agent/v1/submissions', headers={**self.auth, 'Idempotency-Key': 'invalid-run'}, json={'issue': issue})
        self.assertEqual(response.status_code, 422)
        self.assertEqual(self.store.read()['drafts'], [])
        self.assertEqual(self.store.read()['events'][0]['action'], 'submission.failed')

    def test_http_client_file_handoff_and_receipt(self):
        import uvicorn
        socket_handle = socket.socket()
        socket_handle.bind(('127.0.0.1', 0))
        port = socket_handle.getsockname()[1]
        server = uvicorn.Server(uvicorn.Config(self.app, host='127.0.0.1', port=port, log_level='error', access_log=False))
        worker = threading.Thread(target=lambda: server.run(sockets=[socket_handle]), daemon=True)
        worker.start()
        deadline = time.monotonic() + 10
        while not server.started and time.monotonic() < deadline:
            time.sleep(0.02)
        self.assertTrue(server.started)
        try:
            connection = self.root / 'connection.json'
            console.atomic_json(connection, {'baseUrl': 'http://127.0.0.1:' + str(port), 'token': self.access['token']})
            client = Client(connection)
            folder = self.root / 'handoff'
            prepared = client.prepare(folder)
            self.assertEqual(prepared['scope'], 'local-preview')
            for path in folder.glob('*'):
                self.assertNotIn(self.access['token'], path.read_text(encoding='utf-8'))
            receipt = client.call('submissions', {'issue': self.issue()}, 'client-roundtrip')
            self.assertEqual(receipt['status'], 'draft')
            self.assertEqual(client.call('receipts/' + receipt['receiptId'])['draftId'], receipt['draftId'])
            self.store.revoke(self.agent['id'])
            with self.assertRaises(ValueError):
                client.call('config')
        finally:
            server.should_exit = True
            worker.join(timeout=5)
            socket_handle.close()

    def test_http_cover_upload_and_reject_non_image(self):
        encoded = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jzXcAAAAASUVORK5CYII='
        response = self.client.post('/api/briefing/covers', headers=self.admin, json={'data': encoded})
        self.assertEqual(response.status_code, 200, response.text)
        cover = response.json()['cover']
        target = self.site / 'public' / cover['src'].lstrip('/')
        self.assertEqual(target.read_bytes(), base64.b64decode(encoded))
        repeated = self.client.post('/api/briefing/covers', headers=self.admin, json={'data': encoded})
        self.assertEqual(repeated.json()['cover']['src'], cover['src'])
        denied = self.client.post('/api/briefing/covers', headers=self.admin, json={'data': base64.b64encode(b'<svg>not an accepted image</svg>').decode()})
        self.assertEqual(denied.status_code, 422)


if __name__ == '__main__':
    # Run only HTTP-specific cases; persistence cases are covered separately.
    suite = unittest.TestSuite(ApiTests(name) for name in dir(ApiTests) if name.startswith('test_http_'))
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    raise SystemExit(0 if result.wasSuccessful() else 1)
