'use client';

import { useEffect, useState } from 'react';
import { actionStyle, inputStyle } from './briefingApi';

export default function BriefingConnectionGuide({ reviewMode }: { reviewMode: boolean }) {
  const [connectionPath, setConnectionPath] = useState('');
  const [origin, setOrigin] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => { setOrigin(window.location.origin); }, []);
  const path = connectionPath.trim().replace(/^"(.*)"$/, '$1');
  const location = path ? JSON.stringify(path) : '【先填写下方连接文件的完整路径】';
  const common = `本机选刊连接文件路径：${location}。
使用配套 briefing_agent.py 客户端；可从 ${origin}/briefing_agent.py 下载到博客源码之外的本机工作目录，先检查脚本再运行。
连接文件由客户端读取；不要把 token 或连接文件全文输出到对话、日志、任务材料或 Git 仓库。不要修改连接文件的地址，不要把授权发送到其他地址。
电脑和本机选刊后台需要运行。若连接失败，报告原因，停止后续操作。`;
  const connectPrompt = `请帮我验证每日选刊的本机连接。
${common}
只运行客户端的 config 和 history 两个只读操作，报告连接是否成功、当前启用栏目，以及今天是否已有内容或草稿。不要生成、提交、发布内容，也不要修改配置或定时任务。`;
  const draftPrompt = `请按我的设置整理一期每日选刊，提交为待审核草稿。
${common}
先读取 config，确认 publishMode 为 review；否则停止，请我在控制台切回“存为草稿，由我审核”。
运行 prepare --output 准备一个新的任务目录，读取 TASK.md、selection.json、history.json、issue.schema.json。日期以北京时间今天为准。
如果今天已有期刊或草稿，停止并报告，不换日期、不覆盖、不绕过冲突。
按任务文件查找并核对真实原始来源，领域和栏目以我的设置为准。无法核实就跳过，不编造、不凑数；没有可用内容则停止提交。
将结果保存为符合 issue.schema.json 的 JSON，使用 submit --issue 提交，同一轮重试保持同一个 --request-id，然后查询 receipt 确认结果。
最后只报告回执编号、草稿日期、条目数及待审核状态。不要修改网站文件、推送 Git、发布上线或建立定时任务。`;
  async function copy(value: string) {
    try { await navigator.clipboard.writeText(value); setNotice('已复制。到 Codex 粘贴并发送这段指令；这里不会自动启动 Agent。'); }
    catch { setNotice('复制未完成，请展开下方指令，手动选择并复制。'); }
  }
  return <section id="briefing-connection-guide" aria-label="连接文件使用引导" className="scroll-mt-24 space-y-5 rounded-3xl border border-indigo-200/80 bg-indigo-50/70 p-5 sm:p-6 dark:border-indigo-400/20 dark:bg-indigo-950/30">
    <div><h3 className="text-base font-semibold">下载 JSON 后，接下来怎么用？</h3><p className="mt-2 text-xs leading-7 text-slate-600 dark:text-slate-300">这是本机选刊的访问凭据，由配套客户端读取。你把文件路径交给 Codex，授权内容留在本机。下载文件后还需要完成一次连接测试。</p></div>
    <ol className="space-y-5 text-xs leading-7">
      <li><h4 className="font-semibold">1 · 保存连接文件</h4><p className="text-slate-600 dark:text-slate-300">把下载的 <code>briefing-….connection.json</code> 放在博客源码之外的独立文件夹。保留文件名和内容；丢失后可撤销旧授权，再建立一份。无需导入 Codex 设置，也不用把 JSON 全文粘贴到对话。</p></li>
      <li><h4 className="font-semibold">2 · 开启接收并保存</h4><p className="text-slate-600 dark:text-slate-300">勾选上方“允许 Agent 向本机提交选刊”，先选“存为草稿，由我审核”，再点页面上方“保存本地设置”。电脑和后台保持运行，网页可以关闭。</p></li>
      <li className="space-y-3"><div><h4 className="font-semibold">3 · 把连接测试交给 Codex</h4><p className="text-slate-600 dark:text-slate-300">在文件资源管理器中选中刚下载的 JSON，右键“复制文件地址”（或按住 Shift 右键“复制为路径”），粘贴在这里。这里只记录路径，不会上传或读取授权文件。</p></div>
        <label className="block">连接文件完整路径<input className={inputStyle + ' mt-2'} value={connectionPath} onChange={event => { setConnectionPath(event.target.value); setNotice(''); }} autoComplete="off" spellCheck={false} placeholder={'例如 C:\\Users\\你的用户名\\Downloads\\briefing-xxx.connection.json'} /></label>
        <div className="flex flex-wrap gap-3"><button type="button" className={actionStyle} disabled={!path || !origin} onClick={() => void copy(connectPrompt)}>复制首次连接指令</button><a className={actionStyle} href="/briefing_agent.py" download="briefing_agent.py">下载配套客户端（可选）</a></div>
        <p className="text-slate-600 dark:text-slate-300">把复制的指令粘贴到 Codex 并发送，它会先准备客户端，再尝试读取偏好和历史；首次测试只读。已有客户端时也可继续使用，无需重复下载。</p>
        <details><summary className="cursor-pointer font-medium">查看首次连接指令 / 手动复制</summary><pre className="mt-3 max-h-72 overflow-y-auto whitespace-pre-wrap break-words rounded-xl bg-white/60 p-4 text-xs leading-6 dark:bg-slate-900/60">{connectPrompt}</pre></details>
      </li>
      <li className="space-y-3"><div><h4 className="font-semibold">4 · 确认接通，再整理一期</h4><p className="text-slate-600 dark:text-slate-300">Codex 报告读取成功后，点击上方“刷新接入记录”。授权卡片出现“最近访问”表示凭据已被使用；收到草稿还要以“接收提交”记录及“内容与审核”中的草稿为准。</p></div>
        <button type="button" className={actionStyle} disabled={!path || !origin || !reviewMode} onClick={() => void copy(draftPrompt)}>复制整理一期指令</button>
        {!reviewMode && <p className="text-amber-700 dark:text-amber-300">先把“收到内容后”切回“存为草稿，由我审核”并保存，即可复制草稿指令。</p>}
        <details><summary className="cursor-pointer font-medium">查看整理一期指令 / 手动复制</summary><pre className="mt-3 max-h-72 overflow-y-auto whitespace-pre-wrap break-words rounded-xl bg-white/60 p-4 text-xs leading-6 dark:bg-slate-900/60">{draftPrompt}</pre></details>
        <p className="text-slate-600 dark:text-slate-300">如果当天已有内容，Agent 会停止。首次接通不会自动创建每日任务；定时更新需在验证后单独设置。DSH 本次暂不接入。</p>
      </li>
    </ol>
    {notice && <p role="status" className="rounded-xl bg-white/70 p-3 text-xs leading-7 dark:bg-slate-900/60">{notice}</p>}
    <details className="text-xs leading-7 text-slate-600 dark:text-slate-300"><summary className="cursor-pointer font-medium">连接失败时怎么处理？</summary><ul className="mt-2 list-disc space-y-1 pl-5"><li>无法连接：确认后台已启动，电脑保持开机。</li><li>接收关闭：勾选接收开关后，再点“保存本地设置”。</li><li>授权无效或已撤销：下载的新文件需与当前有效授权对应；遗失时撤销旧授权，重新建立。</li><li>文件不存在：重新复制完整路径，确认是连接 JSON，而不是客户端脚本。</li><li>当天内容冲突：到“内容与审核”检查已有草稿或期刊，保留原内容。</li></ul></details>
  </section>;
}
