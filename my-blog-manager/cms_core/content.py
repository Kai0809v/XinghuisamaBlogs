"""Conversions shared by the published-article editor's load/save paths."""

import re
from uuid import uuid4

import markdown
from markdown.extensions import Extension
from markdown.inlinepatterns import SimpleTagInlineProcessor
from markdownify import MarkdownConverter


class StrikethroughExtension(Extension):
    def extendMarkdown(self, md):
        # Code spans and fenced blocks are handled before inline formatting.
        md.inlinePatterns.register(
            SimpleTagInlineProcessor(r'(?<!~)(~~)(?=\S)(.+?)(?<=\S)~~(?!~)', 'del'),
            'strikethrough',
            175,
        )


def markdown_to_editor_html(content):
    return markdown.markdown(
        content,
        extensions=['fenced_code', 'tables', 'nl2br', StrikethroughExtension()],
    )


class EditorMarkdownConverter(MarkdownConverter):
    def __init__(self):
        super().__init__(heading_style='ATX', keep=['img', 'br'])
        self.code_blocks = {}
        self.token_prefix = 'XHCODE' + uuid4().hex

    def convert_pre(self, el, text, parent_tags):
        # Stash code before any prose <br> normalization or Markdown escaping.
        code = el.find('code')
        code_text = (code if code is not None else el).get_text()
        language = ''
        if code is not None:
            language = next(
                (value[9:] for value in code.get('class', [])
                 if value.startswith('language-')),
                '',
            )
        fence_size = max([2] + [len(run) for run in re.findall(r'`+', code_text)]) + 1
        fence = '`' * fence_size
        # A closing fence must start on its own line; retain original indentation.
        body = code_text if code_text.endswith('\n') else code_text + '\n'
        token = self.token_prefix + str(len(self.code_blocks)) + 'END'
        self.code_blocks[token] = f'{fence}{language}\n{body}{fence}'
        return '\n\n' + token + '\n\n'


def editor_html_to_markdown(content):
    content = re.sub(r'<p>(?:&#12288;)?</p>', '<br><br>', content)
    converter = EditorMarkdownConverter()
    converted = converter.convert(content)
    converted = re.sub(r'<br\s*/?>', '\n\n', converted)
    for token, block in converter.code_blocks.items():
        converted = converted.replace(token, block)
    return converted
