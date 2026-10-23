'use client';

import { useEffect, useState, type ReactNode } from 'react';
import BriefingGuide from '../../app/briefing/BriefingGuide';
import BriefingContentManager from './BriefingContentManager';
import BriefingAgentPanel from './BriefingAgentPanel';
import type { BriefingIssue } from './briefingApi';
import { ArrowUpRight, BookOpen, Check, CircleHelp, Eye, Layers3, Loader2, Plus, RefreshCw, Save, Settings2, Sparkles, Workflow, X } from 'lucide-react';

type Config = {
  version: number; revision: number;
  display: { enabled: boolean; title: string; subtitle: string; archiveDays: number; carouselDays: number; autoPlay: boolean; intervalSeconds: number; showCovers: boolean; showTerraNotes: boolean };
  selection: { topics: string[]; excludedKeywords: string[]; preferredSources: string[]; language: string; maxItems: number };
  channels: { id: string; name: string; enabled: boolean }[];
  agent: { enabled: boolean; publishMode: string; preferredTime: string };
};
type Issue = BriefingIssue;
type Status = { latestDate: string; issueCount: number; sitePreview: string };
type Tab = 'overview' | 'display' | 'selection' | 'issues' | 'agents';
const tabs = [
  { id: 'overview' as Tab, label: '选刊总览', icon: Layers3 },
  { id: 'display' as Tab, label: '首页展示', icon: Eye },
  { id: 'selection' as Tab, label: '选题与栏目', icon: Settings2 },
  { id: 'issues' as Tab, label: '内容与审核', icon: BookOpen },
  { id: 'agents' as Tab, label: 'Agent 与更新', icon: Workflow },
];
const fieldClass = 'w-full rounded-2xl border border-slate-200/80 bg-white/70 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100/60 dark:border-white/10 dark:bg-slate-900/40 dark:text-slate-200 dark:focus:ring-indigo-950';
const buttonClass = 'inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white/70 px-4 py-2.5 text-xs font-medium text-slate-600 transition hover:border-indigo-200 hover:text-indigo-600 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10 dark:bg-slate-800/70 dark:text-slate-300';
const splitTerms = (text: string) => [...new Set(text.split(/[\n,，]/).map(value => value.trim()).filter(Boolean))];
const guideStorageKey = 'xhs-briefing-guide-v1';

async function api<T>(name: string, options?: RequestInit): Promise<T> {
  const response = await fetch('/api/briefing/' + name, { cache: 'no-store', ...options });
  const body = await response.json();
  if (!response.ok) throw new Error(typeof body.detail === 'string' ? body.detail : '读取失败，请稍后再试');
  return body;
}

