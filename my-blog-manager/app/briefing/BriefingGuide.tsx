'use client';

import { ArrowRight, BookOpen, Check, CircleHelp, Eye, Save, Settings2, X } from 'lucide-react';

type Props = {
  connected: boolean; loading: boolean; busy: boolean; dirty: boolean; previewUrl: string;
  onNavigate: (tab: 'display' | 'selection') => void;
  onSave: () => void; onRetry: () => void; onDismiss: (remember: boolean) => void;
};

export default function BriefingGuide({ connected, loading, busy, dirty, previewUrl, onNavigate, onSave, onRetry, onDismiss }: Props) {
  return <section aria-labelledby="briefing-guide-title" className="mb-7 overflow-hidden rounded-3xl border border-indigo-200/80 bg-white/85 shadow-sm backdrop-blur-2xl dark:border-indigo-400/25 dark:bg-slate-900/90">
    <div className="flex items-start justify-between gap-4 border-b border-indigo-100 px-6 py-5 dark:border-white/10">
      <div><p className="mb-2 flex items-center gap-2 text-xs text-indigo-600 dark:text-indigo-300"><BookOpen size={15} />首次使用 · 从这里开始</p><h2 id="briefing-guide-title" className="text-lg font-semibold text-slate-800 dark:text-white">三步，整理你的每日选刊</h2><p className="mt-2 text-xs leading-6 text-slate-500 dark:text-slate-400">可以先沿用已有内容，也可以从任何感兴趣的领域开始。不需要先连接 AI。</p></div>
      <button aria-label="暂时收起使用引导" onClick={() => onDismiss(false)} className="rounded-xl p-2 text-slate-500 hover:bg-indigo-50 dark:text-slate-400 dark:hover:bg-white/10"><X size={17} /></button>
    </div>
    <div className="px-6 py-5">
      <div role="status" className="mb-5 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 px-4 py-3 text-xs dark:bg-slate-800/60"><span className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${connected ? 'bg-emerald-500' : loading ? 'bg-amber-400' : 'bg-rose-400'}`} />{connected ? '已读取本机配置，可以开始设置' : loading ? '正在读取本机配置…' : '尚未连接本机选刊服务'}</span>{!connected && !loading && <button disabled={busy} className="font-medium text-indigo-600 disabled:opacity-40 dark:text-indigo-300" onClick={onRetry}>重新连接</button>}</div>
      {!connected && !loading && <p className="mb-5 text-xs leading-7 text-slate-500 dark:text-slate-400">请先运行随预览提供的“启动选刊控制台预览”，再点“重新连接”。电脑和本机后台需要保持运行，控制台页面可以关闭。</p>}
      <ol className="grid gap-4 md:grid-cols-3">
        <li className="flex flex-col rounded-2xl border border-slate-200/70 p-5 dark:border-white/10"><span className="mb-4 flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-50 font-mono text-sm text-indigo-600 dark:bg-indigo-400/10 dark:text-indigo-300">01</span><h3 className="text-sm font-semibold text-slate-700 dark:text-slate-100">决定首页怎么展示</h3><p className="mb-5 mt-2 flex-1 text-xs leading-7 text-slate-500 dark:text-slate-400">设置板块名称、简介和显示开关。关闭后隐藏入口，历史选刊仍然保留。</p><button disabled={!connected} onClick={() => onNavigate('display')} className="flex items-center gap-2 text-xs font-medium text-indigo-600 disabled:opacity-40 dark:text-indigo-300"><Eye size={14} />去设置展示<ArrowRight size={13} /></button></li>
        <li className="flex flex-col rounded-2xl border border-slate-200/70 p-5 dark:border-white/10"><span className="mb-4 flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-50 font-mono text-sm text-indigo-600 dark:bg-indigo-400/10 dark:text-indigo-300">02</span><h3 className="text-sm font-semibold text-slate-700 dark:text-slate-100">选择兴趣与栏目</h3><p className="mb-5 mt-2 flex-1 text-xs leading-7 text-slate-500 dark:text-slate-400">填写自己的主题、来源与栏目。已有个人配置可以保留，主题也可以暂时留空。</p><button disabled={!connected} onClick={() => onNavigate('selection')} className="flex items-center gap-2 text-xs font-medium text-indigo-600 disabled:opacity-40 dark:text-indigo-300"><Settings2 size={14} />去设置选题<ArrowRight size={13} /></button></li>
        <li className="flex flex-col rounded-2xl border border-slate-200/70 p-5 dark:border-white/10"><span className="mb-4 flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-50 font-mono text-sm text-indigo-600 dark:bg-indigo-400/10 dark:text-indigo-300">03</span><h3 className="text-sm font-semibold text-slate-700 dark:text-slate-100">保存，然后查看首页</h3><p className="mb-5 mt-2 flex-1 text-xs leading-7 text-slate-500 dark:text-slate-400">修改后点“保存本地设置”，再打开首页预览。只保存到本地网站目录，不会上线。</p>{dirty ? <button disabled={!connected || busy} onClick={onSave} className="flex items-center gap-2 text-xs font-medium text-indigo-600 disabled:opacity-40 dark:text-indigo-300"><Save size={14} />{busy ? '正在保存…' : '先保存本地设置'}</button> : connected && previewUrl ? <a href={previewUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-xs font-medium text-indigo-600 dark:text-indigo-300"><Eye size={14} />打开首页预览<ArrowRight size={13} /></a> : <span className="text-xs text-slate-400">可在“内容与审核”预览阅读；首页效果请启动网站展示端查看</span>}</li>
      </ol>
      <div className="mt-5 flex items-start gap-2 rounded-2xl bg-amber-50/80 p-4 text-xs leading-7 text-amber-800 dark:bg-amber-950/30 dark:text-amber-200"><CircleHelp size={15} className="mt-1.5 shrink-0" /><p><strong className="font-semibold">先从本地审核开始。</strong> 在“内容与审核”里编辑、预览和发布；需要 Agent 时再到“Agent 与更新”建立授权。填写更新时间不会创建定时任务，原来的每日任务继续运行。本地发布不会更新线上网站。</p></div>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3"><p className="text-[11px] leading-6 text-slate-500 dark:text-slate-400">以后可以点上方“使用引导”再次查看。收起引导不会保存或修改选刊设置。</p><button onClick={() => onDismiss(true)} className="flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-medium text-white transition hover:bg-indigo-500"><Check size={14} />我了解了，不再自动显示</button></div>
    </div>
  </section>;
}
