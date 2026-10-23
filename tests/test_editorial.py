import copy
import importlib.util
import json
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'my-blog-manager'))
from cms_core import briefing_console as console
from cms_core.briefing_content import ContentStore, ConflictError, digest, validate_issue


class EditorialTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(dir=ROOT)
        self.root = Path(self.temporary.name)
        self.site = self.root / 'site'
        self.today = datetime.now(timezone(timedelta(hours=8))).date()
        self.existing = self.issue(-1)
        console.atomic_json(self.site / 'data/dailyBriefing.json', self.existing)
        console.atomic_json(self.site / 'data/dailyBriefingArchive.json', {'windowDays': 90, 'asOfDate': self.date(0), 'issues': [self.existing]})
        console.atomic_json(self.site / 'data/dailyBriefingCovers.json', {'version': 1, 'covers': {}})
        self.settings = console.BriefingStore(self.root / 'private', self.site)
        config = self.settings.read()
        config['agent']['enabled'] = True
        self.settings.save(config)
        self.store = ContentStore(self.settings, console.atomic_json, console.WRITE_LOCK)
        self.access = self.store.create_agent('Codex Test')
        self.agent = self.store.authenticate(self.access['token'])

    def tearDown(self):
        self.temporary.cleanup()

    def date(self, offset):
        return (self.today + timedelta(days=offset)).strftime('%Y.%m.%d')

    def issue(self, offset=0):
        date = self.date(offset)
        return {'edition': {'date': date, 'label': '摄影与生活', 'weekday': '星期五', 'notice': '个人兴趣，不限专业'},
                'items': [{'id': 'photo-' + str(abs(offset)), 'category': 'news', 'title': '保持原文 & 特殊字符', 'originalTitle': 'A short original',
                           'source': 'Example', 'sourceOrg': 'Example', 'sourceDate': date, 'verifiedAt': date,
                           'url': 'https://example.com/photo-' + str(abs(offset)), 'tags': ['摄影'], 'summary': '核对后的摘要',
                           'highlights': ['第一条要点'], 'readingNote': '人工阅读备注', 'verificationUrls': ['https://example.com/source']}]}

    def save_edit(self, draft, title='人工改过的内容'):
        issue = copy.deepcopy(draft['issue'])
        issue['items'][0]['title'] = title
        return self.store.update(draft['id'], draft['revision'], issue, draft['cover'])

    def test_edit_published_only_creates_draft(self):
        before = self.settings.issues()
        draft = self.store.edit_published(self.date(-1))
        self.save_edit(draft)
        self.assertEqual(self.settings.issues(), before)

    def test_publish_requires_explicit_review(self):
        draft = self.store.create(self.issue())
        with self.assertRaises(ValueError):
            self.store.publish(draft['id'], draft['revision'], False)

    def test_publish_then_withdraw_then_restore(self):
        draft = self.store.create(self.issue())
        published = self.store.publish(draft['id'], draft['revision'], True)
        self.assertEqual(self.settings.issues()[0]['edition']['date'], self.date(0))
        withdrawn = self.store.withdraw(draft['id'], published['revision'])
        self.assertEqual(self.settings.issues(), [self.existing])
        restored = self.store.publish(draft['id'], withdrawn['revision'], True)
        self.assertEqual(restored['status'], 'published')
        self.assertEqual(len(self.settings.issues()), 2)

    def test_stale_revision_does_not_overwrite(self):
        draft = self.store.create(self.issue())
        self.save_edit(draft)
        with self.assertRaises(ConflictError):
            self.save_edit(draft, '旧窗口')

    def test_agent_replay_is_idempotent_and_tracks_current_status(self):
        first = self.store.submit(self.agent, 'run-today', self.issue())
        draft = self.store.read()['drafts'][0]
        self.save_edit(draft)
        second = self.store.submit(self.agent, 'run-today', self.issue())
        self.assertTrue(second['duplicate'])
        self.assertEqual(second['draftId'], first['draftId'])
        self.assertEqual(self.store.read()['drafts'][0]['issue']['items'][0]['title'], '人工改过的内容')
        self.assertEqual(len(self.store.read()['receipts']), 1)

    def test_same_request_key_cannot_change_payload(self):
        self.store.submit(self.agent, 'same-key', self.issue())
        other = self.issue()
        other['items'][0]['title'] = '另一份'
        with self.assertRaises(ConflictError):
            self.store.submit(self.agent, 'same-key', other)

    def test_agent_does_not_override_human_draft_or_published_date(self):
        self.store.create(self.issue())
        with self.assertRaises(ConflictError):
            self.store.submit(self.agent, 'another-run', self.issue())
        with self.assertRaises(ConflictError):
            self.store.submit(self.agent, 'existing-day', self.issue(-1))

    def test_disabled_and_revoked_access_cannot_submit(self):
        self.store.revoke(self.agent['id'])
        with self.assertRaises(PermissionError):
            self.store.authenticate(self.access['token'])
        with self.assertRaises(PermissionError):
            self.store.submit(self.agent, 'late-request', self.issue())
        config = self.settings.read()
        config['agent']['enabled'] = False
        self.settings.save(config)
        with self.assertRaises(PermissionError):
            self.store.authenticate(self.access['token'])

    def test_token_never_stored_in_plain_text(self):
        self.assertNotIn(self.access['token'], self.store.path.read_text(encoding='utf-8'))
        self.assertNotIn('tokenHash', json.dumps(self.store.agents()))

    def test_auto_mode_is_local_and_records_receipt(self):
        config = self.settings.read()
        config['agent']['publishMode'] = 'auto'
        self.settings.save(config)
        result = self.store.submit(self.agent, 'auto-today', self.issue())
        self.assertEqual(result['status'], 'published')
        self.assertEqual(self.settings.issues()[0]['edition']['date'], self.date(0))
        self.assertTrue(self.store.submit(self.agent, 'auto-today', self.issue())['duplicate'])

    def test_external_change_blocks_publishing_this_date(self):
        draft = self.store.edit_published(self.date(-1))
        external = copy.deepcopy(self.existing)
        external['items'][0]['title'] = '外部流程的新内容'
        console.atomic_json(self.site / 'data/dailyBriefing.json', external)
        with self.assertRaises(ConflictError):
            self.store.publish(draft['id'], draft['revision'], True)
        self.assertEqual(self.settings.issues()[0]['items'][0]['title'], '外部流程的新内容')

    def test_publishing_new_date_preserves_external_edits_on_other_date(self):
        draft = self.store.edit_published(self.date(-1))
        self.store.publish(draft['id'], draft['revision'], True)
        external = copy.deepcopy(self.existing)
        external['items'][0]['title'] = '保留这份外部修改'
        console.atomic_json(self.site / 'data/dailyBriefing.json', external)
        new = self.store.create(self.issue())
        self.store.publish(new['id'], new['revision'], True)
        self.assertEqual(next(x for x in self.settings.issues() if x['edition']['date'] == self.date(-1))['items'][0]['title'], '保留这份外部修改')

    def test_future_or_incomplete_issue_cannot_publish(self):
        draft = self.store.create(self.issue(1))
        with self.assertRaises(ValueError):
            self.store.publish(draft['id'], draft['revision'], True)
        partial = self.issue()
        partial['items'][0]['verificationUrls'] = []
        with self.assertRaises(ValueError):
            validate_issue(partial, self.settings.read(), complete=True)

    def test_cover_rejects_external_or_traversal_path(self):
        for cover in ({'src': 'https://example.com/a.png'}, {'src': '/images/../../outside.png'}):
            with self.assertRaises(ValueError):
                self.store.create(self.issue(), cover=cover)

    def test_failed_publication_rolls_back_files_and_state(self):
        draft = self.store.create(self.issue())
        before = {path.name: json.loads(path.read_text(encoding='utf-8')) for path in (self.site / 'data').glob('*.json')}
        state_before = self.store.read()
        written = False
        def fail_once(path, value):
            nonlocal written
            if path.name == 'dailyBriefingArchive.json' and not written:
                written = True
                raise OSError('Simulated disk failure')
            console.atomic_json(path, value)
        self.store.write = fail_once
        with self.assertRaises(OSError):
            self.store.publish(draft['id'], draft['revision'], True)
        self.assertEqual(before, {path.name: json.loads(path.read_text(encoding='utf-8')) for path in (self.site / 'data').glob('*.json')})
        self.assertEqual(self.store.read(), state_before)
        self.assertFalse(self.store.journal.exists())

    def test_restart_recovers_interrupted_publication(self):
        draft = self.store.create(self.issue())
        state = self.store.read()
        candidate = self.store.find(state, draft['id'])
        candidate.update(status='published', publishedIssue=candidate['issue'], publishedCover=None,
                         baseDigest=digest({'issue': candidate['issue'], 'cover': None}), revision=2)
        files = []
        for name, after in self.store.project(state, draft['id']).items():
            path = self.site / 'data' / name
            files.append({'name': name, 'before': json.loads(path.read_text(encoding='utf-8')) if path.exists() else None, 'after': after})
        console.atomic_json(self.store.journal, {'version': 1, 'files': files, 'state': state})
        console.atomic_json(self.site / 'data' / files[0]['name'], files[0]['after'])
        restarted = ContentStore(self.settings, console.atomic_json, console.WRITE_LOCK)
        self.assertEqual(restarted.read()['drafts'][0]['status'], 'published')
        self.assertEqual(self.settings.issues()[0]['edition']['date'], self.date(0))
        self.assertFalse(restarted.journal.exists())


if __name__ == '__main__':
    unittest.main(verbosity=2)
