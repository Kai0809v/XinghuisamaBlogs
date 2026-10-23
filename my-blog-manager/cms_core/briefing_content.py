"""Local editorial workflow; publication writes only the configured preview copy."""
import copy
import hashlib
import json
import re
import secrets
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlsplit


class ConflictError(RuntimeError):
    pass


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def now():
    return datetime.now(timezone.utc).isoformat()


def calendar_date(value):
    if not isinstance(value, str) or not re.fullmatch(r'\d{4}\.\d{2}\.\d{2}', value):
        raise ValueError('日期请使用 YYYY.MM.DD 格式')
    try:
        return datetime.strptime(value, '%Y.%m.%d').date()
    except ValueError:
        raise ValueError('日期不存在，请检查年月日') from None


def web_url(value):
    if not isinstance(value, str) or len(value) > 2048:
        return False
    try:
        parsed = urlsplit(value)
        return parsed.scheme in ('http', 'https') and bool(parsed.hostname) and not parsed.username and not parsed.password
    except ValueError:
        return False


def validate_issue(value, config, complete=False):
    if not isinstance(value, dict) or not isinstance(value.get('edition'), dict) or not isinstance(value.get('items'), list):
        raise ValueError('期刊必须包含 edition 和 items')
    issue = copy.deepcopy(value)
    calendar_date(issue['edition'].get('date'))
    for key, limit in (('weekday', 20), ('label', 80), ('notice', 6000)):
        text = issue['edition'].get(key, '')
        if not isinstance(text, str) or len(text) > limit:
            raise ValueError('期刊信息过长或格式不正确：' + key)
        issue['edition'][key] = text
    if not (1 if complete else 0) <= len(issue['items']) <= config['selection']['maxItems']:
        raise ValueError('条目数量超出选题配置，请调整内容或每期条数')
    channels = {channel['id'] for channel in config['channels']}
    ids = set()
    for item in issue['items']:
        if not isinstance(item, dict) or not isinstance(item.get('id'), str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,120}', item['id']):
            raise ValueError('每条内容需要唯一的英文或数字编号')
        if item['id'] in ids:
            raise ValueError('同一期不能重复使用条目编号')
        ids.add(item['id'])
        if item.get('category') not in channels:
            raise ValueError('条目使用了尚未配置的栏目')
        limits = {'title': 300, 'originalTitle': 600, 'source': 300, 'sourceOrg': 200,
                  'summary': 6000, 'readingNote': 6000, 'url': 2048, 'doi': 300}
        for key, limit in limits.items():
            text = item.get(key, '')
            if not isinstance(text, str) or len(text) > limit:
                raise ValueError('条目字段格式不正确或过长：' + key)
            item[key] = text
        for key in ('tags', 'highlights', 'verificationUrls'):
            entries = item.get(key, [])
            if not isinstance(entries, list) or len(entries) > 40 or any(not isinstance(x, str) or not x.strip() or len(x) > 6000 for x in entries):
                raise ValueError('条目列表格式不正确：' + key)
            item[key] = entries
        for key in ('sourceDate', 'verifiedAt'):
            if item.get(key):
                calendar_date(item[key])
        if item['url'] and not web_url(item['url']):
            raise ValueError('原文链接只接受有效的 http 或 https 网址')
        if any(not web_url(url) for url in item['verificationUrls']):
            raise ValueError('核对来源中存在无效网址')
        if complete:
            if any(not item[key].strip() for key in ('title', 'source', 'summary', 'url')) or not item.get('sourceDate') or not item.get('verifiedAt') or not item['verificationUrls']:
                raise ValueError('发布前请补齐标题、摘要、来源、原文日期、核对日期和核对链接')
            if calendar_date(item['sourceDate']) > calendar_date(issue['edition']['date']):
                raise ValueError('原文日期不能晚于本期期刊日期')
            if calendar_date(item['verifiedAt']) > datetime.now(timezone(timedelta(hours=8))).date():
                raise ValueError('核对日期不能填写未来日期')
    if len(json.dumps(issue, ensure_ascii=False).encode()) > 240000:
        raise ValueError('单期期刊内容过大')
    return issue


