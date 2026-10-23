'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Eye, FilePlus, Save, Plus, Trash2, ArrowLeft, Check } from 'lucide-react';
import { briefingApi, localToday, inputStyle, actionStyle, type BriefingIssue, type EditorialDraft, type Cover, type BriefingItem } from './briefingApi';

type Props = { issues: BriefingIssue[]; channels: { id: string; name: string; enabled: boolean }[]; maxItems: number; onPublished: () => void };
const statusName = { draft: '待审核草稿', published: '已发布到本地', withdrawn: '已撤下' };

export default function BriefingContentManager({ issues, channels, maxItems, onPublished }: Props) {
  const [drafts, setDrafts] = useState<EditorialDraft[]>([]);
  const [editing, setEditing] = useState<EditorialDraft | null>(null);
  const [baseline, setBaseline] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [filter, setFilter] = useState('');
  const [activeItem, setActiveItem] = useState(0);
  const [assets, setAssets] = useState<{ src: string; name: string }[]>([]);
  const dirty = editing !== null && (!editing.id || JSON.stringify(editing) !== baseline);

  async function refresh() {
    const [result, images] = await Promise.all([briefingApi<{ drafts: EditorialDraft[] }>('drafts'), briefingApi<{ assets: typeof assets }>('assets')]);
    setDrafts(result.drafts); setAssets(images.assets);
  }
  useEffect(() => { refresh().catch(exception => setError(exception.message)); }, []);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  function open(draft: EditorialDraft) {
    if (dirty && !window.confirm('放弃尚未保存的草稿修改吗？')) return;
    setEditing(structuredClone(draft)); setBaseline(JSON.stringify(draft)); setReviewed(false); setPreview(false); setActiveItem(0); setError('');
  }
  async function execute(work: () => Promise<void>) {
    setBusy(true); setError(''); setMessage('');
    try { await work(); } catch (exception) { setError(exception instanceof Error ? exception.message : '操作未完成'); }
    finally { setBusy(false); }
  }
  async function save() {
    if (!editing) return;
    const result = await briefingApi<{ draft: EditorialDraft }>(editing.id ? 'drafts/' + editing.id : 'drafts', { revision: editing.revision, issue: editing.issue, cover: editing.cover }, editing.id ? 'PUT' : 'POST');
    setEditing(result.draft); setBaseline(JSON.stringify(result.draft)); setReviewed(false); setMessage('草稿已保存，首页内容尚未改变。'); await refresh();
  }
  function newDraft() {
    const date = localToday();
    open({ id: '', revision: 0, status: 'draft', issue: { edition: { date, weekday: new Date().toLocaleDateString('zh-CN', { weekday: 'long', timeZone: 'Asia/Shanghai' }), label: '每日选刊', notice: '' }, items: [] }, cover: null, humanEdited: true, createdBy: 'human', updatedAt: '' });
  }
  function updateIssue(issue: BriefingIssue) { if (editing) { setEditing({ ...editing, issue }); setReviewed(false); } }
  function updateItem(item: BriefingItem) {
    if (!editing) return;
    updateIssue({ ...editing.issue, items: editing.issue.items.map((entry, index) => index === activeItem ? item : entry) });
  }
  function addItem() {
    if (!editing) return;
    const item: BriefingItem = { id: 'item-' + crypto.randomUUID().replaceAll('-', ''), category: channels.find(channel => channel.enabled)?.id ?? channels[0].id,
      title: '', originalTitle: '', summary: '', source: '', sourceOrg: '', sourceDate: localToday(), verifiedAt: localToday(), url: '', tags: [], highlights: [], readingNote: '', verificationUrls: [] };
    updateIssue({ ...editing.issue, items: [...editing.issue.items, item] }); setActiveItem(editing.issue.items.length);
  }
  async function editPublished(date: string) {
    if (dirty && !window.confirm('放弃尚未保存的草稿修改吗？')) return;
    const result = await briefingApi<{ draft: EditorialDraft }>('issues/' + date + '/draft', {});
    setEditing(result.draft); setBaseline(JSON.stringify(result.draft)); setReviewed(false); setPreview(false); setActiveItem(0); await refresh();
  }
  async function publish() {
    if (!editing || dirty || !reviewed) return;
    const result = await briefingApi<{ draft: EditorialDraft }>('drafts/' + editing.id + '/publish', { revision: editing.revision, reviewed: true });
    setEditing(result.draft); setBaseline(JSON.stringify(result.draft)); setMessage('已发布到本地首页预览。线上网站未变更。'); setReviewed(false); await refresh(); onPublished();
  }
  async function upload(file: File | undefined) {
    if (!file || !editing) return;
    if (file.size > 3000000) throw new Error('请使用 3 MB 以内的 PNG、JPEG 或 WebP 封面');
    const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = reject; reader.readAsDataURL(file); });
    const result = await briefingApi<{ cover: Cover }>('covers', { data });
    setEditing({ ...editing, cover: result.cover }); setReviewed(false); await refresh(); setMessage('封面已放入本地图片目录，保存草稿后可用于本期。');
  }

  return <section aria-label="选刊内容与审核" className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-lg font-semibold text-slate-800 dark:text-white">内容与审核</h3><p className="mt-2 text-xs leading-6 text-slate-500 dark:text-slate-400">草稿、人工编辑和发布都在这里管理。发布只更新本地网站目录。</p></div><div className="flex gap-2"><button className={actionStyle} disabled={busy} onClick={() => void execute(refresh)}>刷新列表</button><button className={actionStyle} disabled={busy} onClick={newDraft}><FilePlus size={14} />新建一期</button></div></div>
    {error && <p role="alert" className="rounded-xl bg-rose-50 p-4 text-xs leading-6 text-rose-700">{error}</p>}
    {message && <p role="status" className="rounded-xl bg-emerald-50 p-4 text-xs leading-6 text-emerald-700">{message}</p>}
    {editing ? <div className="space-y-5 rounded-3xl border border-white/60 bg-white/65 p-5 backdrop-blur-xl sm:p-7 dark:border-white/10 dark:bg-slate-800/70">
      <div className="flex flex-wrap items-center justify-between gap-3"><button className={actionStyle} onClick={() => { if (!dirty || window.confirm('放弃未保存的修改并返回列表吗？')) setEditing(null); }}><ArrowLeft size={14} />返回列表</button><span className="text-xs text-slate-500 dark:text-slate-400">{statusName[editing.status]} · {dirty ? '有未保存修改' : '已保存'}</span><div className="flex gap-2"><button className={actionStyle} onClick={() => setPreview(!preview)}><Eye size={14} />{preview ? '返回编辑' : '预览阅读'}</button><button className={actionStyle} disabled={!dirty || busy} onClick={() => void execute(save)}><Save size={14} />保存草稿</button></div></div>
      {preview ? <div className="space-y-6"><h4 className="text-lg font-semibold">{editing.issue.edition.date} · {editing.issue.edition.label}</h4>{editing.cover && <img src={'http://127.0.0.1:3221' + editing.cover.src} alt={editing.cover.alt} className="max-h-64 w-full rounded-2xl object-cover" />}<p className="text-sm leading-8 text-slate-500 dark:text-slate-400">{editing.issue.edition.notice}</p>{editing.issue.items.map(item => <article key={item.id} className="space-y-3 border-t border-slate-200 pt-5 dark:border-white/10"><p className="text-xs text-indigo-500">{channels.find(channel => channel.id === item.category)?.name} · {item.sourceDate}</p><h4 className="text-lg font-semibold">{item.title || '尚未填写标题'}</h4><p className="whitespace-pre-wrap text-sm leading-8">{item.summary}</p><ul className="list-disc space-y-2 pl-5 text-sm leading-7">{item.highlights.map((line, index) => <li key={index}>{line}</li>)}</ul><p className="text-sm leading-7 text-slate-500 dark:text-slate-400">{item.readingNote}</p>{/^https?:\/\//.test(item.url) && <a className="text-xs text-indigo-500" href={item.url} target="_blank" rel="noreferrer">查看原文：{item.source}</a>}</article>)}</div> : <>
        <div className="grid gap-4 sm:grid-cols-2"><Field label="期刊日期"><input className={inputStyle} type="date" disabled={Boolean(editing.id)} value={editing.issue.edition.date.replaceAll('.', '-')} onChange={event => updateIssue({ ...editing.issue, edition: { ...editing.issue.edition, date: event.target.value.replaceAll('-', '.'), weekday: event.target.value ? new Date(event.target.value + 'T12:00:00+08:00').toLocaleDateString('zh-CN', { weekday: 'long', timeZone: 'Asia/Shanghai' }) : '' } })} /></Field><Field label="本期名称"><input className={inputStyle} value={editing.issue.edition.label} maxLength={80} onChange={event => updateIssue({ ...editing.issue, edition: { ...editing.issue.edition, label: event.target.value } })} /></Field></div>
        <Field label="本期导读"><textarea className={inputStyle} rows={3} value={editing.issue.edition.notice} onChange={event => updateIssue({ ...editing.issue, edition: { ...editing.issue.edition, notice: event.target.value } })} /></Field>
        <div className="grid gap-4 sm:grid-cols-2"><Field label="期刊封面"><select className={inputStyle} value={editing.cover?.src ?? ''} onChange={event => { setEditing({ ...editing, cover: event.target.value ? { src: event.target.value, alt: editing.cover?.alt ?? '' } : null }); setReviewed(false); }}><option value="">使用默认封面</option>{editing.cover && !assets.some(asset => asset.src === editing.cover?.src) && <option value={editing.cover.src}>{editing.cover.src}</option>}{assets.map(asset => <option key={asset.src} value={asset.src}>{asset.name}</option>)}</select></Field><Field label="上传新封面（最多 3 MB）"><input className={inputStyle} disabled={busy} type="file" accept="image/png,image/jpeg,image/webp" onChange={event => { const file = event.target.files?.[0]; void execute(() => upload(file)); event.target.value = ''; }} /></Field></div>
        {editing.cover && <Field label="封面图片说明"><input className={inputStyle} value={editing.cover.alt} onChange={event => { setEditing({ ...editing, cover: { ...editing.cover!, alt: event.target.value } }); setReviewed(false); }} /></Field>}
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 pt-5 dark:border-white/10">{editing.issue.items.map((item, index) => <button key={item.id} className={actionStyle + (activeItem === index ? ' ring-2 ring-indigo-400' : '')} onClick={() => setActiveItem(index)}>条目 {index + 1}</button>)}<button className={actionStyle} disabled={editing.issue.items.length >= maxItems} onClick={addItem}><Plus size={14} />添加条目</button><span className="text-xs text-slate-500 dark:text-slate-400">每期最多 {maxItems} 条，可在“选题与栏目”调整。</span></div>
        {editing.issue.items[activeItem] ? <ItemEditor key={editing.issue.items[activeItem].id} item={editing.issue.items[activeItem]} channels={channels} onChange={updateItem} onRemove={() => { updateIssue({ ...editing.issue, items: editing.issue.items.filter((_, index) => index !== activeItem) }); setActiveItem(Math.max(0, activeItem - 1)); }} /> : <p className="py-6 text-sm text-slate-500">尚无条目，点击“添加条目”开始整理。空草稿可以先保存。</p>}
      </>}
      <div className="space-y-4 border-t border-slate-200 pt-5 dark:border-white/10"><label className="flex items-start gap-3 text-xs leading-7 text-slate-600 dark:text-slate-300"><input type="checkbox" className="mt-2 accent-indigo-600" checked={reviewed} disabled={dirty || !editing.id || busy || editing.status === 'published'} onChange={event => setReviewed(event.target.checked)} /><span>我已核对本期内容、日期和原文来源，同意更新本地首页预览。{dirty && ' 请先保存草稿，再确认审核。'}</span></label><div className="flex flex-wrap gap-3"><button className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 text-xs text-white disabled:opacity-40" disabled={busy || dirty || !reviewed || !editing.id || editing.status === 'published'} onClick={() => void execute(publish)}><Check size={14} />发布到本地预览</button>{editing.status === 'published' && <button className={actionStyle} disabled={busy || dirty} onClick={() => { if (window.confirm('从本地首页撤下这一期？草稿和操作记录会保留，线上网站不会改变。')) void execute(async () => { const result = await briefingApi<{ draft: EditorialDraft }>('drafts/' + editing.id + '/withdraw', { revision: editing.revision }); setEditing(result.draft); setBaseline(JSON.stringify(result.draft)); setMessage('已从本地预览撤下，草稿仍然保留。'); await refresh(); onPublished(); }); }}>从本地预览撤下</button>}</div></div>
    </div> : <>
      <h4 className="text-sm font-semibold">草稿与本地发布记录（{drafts.length}）</h4><div className="space-y-3">{drafts.map(draft => <button key={draft.id} className="flex w-full items-center justify-between gap-3 rounded-2xl border border-white/60 bg-white/60 p-5 text-left dark:border-white/10 dark:bg-slate-800/60" onClick={() => open(draft)}><div><p className="text-sm font-medium">{draft.issue.edition.date} · {draft.issue.edition.label}</p><p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{draft.createdBy === 'human' ? '人工建立' : draft.createdBy} · {draft.humanEdited ? '包含人工编辑，Agent 不可覆盖' : 'Agent 提交'}</p></div><span className="shrink-0 text-xs text-indigo-500">{statusName[draft.status]}</span></button>)}{drafts.length === 0 && <p className="rounded-2xl bg-white/40 p-5 text-xs leading-7 text-slate-500 dark:text-slate-400">还没有草稿。可以新建一期，或从下方历史选刊建立编辑副本。</p>}</div>
      <h4 className="pt-3 text-sm font-semibold">网站现有选刊（{issues.length}）</h4><input aria-label="搜索历史选刊" className={inputStyle} placeholder="搜索日期或标题" value={filter} onChange={event => setFilter(event.target.value)} /><div className="space-y-3">{issues.filter(issue => !filter || JSON.stringify(issue).toLowerCase().includes(filter.toLowerCase())).map(issue => <div key={issue.edition.date} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/60 bg-white/60 p-5 dark:border-white/10 dark:bg-slate-800/60"><div className="min-w-0 flex-1"><p className="text-sm font-medium">{issue.edition.date} · {issue.items.length} 条</p><p className="mt-2 truncate text-xs text-slate-500 dark:text-slate-400">{issue.items[0]?.title}</p></div><button className={actionStyle} disabled={busy} onClick={() => void execute(() => editPublished(issue.edition.date))}>打开编辑草稿</button></div>)}</div>
    </>}
  </section>;
}

function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="block"><span className="mb-2 block text-xs font-medium text-slate-600 dark:text-slate-300">{label}</span>{children}</label>; }
function Lines({ label, value, onChange }: { label: string; value: string[]; onChange: (value: string[]) => void }) {
  const joined = value.join('\n');
  const [text, setText] = useState(joined);
  useEffect(() => setText(joined), [joined]);
  return <Field label={label}><textarea className={inputStyle} rows={3} value={text} onChange={event => { setText(event.target.value); onChange(event.target.value.split('\n').map(line => line.trim()).filter(Boolean)); }} /></Field>;
}
function ItemEditor({ item, channels, onChange, onRemove }: { item: BriefingItem; channels: Props['channels']; onChange: (item: BriefingItem) => void; onRemove: () => void }) {
  const update = (key: keyof BriefingItem, value: unknown) => onChange({ ...item, [key]: value });
  return <div className="space-y-4"><div className="flex items-center justify-between gap-3"><Field label="所属栏目"><select className={inputStyle} value={item.category} onChange={event => update('category', event.target.value)}>{channels.map(channel => <option key={channel.id} value={channel.id}>{channel.name}</option>)}</select></Field><button className={actionStyle} onClick={() => { if (window.confirm('从这份草稿移除此条内容？保存和发布前，网站上的内容仍然保留。')) onRemove(); }}><Trash2 size={14} />移除此条</button></div>{(['title', 'originalTitle', 'source', 'sourceOrg', 'url', 'doi'] as const).map((key, index) => <Field key={key} label={['内容标题', '原文标题', '来源名称', '来源机构', '原文网址', 'DOI（选填）'][index]}><input className={inputStyle} value={item[key] ?? ''} onChange={event => update(key, event.target.value)} /></Field>)}<div className="grid gap-4 sm:grid-cols-2">{(['sourceDate', 'verifiedAt'] as const).map((key, index) => <Field key={key} label={index === 0 ? '原文日期' : '核对日期'}><input type="date" className={inputStyle} value={(item[key] ?? '').replaceAll('.', '-')} onChange={event => update(key, event.target.value.replaceAll('-', '.'))} /></Field>)}</div><Field label="内容摘要"><textarea className={inputStyle} rows={5} value={item.summary} onChange={event => update('summary', event.target.value)} /></Field><Lines label="内容要点（每行一条）" value={item.highlights} onChange={value => update('highlights', value)} /><Lines label="主题标签（每行一个）" value={item.tags} onChange={value => update('tags', value)} /><Field label="写在页边"><textarea className={inputStyle} rows={3} value={item.readingNote} onChange={event => update('readingNote', event.target.value)} /></Field><Lines label="核对来源网址（每行一个，发布前必填）" value={item.verificationUrls ?? []} onChange={value => update('verificationUrls', value)} /></div>;
}
