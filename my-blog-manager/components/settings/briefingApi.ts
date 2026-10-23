export async function briefingApi<T>(endpoint: string, value?: unknown, method = 'POST'): Promise<T> {
  const response = await fetch('/api/briefing/' + endpoint, value === undefined ? { cache: 'no-store' } : {
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(typeof result.detail === 'string' ? result.detail : '操作未完成，请重试');
  return result;
}

export type BriefingItem = {
  id: string; category: string; title: string; originalTitle: string; summary: string; source: string;
  sourceOrg?: string; sourceDate: string; verifiedAt?: string; url: string; tags: string[];
  highlights: string[]; readingNote: string; verificationUrls?: string[]; doi?: string;
};
export type BriefingIssue = { edition: { date: string; weekday: string; label: string; notice: string }; items: BriefingItem[] };
export type Cover = { src: string; alt: string; [key: string]: unknown };
export type EditorialDraft = { id: string; revision: number; status: 'draft' | 'published' | 'withdrawn'; issue: BriefingIssue; cover: Cover | null; humanEdited: boolean; createdBy: string; updatedAt: string };
export const localToday = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' }).replaceAll('-', '.');
export const inputStyle = 'w-full rounded-xl border border-slate-200 bg-white/80 px-3 py-2.5 text-sm text-slate-700 outline-none focus:border-indigo-400 dark:border-white/15 dark:bg-slate-900/70 dark:text-slate-200';
export const actionStyle = 'inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white/70 px-4 py-2.5 text-xs text-slate-600 transition hover:border-indigo-300 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/15 dark:bg-slate-800/70 dark:text-slate-200';