class ContentStore:
    def __init__(self, settings, write_json, lock):
        self.settings = settings
        self.root, self.site = settings.root, settings.site
        self.write, self.lock = write_json, lock
        self.path = self.root / 'editorial.json'
        self.journal = self.root / 'publication-journal.json'
        self.recover()

    def read(self):
        if not self.path.exists():
            return {'version': 1, 'drafts': [], 'agents': [], 'receipts': [], 'events': []}
        value = json.loads(self.path.read_text(encoding='utf-8'))
        if value.get('version') != 1:
            raise ValueError('不支持的内容库版本')
        return value

    def event(self, state, action, actor, draft=None, message=''):
        state['events'].insert(0, {'id': secrets.token_hex(8), 'at': now(), 'action': action,
                                  'actor': actor, 'draftId': draft['id'] if draft else None, 'message': message})
        state['events'] = state['events'][:500]

    def find(self, state, draft_id):
        found = next((x for x in state['drafts'] if x['id'] == draft_id), None)
        if found is None:
            raise KeyError('未找到这份草稿')
        return found

    def published(self, date):
        return next((issue for issue in self.settings.issues() if issue['edition']['date'] == date), None)

    def covers(self):
        path = self.site / 'data/dailyBriefingCovers.json'
        return json.loads(path.read_text(encoding='utf-8')) if path.exists() else {'version': 1, 'covers': {}}

    def fingerprint(self, date):
        issue = self.published(date)
        return digest({'issue': issue, 'cover': self.covers()['covers'].get(date)}) if issue else None

    def validate_cover(self, cover):
        if cover is None:
            return None
        if not isinstance(cover, dict) or not isinstance(cover.get('src'), str):
            raise ValueError('封面格式不正确')
        source = cover['src']
        if not source.startswith('/images/') or '?' in source or '#' in source or '\\' in source:
            raise ValueError('封面需使用网站 images 目录下的本地文件')
        target = (self.site / 'public' / source.lstrip('/')).resolve()
        image_root = (self.site / 'public/images').resolve()
        if not target.is_relative_to(image_root) or not target.is_file() or target.suffix.lower() not in ('.webp', '.jpg', '.jpeg', '.png'):
            raise ValueError('找不到有效的本地封面图片')
        alt = cover.get('alt', '')
        if not isinstance(alt, str) or len(alt) > 300:
            raise ValueError('封面说明过长')
        return {**cover, 'src': source, 'alt': alt}

    def create(self, issue, actor='human', cover=None):
        issue = validate_issue(issue, self.settings.read())
        cover = self.validate_cover(cover)
        with self.lock:
            state = self.read()
            date = issue['edition']['date']
            existing = next((x for x in state['drafts'] if x['issue']['edition']['date'] == date), None)
            if existing:
                raise ConflictError('这一天已有草稿，请打开现有草稿编辑')
            draft = {'id': secrets.token_hex(12), 'revision': 1, 'status': 'draft', 'issue': issue,
                     'cover': cover, 'humanEdited': actor == 'human', 'createdBy': actor,
                     'createdAt': now(), 'updatedAt': now(), 'baseDigest': self.fingerprint(date)}
            state['drafts'].insert(0, draft)
            self.event(state, 'draft.created', actor, draft)
            self.write(self.path, state)
            return draft

    def edit_published(self, date):
        calendar_date(date)
        with self.lock:
            state = self.read()
            existing = next((x for x in state['drafts'] if x['issue']['edition']['date'] == date), None)
            if existing:
                return existing
            issue = self.published(date)
            if not issue:
                raise KeyError('未找到这期期刊')
            return self.create(issue, cover=self.covers()['covers'].get(date))

    def update(self, draft_id, revision, issue, cover):
        issue = validate_issue(issue, self.settings.read())
        cover = self.validate_cover(cover)
        with self.lock:
            state = self.read()
            draft = self.find(state, draft_id)
            if type(revision) is not int or draft['revision'] != revision:
                raise ConflictError('草稿已更新，请重新打开，避免覆盖其他窗口的修改')
            if issue['edition']['date'] != draft['issue']['edition']['date']:
                raise ValueError('已有草稿的期刊日期不能修改，请新建另一期')
            draft.update({'issue': issue, 'cover': cover, 'revision': revision + 1, 'humanEdited': True,
                          'status': 'draft', 'updatedAt': now()})
            self.event(state, 'draft.saved', 'human', draft)
            self.write(self.path, state)
            return draft

    def recover(self):
        if not self.journal.exists():
            return
        journal = json.loads(self.journal.read_text(encoding='utf-8'))
        for entry in journal['files']:
            path = self.site / 'data' / entry['name']
            if entry['name'] not in ('dailyBriefing.json', 'dailyBriefingArchive.json', 'dailyBriefingCovers.json', 'dailyBriefing-history.json'):
                raise ValueError('发布恢复记录中的文件无效')
            current = json.loads(path.read_text(encoding='utf-8')) if path.exists() else None
            if digest(current) not in (digest(entry['before']), digest(entry['after'])):
                raise ConflictError('发布中断后文件又被修改，请先人工核对恢复记录')
        for entry in journal['files']:
            self.write(self.site / 'data' / entry['name'], entry['after'])
        self.write(self.path, journal['state'])
        self.journal.unlink()

    def project(self, state, changed_id):
        issues = {issue['edition']['date']: issue for issue in self.settings.issues()}
        covers = self.covers()
        for draft in state['drafts']:
            if draft['id'] != changed_id:
                continue
            date = draft['issue']['edition']['date']
            if draft['status'] == 'published':
                issues[date] = draft['publishedIssue']
                if draft.get('publishedCover'):
                    covers['covers'][date] = draft['publishedCover']
                else:
                    covers['covers'].pop(date, None)
            elif draft['status'] == 'withdrawn':
                issues.pop(date, None)
                covers['covers'].pop(date, None)
        if not issues:
            raise ValueError('最后一期暂不能撤下，请先保留至少一期内容')
        ordered = [issues[date] for date in sorted(issues, reverse=True)]
        today = datetime.now(timezone(timedelta(hours=8))).date()
        archive = [issue for issue in ordered if timedelta(0) <= today - calendar_date(issue['edition']['date']) < timedelta(days=90)]
        history_path = self.site / 'data/dailyBriefing-history.json'
        history = json.loads(history_path.read_text(encoding='utf-8')) if history_path.exists() else {'version': 1, 'editions': []}
        for draft in state['drafts']:
            if draft['id'] != changed_id:
                continue
            if draft['status'] not in ('published', 'withdrawn'):
                continue
            date = draft['issue']['edition']['date']
            history['editions'] = [entry for entry in history['editions'] if entry['date'] != date]
            issue = draft.get('publishedIssue', draft['issue'])
            history['editions'].append({'date': date, 'status': draft['status'], 'digest': digest(issue),
                'items': [{'id': x['id'], 'key': 'doi:' + x['doi'].lower() if x.get('doi') else 'url:' + x['url'].rstrip('/'),
                           'url': x['url'], 'title': re.sub(r'[^\w]', '', x.get('originalTitle') or x['title']).lower(),
                           'originalTitle': x.get('originalTitle', ''), 'category': x['category'], 'sourceOrg': x.get('sourceOrg', '')} for x in issue['items']]})
        history['editions'].sort(key=lambda x: x['date'])
        return {'dailyBriefing.json': ordered[0], 'dailyBriefingArchive.json': {'windowDays': 90, 'asOfDate': today.strftime('%Y.%m.%d'), 'issues': archive},
                'dailyBriefingCovers.json': covers, 'dailyBriefing-history.json': history}

    def commit_publication(self, state, changed_id):
        files = []
        for name, after in self.project(state, changed_id).items():
            path = self.site / 'data' / name
            before = json.loads(path.read_text(encoding='utf-8')) if path.exists() else None
            files.append({'name': name, 'before': before, 'after': after})
        journal = {'version': 1, 'files': files, 'state': state}
        self.write(self.journal, journal)
        try:
            for entry in files:
                self.write(self.site / 'data' / entry['name'], entry['after'])
            self.write(self.path, state)
        except OSError:
            for entry in files:
                path = self.site / 'data' / entry['name']
                if entry['before'] is None:
                    path.unlink(missing_ok=True)
                else:
                    self.write(path, entry['before'])
            self.journal.unlink()
            raise
        self.journal.unlink()

    def publish(self, draft_id, revision, reviewed, actor='human'):
        if reviewed is not True:
            raise ValueError('请先确认已核对内容及来源')
        with self.lock:
            state = self.read()
            draft = self.find(state, draft_id)
            if type(revision) is not int or draft['revision'] != revision or draft['status'] == 'published':
                raise ConflictError('草稿状态已变更，请重新打开')
            issue = validate_issue(draft['issue'], self.settings.read(), complete=True)
            if calendar_date(issue['edition']['date']) > datetime.now(timezone(timedelta(hours=8))).date():
                raise ValueError('未来期刊请先保留为草稿')
            if (datetime.now(timezone(timedelta(hours=8))).date() - calendar_date(issue['edition']['date'])).days >= 90:
                raise ValueError('本地发布范围为最近 90 天，更早的内容请保留为草稿')
            if draft['baseDigest'] != self.fingerprint(issue['edition']['date']):
                raise ConflictError('网站上的本期期刊已被其他流程修改，请先核对再建立新草稿')
            draft.update({'publishedIssue': issue, 'publishedCover': self.validate_cover(draft['cover']), 'status': 'published',
                          'revision': revision + 1, 'updatedAt': now()})
            draft['baseDigest'] = digest({'issue': issue, 'cover': draft['publishedCover']})
            self.event(state, 'issue.published.local', actor, draft, '发布到本地网站副本')
            self.commit_publication(state, draft_id)
            return draft

    def withdraw(self, draft_id, revision):
        with self.lock:
            state = self.read()
            draft = self.find(state, draft_id)
            if type(revision) is not int or draft['revision'] != revision or draft['status'] != 'published':
                raise ConflictError('只能撤下当前已发布的版本')
            if draft['baseDigest'] != self.fingerprint(draft['issue']['edition']['date']):
                raise ConflictError('网站期刊已被其他流程改动，暂不能撤下')
            draft.update({'status': 'withdrawn', 'revision': revision + 1, 'updatedAt': now(), 'baseDigest': None})
            self.event(state, 'issue.withdrawn.local', 'human', draft)
            self.commit_publication(state, draft_id)
            return draft

    def agents(self):
        return [{k: v for k, v in agent.items() if k != 'tokenHash'} for agent in self.read()['agents']]

    def create_agent(self, name):
        if not isinstance(name, str) or not 1 <= len(name.strip()) <= 40:
            raise ValueError('请填写 1–40 字的 Agent 名称')
        with self.lock:
            state = self.read()
            if len([x for x in state['agents'] if x['active']]) >= 20:
                raise ValueError('最多同时保留 20 个 Agent 授权')
            agent_id = secrets.token_hex(8)
            token = 'bfg_' + agent_id + '_' + secrets.token_urlsafe(32)
            agent = {'id': agent_id, 'name': name.strip(), 'active': True, 'createdAt': now(), 'lastSeen': None,
                     'tokenHash': hashlib.sha256(token.encode()).hexdigest()}
            state['agents'].append(agent)
            self.event(state, 'agent.authorized', 'human', message=name.strip())
            self.write(self.path, state)
            return {'agent': {k: v for k, v in agent.items() if k != 'tokenHash'}, 'token': token}

    def revoke(self, agent_id):
        with self.lock:
            state = self.read()
            agent = next((x for x in state['agents'] if x['id'] == agent_id), None)
            if not agent:
                raise KeyError('未找到该 Agent')
            agent['active'] = False
            self.event(state, 'agent.revoked', 'human', message=agent['name'])
            self.write(self.path, state)

    def authenticate(self, token):
        if not self.settings.read()['agent']['enabled']:
            raise PermissionError('Agent 接收已关闭')
        hashed = hashlib.sha256(token.encode()).hexdigest()
        with self.lock:
            state = self.read()
            agent = next((x for x in state['agents'] if x['active'] and secrets.compare_digest(x['tokenHash'], hashed)), None)
            if not agent:
                raise PermissionError('Agent 授权无效或已撤销')
            agent['lastSeen'] = now()
            self.write(self.path, state)
            return {k: v for k, v in agent.items() if k != 'tokenHash'}

    def submit(self, agent, key, issue):
        if not isinstance(key, str) or not re.fullmatch(r'[A-Za-z0-9_.:-]{1,120}', key):
            raise ValueError('请提供有效的 Idempotency-Key')
        issue = validate_issue(issue, self.settings.read(), complete=True)
        with self.lock:
            state = self.read()
            if not self.settings.read()['agent']['enabled'] or not any(x['id'] == agent['id'] and x['active'] for x in state['agents']):
                raise PermissionError('Agent 接收已关闭或授权已撤销')
            receipt = next((x for x in state['receipts'] if x['agentId'] == agent['id'] and x['key'] == key), None)
            if receipt:
                if receipt['payloadHash'] != digest(issue):
                    raise ConflictError('相同提交编号不能用于不同的内容')
                draft = self.find(state, receipt['draftId'])
                if self.settings.read()['agent']['publishMode'] == 'auto' and not draft['humanEdited'] and draft['status'] == 'draft':
                    draft = self.publish(draft['id'], draft['revision'], True, actor=agent['name'])
                return {'receiptId': receipt['id'], 'draftId': draft['id'], 'status': draft['status'], 'duplicate': True}
            date = issue['edition']['date']
            if self.published(date) or any(x['issue']['edition']['date'] == date for x in state['drafts']):
                self.event(state, 'submission.conflict', agent['name'], message=date + ' 已有内容，未覆盖')
                self.write(self.path, state)
                raise ConflictError('这一天已有期刊或人工草稿，Agent 不会覆盖，请交由人工处理')
            draft = {'id': secrets.token_hex(12), 'revision': 1, 'status': 'draft', 'issue': issue,
                     'cover': None, 'humanEdited': False, 'createdBy': agent['name'],
                     'createdAt': now(), 'updatedAt': now(), 'baseDigest': None}
            state['drafts'].insert(0, draft)
            record = {'id': secrets.token_hex(12), 'agentId': agent['id'], 'key': key, 'payloadHash': digest(issue), 'draftId': draft['id'], 'at': now()}
            state['receipts'].insert(0, record)
            state['receipts'] = state['receipts'][:2000]
            self.event(state, 'submission.accepted', agent['name'], draft)
            self.write(self.path, state)
            if self.settings.read()['agent']['publishMode'] == 'auto':
                draft = self.publish(draft['id'], draft['revision'], True, actor=agent['name'])
            return {'receiptId': record['id'], 'draftId': draft['id'], 'status': draft['status'], 'duplicate': False}
