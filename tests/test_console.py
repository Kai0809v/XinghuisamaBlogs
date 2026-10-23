"""Meaningful persistence checks: optional module, generic interests and safe saves."""
import copy
import hashlib
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('briefing_console', ROOT / 'my-blog-manager/cms_core/briefing_console.py')
console = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(console)


class ConsoleTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(dir=ROOT)
        self.root = Path(self.directory.name)
        self.site = self.root / 'site'
        (self.site / 'data').mkdir(parents=True)
        self.issue = {'edition': {'date': '2026.10.23', 'label': 'test'}, 'items': [{'id': 'x', 'title': 'Keep my edits', 'category': 'photography'}]}
        console.atomic_json(self.site / 'data/dailyBriefing.json', self.issue)
        console.atomic_json(self.site / 'data/dailyBriefingArchive.json', {'issues': [self.issue]})
        self.store = console.BriefingStore(self.root / 'private', self.site)

    def tearDown(self):
        self.directory.cleanup()

    def test_new_install_is_optional_and_has_no_fixed_discipline(self):
        config = self.store.read()
        self.assertFalse(config['display']['enabled'])
        self.assertEqual(config['selection']['topics'], [])
        self.assertFalse(config['agent']['enabled'])

    def test_accepts_unrelated_interests_and_custom_channels(self):
        config = self.store.read()
        config['selection']['topics'] = ['摄影', '旅行', '摄影']
        config['channels'] = [{'id': 'photography', 'name': '摄影散步', 'enabled': True}]
        saved = self.store.save(config)
        self.assertEqual(saved['selection']['topics'], ['摄影', '旅行'])
        self.assertEqual(self.store.read()['channels'][0]['name'], '摄影散步')

    def test_special_characters_survive_save_reload(self):
        config = self.store.read()
        config['display']['title'] = '''阅读 & <设计> "自然" / 诗歌 🌱'''
        self.store.save(config)
        self.assertEqual(self.store.read()['display']['title'], config['display']['title'])

    def test_disabling_keeps_all_content_unchanged(self):
        paths = [self.site / 'data/dailyBriefing.json', self.site / 'data/dailyBriefingArchive.json']
        before = [hashlib.sha256(path.read_bytes()).hexdigest() for path in paths]
        config = self.store.read()
        config['display']['enabled'] = False
        self.store.save(config)
        self.assertEqual(before, [hashlib.sha256(path.read_bytes()).hexdigest() for path in paths])

    def test_stale_window_cannot_overwrite_newer_settings(self):
        first = self.store.read()
        self.store.save(first)
        with self.assertRaises(RuntimeError):
            self.store.save(first)
        self.assertEqual(self.store.read()['revision'], 1)

    def test_invalid_config_does_not_write_anything(self):
        config = self.store.read()
        config['display']['archiveDays'] = 3
        with self.assertRaises(ValueError):
            self.store.save(config)
        self.assertFalse(self.store.config_path.exists())

    def test_all_channels_cannot_be_hidden(self):
        config = self.store.read()
        for channel in config['channels']:
            channel['enabled'] = False
        with self.assertRaises(ValueError):
            self.store.save(config)

    def test_agent_switch_is_independent_of_home_visibility(self):
        config = self.store.read()
        config['agent']['enabled'] = True
        self.store.save(config)
        self.assertTrue(self.store.read()['agent']['enabled'])
        self.assertFalse(self.store.read()['display']['enabled'])

    def test_public_settings_contain_no_agent_settings(self):
        saved = self.store.save(self.store.read())
        public = json.loads((self.site / 'data/briefingConfig.json').read_text(encoding='utf-8'))
        self.assertNotIn('agent', public)
        self.assertNotIn('preferredSources', public)
        self.assertEqual(public['display'], saved['display'])

    def test_failed_private_save_rolls_back_public_settings(self):
        current = self.store.save(self.store.read())
        config = copy.deepcopy(current)
        config['display']['title'] = 'Should not persist'
        real_write = console.atomic_json
        def fail_config(path, value):
            if path == self.store.config_path:
                raise OSError('Simulated disk write failure')
            real_write(path, value)
        with patch.object(console, 'atomic_json', fail_config):
            with self.assertRaises(OSError):
                self.store.save(config)
        public = json.loads((self.site / 'data/briefingConfig.json').read_text(encoding='utf-8'))
        self.assertEqual(public, console.public_config(current))
        self.assertEqual(self.store.read(), current)

    def test_duplicate_archive_date_uses_latest_content(self):
        self.assertEqual(len(self.store.issues()), 1)
        self.assertEqual(self.store.issues()[0], self.issue)


if __name__ == '__main__':
    unittest.main(verbosity=2)
