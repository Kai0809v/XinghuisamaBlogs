'use client';

import { useEffect, useState } from 'react';
import { briefingApi, inputStyle, actionStyle } from './briefingApi';
import BriefingConnectionGuide from './BriefingConnectionGuide';

type AgentSettings = { enabled: boolean; publishMode: string; preferredTime: string };
type Agent = { id: string; name: string; active: boolean; createdAt: string; lastSeen: string | null };
type Event = { id: string; at: string; action: string; actor: string; message: string };
const actions: Record<string, string> = {
  'draft.created': '建立草稿', 'draft.saved': '保存人工修改', 'issue.published.local': '发布到本地',
  'issue.withdrawn.local': '从本地撤下', 'agent.authorized': '建立 Agent 授权', 'agent.revoked': '撤销 Agent 授权',
  'submission.accepted': '接收提交', 'submission.conflict': '已有内容，拒绝覆盖', 'submission.failed': '提交失败',
};

export default function BriefingAgentPanel({ settings, onChange }: { settings: AgentSettings; onChange: (settings: AgentSettings) => void }) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [name, setName] = useState('Codex');
  const [credential, setCredential] = useState<{ agent: Agent; token: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function load() {
    const [access, log] = await Promise.all([briefingApi<{ agents: Agent[] }>('agents'), briefingApi<{ events: Event[] }>('events')]);
    setAgents(access.agents); setEvents(log.events);
  }
  useEffect(() => { load().catch(exception => setError(exception.message)); }, []);
  async function run(work: () => Promise<void>) {
    setBusy(true); setError('');
    try { await work(); } catch (exception) { setError(exception instanceof Error ? exception.message : '操作未完成'); }
    finally { setBusy(false); }
  }
  async function download() {
    if (!credential) return;
    const info = await briefingApi<{ baseUrl: string }>('connection-info');
    const value = { version: 1, baseUrl: info.baseUrl, token: credential.token, agentId: credential.agent.id, agentName: credential.agent.name, scope: 'local-website' };
    const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'briefing-' + credential.agent.id + '.connection.json'; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <div className="space-y-5 text-slate-700 dark:text-slate-200">
    {error && <p role="alert" className="rounded-xl bg-rose-50 p-4 text-xs leading-6 text-rose-700">{error}</p>}
    <section className="space-y-6 rounded-3xl border border-white/60 bg-white/65 p-6 backdrop-blur-xl dark:border-white/10 dark:bg-slate-800/70"><h3 className="text-lg font-semibold">Agent 接入与更新</h3><p className="text-xs leading-7 text-slate-500 dark:text-slate-400">本机提交接口已可用。每个 Agent 使用独立授权，先读取选题和历史，再提交内容。网站本身不调用模型。</p><label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1.5 accent-indigo-600" checked={settings.enabled} onChange={event => onChange({ ...settings, enabled: event.target.checked })} /><span>允许 Agent 向本机提交选刊<span className="mt-2 block text-xs leading-6 text-slate-500 dark:text-slate-400">与首页展示独立。更改后请点上方“保存本地设置”，关闭后所有 Agent 均无法访问提交接口。</span></span></label><div className="grid gap-5 sm:grid-cols-2"><label className="block text-xs">收到内容后<select className={inputStyle + ' mt-2'} value={settings.publishMode} onChange={event => onChange({ ...settings, publishMode: event.target.value })}><option value="review">存为草稿，由我审核</option><option value="auto">校验后自动发布到本地预览</option></select></label><label className="block text-xs">期望更新时间<input className={inputStyle + ' mt-2'} type="time" value={settings.preferredTime} onChange={event => onChange({ ...settings, preferredTime: event.target.value })} /></label></div><p className="rounded-2xl bg-amber-50/90 p-4 text-xs leading-7 text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">此处不会创建或修改定时任务。现有每日任务仍按原流程运行。当前发布只写本地网站目录；上线请使用原有同步与发布流程。电脑、本机后台及负责生成内容的 Agent 需要运行；控制台网页可以关闭。</p></section>
    <section className="space-y-5 rounded-3xl border border-white/60 bg-white/65 p-6 backdrop-blur-xl dark:border-white/10 dark:bg-slate-800/70"><div className="flex flex-wrap justify-between gap-3"><h3 className="text-base font-semibold">Agent 授权</h3><a className={actionStyle} href="#briefing-connection-guide">JSON 怎么用？</a><button className={actionStyle} disabled={busy} onClick={() => void run(load)}>刷新接入记录</button></div><p className="text-xs leading-7 text-slate-500 dark:text-slate-400">授权只允许读取选题和公开历史、提交新草稿、查询自己的结果。不能修改控制台配置、人工草稿或已有期刊。DSH 本次暂不接入。</p><div className="flex flex-wrap gap-3"><input aria-label="Agent 名称" className={inputStyle + ' min-w-40 flex-1'} maxLength={40} value={name} onChange={event => setName(event.target.value)} /><button className={actionStyle} disabled={busy || !name.trim() || credential !== null} onClick={() => void run(async () => { const result = await briefingApi<{ agent: Agent; token: string }>('agents', { name }); setCredential(result); await load(); })}>建立独立授权</button></div>
      {credential && <div className="space-y-4 rounded-2xl border border-indigo-200 bg-indigo-50/70 p-5 dark:border-indigo-400/20 dark:bg-indigo-950/40"><p className="text-xs leading-7">{credential.agent.name} 的连接文件已就绪。授权内容仅在此处提供一次；请保存到本机供客户端使用，不要放进博客源码或提交到 GitHub。</p><button className={actionStyle} onClick={() => void run(download)}>下载本机连接文件</button><button className={actionStyle + ' ml-2'} onClick={() => { if (window.confirm('确认已保存连接文件？关闭后无法再次下载这份授权，可随时撤销并重新建立。')) setCredential(null); }}>已保存，关闭提示</button></div>}
      <div className="space-y-3">{agents.map(agent => <div key={agent.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200/60 p-4 dark:border-white/10"><div><p className="text-sm font-medium">{agent.name} · {agent.active ? '授权有效' : '已撤销'}</p><p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{agent.lastSeen ? '最近访问：' + new Date(agent.lastSeen).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '尚未通过接口连接'}</p></div><button className={actionStyle} disabled={!agent.active || busy} onClick={() => { if (window.confirm('撤销 ' + agent.name + ' 的本机授权？该 Agent 将立即失去访问权限，历史内容保留。')) void run(async () => { await briefingApi('agents/' + agent.id + '/revoke', {}); if (credential?.agent.id === agent.id) setCredential(null); await load(); }); }}>撤销授权</button></div>)}{agents.length === 0 && <p className="text-xs text-slate-500 dark:text-slate-400">还没有 Agent 授权，手工编辑不受影响。</p>}</div>
    </section>
    <BriefingConnectionGuide reviewMode={settings.publishMode === 'review'} />
    <section className="space-y-4 rounded-3xl border border-white/60 bg-white/65 p-6 backdrop-blur-xl dark:border-white/10 dark:bg-slate-800/70"><h3 className="text-base font-semibold">操作与提交记录</h3><p className="text-xs leading-6 text-slate-500 dark:text-slate-400">记录真实接收、保存、冲突、发布和撤销结果。刷新列表可查看最新状态。</p><div className="max-h-96 space-y-3 overflow-y-auto">{events.map(event => <div key={event.id} className="border-b border-slate-200/50 pb-3 text-xs leading-6 dark:border-white/10"><p>{actions[event.action] ?? event.action}<span className="ml-3 text-slate-500 dark:text-slate-400">{event.actor === 'human' ? '人工操作' : event.actor}</span></p>{event.message && <p className="break-words text-slate-500 dark:text-slate-400">{event.message}</p>}<p className="text-[11px] text-slate-400">{new Date(event.at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</p></div>)}{events.length === 0 && <p className="text-xs text-slate-400">暂无操作记录。</p>}</div></section>
  </div>;
}