export default function BriefingSection() {
  const [tab, setTab] = useState<Tab>('overview');
  const [config, setConfig] = useState<Config | null>(null);
  const [baseline, setBaseline] = useState('');
  const [terms, setTerms] = useState({ topics: '', excludedKeywords: '', preferredSources: '' });
  const [issues, setIssues] = useState<Issue[]>([]);
  const [status, setStatus] = useState<Status | null>(null);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [guideOpen, setGuideOpen] = useState(false);
  const [connection, setConnection] = useState<'checking' | 'ready' | 'offline'>('checking');

  function apply(value: Config) {
    setConfig(value);
    setTerms({ topics: value.selection.topics.join('\n'), excludedKeywords: value.selection.excludedKeywords.join('\n'), preferredSources: value.selection.preferredSources.join('\n') });
    setBaseline(JSON.stringify(value));
  }
  async function load() {
    setBusy(true); setError(''); setConnection('checking');
    try {
      const [settings, archive, runtime] = await Promise.all([
        api<{ config: Config }>('settings'), api<{ issues: Issue[] }>('issues'), api<Status>('status'),
      ]);
      apply(settings.config); setIssues(archive.issues); setStatus(runtime);
      setConnection('ready');
    } catch (exception) { setConnection('offline'); setError(exception instanceof Error ? exception.message : '读取失败'); }
    finally { setBusy(false); }
  }
  useEffect(() => { void load(); }, []); // The console reads the local snapshot once on opening.
  useEffect(() => {
    try { setGuideOpen(localStorage.getItem(guideStorageKey) !== 'understood'); }
    catch { setGuideOpen(true); }
  }, []);
  function dismissGuide(remember: boolean) {
    if (remember) {
      try { localStorage.setItem(guideStorageKey, 'understood'); } catch { /* The guide remains available without browser storage. */ }
    }
    setGuideOpen(false);
  }
  function followGuide(tab: 'display' | 'selection') {
    setTab(tab);
    requestAnimationFrame(() => document.getElementById('briefing-workspace')?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }));
  }
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(''), 5000);
    return () => clearTimeout(timer);
  }, [message]);

  const draft = config ? { ...config, selection: { ...config.selection, topics: splitTerms(terms.topics), excludedKeywords: splitTerms(terms.excludedKeywords), preferredSources: splitTerms(terms.preferredSources) } } : null;
  const dirty = draft !== null && JSON.stringify(draft) !== baseline;
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  async function save() {
    if (!draft) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await api<{ config: Config }>('settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft) });
      apply(result.config); setMessage('已保存到本地预览。线上网站和现有每日任务未变更。');
    } catch (exception) { setError(exception instanceof Error ? exception.message : '保存失败'); }
    finally { setBusy(false); }
  }
  async function refreshPublished() {
    try {
      const [archive, runtime] = await Promise.all([api<{ issues: Issue[] }>('issues'), api<Status>('status')]);
      setIssues(archive.issues); setStatus(runtime);
    } catch (exception) { setError(exception instanceof Error ? exception.message : '列表刷新失败'); }
  }
  function display<K extends keyof Config['display']>(key: K, value: Config['display'][K]) {
    setConfig(previous => previous ? { ...previous, display: { ...previous.display, [key]: value } } : previous);
  }
  function selection<K extends keyof Config['selection']>(key: K, value: Config['selection'][K]) {
    setConfig(previous => previous ? { ...previous, selection: { ...previous.selection, [key]: value } } : previous);
  }

  return <section aria-label="每日选刊管理" className="min-w-0 rounded-3xl border border-slate-200/80 bg-slate-50/95 p-4 text-slate-700 shadow-sm md:p-6 dark:border-white/10 dark:bg-slate-900/95 dark:text-slate-200">
    <div>

      <header className="mb-8 flex flex-col justify-between gap-5 2xl:flex-row 2xl:items-end">
        <div><p className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.25em] text-indigo-500"><Sparkles size={13} /> A little reading, every day</p><h2 className="text-2xl font-semibold tracking-tight text-slate-800 dark:text-white">每日选刊</h2><p className="mt-3 max-w-xl text-xs leading-6 text-slate-500 dark:text-slate-400">决定它是否出现，也决定它关注什么。你的兴趣，由你定义。</p></div>
        <div className="flex flex-wrap items-center gap-2">
          <button className={buttonClass} onClick={() => setGuideOpen(true)}><CircleHelp size={14} />使用引导</button>
          <button className={buttonClass} disabled={busy} onClick={() => { if (!dirty || window.confirm('重新读取会放弃尚未保存的修改，继续吗？')) void load(); }}><RefreshCw size={14} className={busy ? 'animate-spin' : ''} />重新读取</button>
          {status?.sitePreview && <a className={buttonClass} href={status.sitePreview} target="_blank" rel="noreferrer"><Eye size={14} />查看首页预览<ArrowUpRight size={12} /></a>}
          <button disabled={!dirty || busy} onClick={() => void save()} className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-xs font-medium text-white shadow-lg shadow-indigo-500/15 transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40">{busy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}保存本地设置</button>
        </div>
      </header>
      <div aria-live="polite" className="mb-4 space-y-2">{error && <p role="alert" className="rounded-2xl border border-rose-200 bg-rose-50/90 px-5 py-3 text-xs leading-6 text-rose-700">{error}</p>}{message && <p role="status" className="flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50/90 px-5 py-3 text-xs leading-6 text-emerald-700"><Check size={15} />{message}</p>}</div>
      {guideOpen && <BriefingGuide connected={connection === 'ready'} loading={connection === 'checking'} busy={busy} dirty={dirty} previewUrl={status?.sitePreview ?? ''} onNavigate={followGuide} onSave={() => void save()} onRetry={() => { if (!dirty || window.confirm('重新读取会放弃尚未保存的修改，继续吗？')) void load(); }} onDismiss={dismissGuide} />}
      <div id="briefing-workspace" className="scroll-mt-24 space-y-5">
        <nav aria-label="选刊管理" className="flex flex-wrap gap-2 rounded-2xl border border-white/60 bg-white/40 p-2 dark:border-white/10 dark:bg-slate-900/40">{tabs.map(item => <button key={item.id} type="button" aria-current={tab === item.id ? 'page' : undefined} onClick={() => setTab(item.id)} className={`flex items-center gap-2 rounded-xl px-3 py-2.5 text-xs transition ${tab === item.id ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600 hover:bg-white/70 dark:text-slate-300 dark:hover:bg-white/10'}`}><item.icon size={14} />{item.label}</button>)}</nav>
        <p className="text-xs leading-6 text-slate-500 dark:text-slate-400">{dirty ? '有尚未保存的选刊修改。切换左侧栏目会保留，请在离开网页前保存。' : '选刊与左侧其他设置在同一控制台管理。当前改动仅保存到本地网站目录。'}</p>
        <div className="min-w-0">
          {!config ? <Panel title={busy ? '正在读取选刊配置…' : '尚未连接本机服务'} description="启动本地预览服务后，可以在这里管理展示和选题。"><button onClick={() => void load()} className={buttonClass} disabled={busy}>重新连接</button></Panel> : <>
            {tab === 'overview' && <div className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-3"><Metric label="首页展示" value={config.display.enabled ? '已开启' : '已隐藏'} note="关闭不删除历史内容" /><Metric label="已保存选刊" value={`${status?.issueCount ?? 0} 期`} note={`最近一期 ${status?.latestDate ?? '暂无'}`} /><Metric label="Agent 接收" value={config.agent.enabled ? '允许提交' : '已关闭'} note="现有定时任务尚未切换" /></div>
              <Panel title="给首页留一块自己的阅读角" description="可以是技术、文学、设计、体育，也可以只是你今天感兴趣的事。">
                <Toggle title="在首页显示选刊板块" description="隐藏后仍保留全部选刊。展示开关与 Agent 接收开关分别管理。" checked={config.display.enabled} onChange={value => display('enabled', value)} />
                <div className="mt-6 overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-800 p-7 text-white"><div className="flex justify-between gap-4"><span className="text-[9px] tracking-[0.24em] text-indigo-200">DAILY SIGNAL</span><span className="text-[11px] text-white/50">{status?.latestDate ?? '等待第一期'}</span></div><p className="mt-7 text-[11px] tracking-widest text-indigo-200">{config.display.title}</p><h2 className="mt-2 text-2xl font-medium tracking-wide">{config.display.subtitle}</h2><p className="mt-4 truncate text-xs text-white/60">{issues[0]?.items[0]?.title ?? '从你关注的方向，开始第一期选刊。'}</p><div className="mt-6 flex flex-wrap gap-2">{config.channels.filter(channel => channel.enabled).map(channel => <span key={channel.id} className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[11px] text-white/70">{channel.name}</span>)}</div></div>
                <p className="mt-3 text-[11px] leading-6 text-slate-400">上方为文字样式示意；保存后，点击“查看首页预览”检查实际效果。</p>
              </Panel>
              <Panel title="这次预览可以做什么" description="手工整理或 Agent 提交后，先保存草稿，确认内容再发布到本地预览。"><div className="grid gap-5 text-xs leading-6 sm:grid-cols-2"><div><p className="font-medium text-slate-700 dark:text-slate-200">现在可以使用</p><p className="mt-1 text-slate-500 dark:text-slate-400">编辑草稿、预览阅读、管理封面，审核后发布或撤下本地内容。</p></div><div><p className="font-medium text-slate-700 dark:text-slate-200">上线前仍需确认</p><p className="mt-1 text-slate-500 dark:text-slate-400">正式网站发布方式、现有 Codex 定时任务切换；DSH 本次暂不做。</p></div></div></Panel>
            </div>}
            {tab === 'display' && <div className="space-y-5">
              <Panel title="首页展示" description="把选刊作为一个可选板块，而不是每个网站必须拥有的部分。"><Toggle title="显示选刊板块" description="仅隐藏首页入口，已有内容和阅读记录保留。" checked={config.display.enabled} onChange={value => display('enabled', value)} /><div className="mt-6 grid gap-5 sm:grid-cols-2"><Field label="板块名称"><input className={fieldClass} value={config.display.title} maxLength={40} onChange={e => display('title', e.target.value)} /></Field><Field label="板块简介"><input className={fieldClass} value={config.display.subtitle} maxLength={100} onChange={e => display('subtitle', e.target.value)} /></Field></div></Panel>
              <Panel title="阅读与轮播" description="保留按日归档、暂停轮播和读者自己的收藏。"><div className="grid gap-5 sm:grid-cols-3"><Field label="往期展示范围" hint="以最近一次打开网站的日期计算，不生成空白期刊。"><select className={fieldClass} value={config.display.archiveDays} onChange={e => display('archiveDays', Number(e.target.value))}>{[7, 14, 30, 60, 90].map(value => <option key={value} value={value}>最近 {value} 天</option>)}</select></Field><Field label="卡片轮播范围"><input className={fieldClass} type="number" min={1} max={Math.min(14, config.display.archiveDays)} value={config.display.carouselDays} onChange={e => display('carouselDays', Number(e.target.value))} /></Field><Field label="每张停留时间（秒）"><input className={fieldClass} type="number" min={5} max={60} value={config.display.intervalSeconds} onChange={e => display('intervalSeconds', Number(e.target.value))} /></Field></div><div className="mt-7 space-y-5"><Toggle title="自动轮播" description="阅读、悬停、切到后台或启用减少动态效果时，会自动暂停。" checked={config.display.autoPlay} onChange={value => display('autoPlay', value)} /><Toggle title="显示期刊封面" description="关闭后显示简洁的渐变背景，封面文件仍然保留。" checked={config.display.showCovers} onChange={value => display('showCovers', value)} /><Toggle title="开放附加阅读" description="这是你的个人阅读扩展，其他使用者可以关闭。" checked={config.display.showTerraNotes} onChange={value => display('showTerraNotes', value)} /></div></Panel>
            </div>}
            {tab === 'selection' && <div className="space-y-5">
              <Panel title="你希望读到什么" description="以下是你的个人偏好。新安装不预设任何专业方向，也不要求填写特定领域。"><div className="grid gap-6 sm:grid-cols-2"><Field label="关注主题" hint="每行一个，也可以用逗号分隔。留空时不按主题筛选历史内容。"><textarea className={fieldClass} rows={5} value={terms.topics} onChange={e => setTerms({ ...terms, topics: e.target.value })} placeholder={'例如：摄影\n城市生活\n开源软件'} /></Field><Field label="排除关键词" hint="用于后续 Agent 选题，不会删除已有内容。"><textarea className={fieldClass} rows={5} value={terms.excludedKeywords} onChange={e => setTerms({ ...terms, excludedKeywords: e.target.value })} placeholder="不想收录的主题，可留空" /></Field></div><div className="mt-6"><Field label="偏好来源" hint="填写媒体、期刊、机构名称或网址；只是选题偏好，不是抓取白名单。"><textarea className={fieldClass} rows={3} value={terms.preferredSources} onChange={e => setTerms({ ...terms, preferredSources: e.target.value })} placeholder="每行一个来源，可留空" /></Field></div><div className="mt-6 grid gap-5 sm:grid-cols-2"><Field label="摘要语言"><select className={fieldClass} value={config.selection.language} onChange={e => selection('language', e.target.value)}><option value="zh-CN">中文</option><option value="en-US">English</option><option value="ja-JP">日本語</option></select></Field><Field label="每期最多条目" hint="新选刊的生成偏好，接入 Agent 后生效。"><input className={fieldClass} type="number" min={1} max={20} value={config.selection.maxItems} onChange={e => selection('maxItems', Number(e.target.value))} /></Field></div></Panel>
              <Panel title="栏目设置" description="栏目名称可以改，历史内容仍按原栏目归属保留。至少启用一个栏目。"><div className="space-y-4">{config.channels.map((channel, index) => <div key={channel.id} className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200/60 bg-white/30 p-4 dark:border-white/10"><div className="min-w-40 flex-1"><label className="sr-only" htmlFor={'channel-' + channel.id}>栏目名称 {index + 1}</label><input id={'channel-' + channel.id} className={fieldClass} value={channel.name} maxLength={24} onChange={e => setConfig({ ...config, channels: config.channels.map((entry, i) => i === index ? { ...entry, name: e.target.value } : entry) })} /><p className="mt-1.5 pl-1 text-[9px] text-slate-400">归属编号 {channel.id}</p></div><Toggle title={channel.enabled ? '显示' : '隐藏'} checked={channel.enabled} onChange={value => setConfig({ ...config, channels: config.channels.map((entry, i) => i === index ? { ...entry, enabled: value } : entry) })} compact /></div>)}</div><button disabled={config.channels.length >= 6} className={buttonClass + ' mt-5'} onClick={() => { let index = config.channels.length + 1; while (config.channels.some(channel => channel.id === `section-${index}`)) index++; setConfig({ ...config, channels: [...config.channels, { id: `section-${index}`, name: '新栏目', enabled: true }] }); }}><Plus size={14} />新增栏目</button></Panel>
            </div>}
            <div hidden={tab !== 'issues'}><BriefingContentManager issues={issues} channels={config.channels} maxItems={config.selection.maxItems} onPublished={() => void refreshPublished()} /></div>
            <div hidden={tab !== 'agents'}><BriefingAgentPanel settings={config.agent} onChange={value => setConfig({ ...config, agent: value })} /></div>
          </>}
        </div>
      </div>
      <footer className="mt-10 flex items-start gap-2 text-[11px] leading-6 text-slate-400"><CircleHelp size={13} className="mt-1 shrink-0" /><p>当前为网站控制台的本地网站目录。设置保存在副本中，线上网站和现有每日任务保持原样。</p></footer>
    </div>
  </section>;
}

function Panel({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <section className="rounded-[28px] border border-white/70 bg-white/55 p-6 shadow-sm backdrop-blur-2xl sm:p-8 dark:border-white/10 dark:bg-slate-800/55"><h2 className="text-base font-semibold text-slate-800 dark:text-white">{title}</h2><p className="mb-6 mt-2 text-[11px] leading-6 text-slate-500 dark:text-slate-400">{description}</p>{children}</section>;
}
function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <label className="block"><span className="mb-2 block text-xs font-medium text-slate-600 dark:text-slate-300">{label}</span>{children}{hint && <span className="mt-2 block text-[11px] leading-5 text-slate-400">{hint}</span>}</label>;
}
function Toggle({ title, description, checked, onChange, disabled, compact }: { title: string; description?: string; checked: boolean; onChange: (value: boolean) => void; disabled?: boolean; compact?: boolean }) {
  return <div className={'flex items-center justify-between gap-4 ' + (compact ? 'flex-row-reverse' : '')}><div><p className="text-xs font-medium text-slate-700 dark:text-slate-200">{title}</p>{description && <p className="mt-1 text-[11px] leading-6 text-slate-500 dark:text-slate-400">{description}</p>}</div><button type="button" role="switch" aria-label={title} aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)} className={`relative h-6 w-11 shrink-0 rounded-full transition focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-indigo-400 disabled:cursor-not-allowed disabled:opacity-40 ${checked ? 'bg-indigo-600' : 'bg-slate-300 dark:bg-slate-600'}`}><span className={`absolute left-1 top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${checked ? 'translate-x-5' : ''}`} /></button></div>;
}
function Metric({ label, value, note }: { label: string; value: string; note: string }) {
  return <div className="rounded-3xl border border-white/70 bg-white/50 p-6 backdrop-blur-xl dark:border-white/10 dark:bg-slate-800/50"><p className="text-[11px] text-slate-500 dark:text-slate-400">{label}</p><p className="mt-3 text-xl font-semibold tracking-tight text-slate-800 dark:text-white">{value}</p><p className="mt-2 text-[11px] text-slate-400">{note}</p></div>;
}
