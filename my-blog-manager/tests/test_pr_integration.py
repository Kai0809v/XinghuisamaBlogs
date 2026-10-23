import asyncio
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from bs4 import BeautifulSoup

from cms_core.api import config, drafts
from cms_core.content import editor_html_to_markdown, markdown_to_editor_html


class Request:
    def __init__(self, payload):
        self.payload = payload

    async def json(self):
        return self.payload


class ContentRoundtripTests(unittest.TestCase):
    def roundtrip(self, html):
        return BeautifulSoup(markdown_to_editor_html(editor_html_to_markdown(html)), 'html.parser')

    def test_literal_asterisks_do_not_become_formatting(self):
        for text in ['* this is prose', '*literal stars*', 'a_b_c', '_config']:
            with self.subTest(text=text):
                soup = self.roundtrip('<p>' + text + '</p>')
                self.assertEqual(soup.p.get_text(), text)
                self.assertIsNone(soup.find(['em', 'ul']))

    def test_intentional_emphasis_and_strikethrough_survive(self):
        soup = self.roundtrip('<p><strong>bold</strong> <em>italic</em> <s>removed</s></p>')
        self.assertEqual(soup.strong.get_text(), 'bold')
        self.assertEqual(soup.em.get_text(), 'italic')
        self.assertEqual(soup.find('del').get_text(), 'removed')

    def test_code_preserves_language_indentation_and_literal_html(self):
        html = '<pre><code class="language-python"># comment\nif True:\n    print("&lt;br&gt;")\n\n    # ~~not strike~~</code></pre>'
        soup = self.roundtrip(html)
        self.assertIn('language-python', soup.code['class'])
        self.assertEqual(soup.code.get_text(), '# comment\nif True:\n    print("<br>")\n\n    # ~~not strike~~\n')
        self.assertIsNone(soup.find('del'))
        self.assertIsNone(soup.find('h1'))

    def test_nested_fences_and_multiple_blocks_survive(self):
        soup = self.roundtrip('<pre><code>```\n&lt;br&gt;\n```</code></pre><p>between</p><pre><code>    second</code></pre>')
        self.assertEqual([code.get_text() for code in soup.select('pre code')], ['```\n<br>\n```\n', '    second\n'])

    def test_tables_survive(self):
        soup = self.roundtrip('<table><thead><tr><th>Name</th><th>Value</th></tr></thead><tbody><tr><td>alpha</td><td>42</td></tr></tbody></table>')
        self.assertEqual([cell.get_text() for cell in soup.select('th, td')], ['Name', 'Value', 'alpha', '42'])

    def test_inline_code_does_not_gain_strikethrough(self):
        soup = BeautifulSoup(markdown_to_editor_html('`~~literal~~` and ~~removed~~'), 'html.parser')
        self.assertEqual(soup.code.get_text(), '~~literal~~')
        self.assertEqual(soup.find('del').get_text(), 'removed')

    def test_publish_and_reload_existing_article(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(drafts, 'PROJECT_ROOT', directory):
            post = Path(directory) / 'posts' / 'sample.md'
            post.parent.mkdir()
            post.write_text('---\ntitle: Original\n---\n\n~~removed~~\n\n```python\n# comment\n    print("<br>")\n```', encoding='utf-8')
            loaded = asyncio.run(drafts.get_draft(Request({'id': 'sample', 'type': 'post'})))
            self.assertTrue(loaded['success'])
            article = loaded['draft']
            self.assertIn('<del>removed</del>', article['content'])
            result = asyncio.run(drafts.sync_local_operations(Request({'operations': [{'type': 'publish_article', 'value': article}]})))
            self.assertTrue(result['success'])
            reloaded = asyncio.run(drafts.get_draft(Request({'id': 'sample', 'type': 'post'})))
            soup = BeautifulSoup(reloaded['draft']['content'], 'html.parser')
            self.assertEqual(soup.find('del').get_text(), 'removed')
            self.assertEqual(soup.code.get_text(), '# comment\n    print("<br>")\n')
            self.assertEqual(reloaded['draft']['title'], 'Original')


class WallpaperConfigTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.file = Path(self.temp.name) / 'siteConfig.ts'
        self.path_patch = patch.object(config, 'get_config_path', return_value=str(self.file))
        self.path_patch.start()
        self.addCleanup(self.path_patch.stop)

    def test_legacy_config_gains_fields_without_losing_personal_settings(self):
        original = 'export const siteConfig = {\n  authorName: "Personal",\n  bgImages: ["old.jpg"],\n};'
        self.file.write_text(original, encoding='utf-8')
        groups = [{'id': 'custom', 'name': 'Personal wallpapers', 'images': ['new.jpg']}]
        result = config.update_site_config({'updates': {'bgGroups': groups, 'activeBgGroup': 'custom'}})
        self.assertTrue(result['success'])
        loaded = config.get_site_config()['data']
        self.assertEqual(loaded['bgGroups'], groups)
        self.assertEqual(loaded['activeBgGroup'], 'custom')
        self.assertIn('authorName: "Personal"', self.file.read_text(encoding='utf-8'))
        self.assertIn('bgImages: ["old.jpg"]', self.file.read_text(encoding='utf-8'))

    def test_special_characters_survive_repeated_save_and_reload(self):
        self.file.write_text('export const siteConfig = { bgGroups: [], activeBgGroup: "default" };', encoding='utf-8')
        groups = [{'id': 'default', 'name': 'test,] and ,} and "quotes" \\', 'images': ['https://example.com/a,].jpg', 'https://example.com/b,}.jpg']}]
        for _ in range(2):
            self.assertTrue(config.update_site_config({'updates': {'bgGroups': groups}})['success'])
            self.assertEqual(config.get_site_config()['data']['bgGroups'], groups)

    def test_trailing_commas_are_removed_outside_strings_only(self):
        self.file.write_text('export const siteConfig = { bgGroups: [{"id":"a", "name":"literal,]", "images":["x,}.jpg",],},], activeBgGroup: "a" };', encoding='utf-8')
        self.assertEqual(config.get_site_config()['data']['bgGroups'], [{'id': 'a', 'name': 'literal,]', 'images': ['x,}.jpg']}])

    def test_empty_active_group_is_persisted(self):
        self.file.write_text('export const siteConfig = { bgGroups: [], activeBgGroup: "default" };', encoding='utf-8')
        groups = [{'id': 'default', 'name': 'Empty', 'images': []}]
        config.update_site_config({'updates': {'bgGroups': groups}})
        self.assertEqual(config.get_site_config()['data']['bgGroups'], groups)


if __name__ == '__main__':
    unittest.main()
