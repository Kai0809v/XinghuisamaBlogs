import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useToast } from '../ToastProvider';

// 🌟 壁纸分组的类型定义
interface BgGroup {
  id: string;
  name: string;
  images: string[];
}

export default function BackgroundSection({ formData, handleUpdate, pushToQueue }: any) {
  const { showToast } = useToast();
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  // 👈 新增状态：用来存放刚刚上传成功，但还没决定是否加入背景的图片 URL
  const [pendingImageUrl, setPendingImageUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 🌟 分组系统状态：当前正在编辑的分组 id、新建分组名、重命名状态
  const [editingId, setEditingId] = useState<string>('');
  const [newGroupName, setNewGroupName] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const groups: BgGroup[] = formData.bgGroups?.length ? formData.bgGroups : [];

  // 🌟 自动迁移：如果没有分组数据但存在旧版 bgImages，自动将其转为「默认」分组
  useEffect(() => {
    if (!formData.bgGroups?.length && formData.bgImages?.length) {
      handleUpdate('bgGroups', [{ id: 'default', name: '默认', images: [...formData.bgImages] }]);
      handleUpdate('activeBgGroup', formData.activeBgGroup || 'default');
    }
  }, []);

  // 🌟 编辑目标：优先用 editingId，否则回退到激活分组或第一个分组
  const editingGroup = groups.find(g => g.id === editingId) || groups.find(g => g.id === formData.activeBgGroup) || groups[0] || null;
  const displayImages: string[] = editingGroup?.images || [];

  // ============ 分组操作 ============
  const updateGroups = (newGroups: BgGroup[]) => handleUpdate('bgGroups', newGroups);

  const createGroup = () => {
    const name = newGroupName.trim();
    if (!name) { showToast("分组名称不能为空哦", "warning"); return; }
    if (groups.some(g => g.name === name)) { showToast("已经有同名的分组啦", "warning"); return; }
    const newGroup: BgGroup = { id: `bg-${Date.now()}`, name, images: [] };
    updateGroups([...groups, newGroup]);
    setEditingId(newGroup.id);
    setNewGroupName('');
    showToast(`✅ 分组「${name}」创建成功，快去添加壁纸吧！`, "success");
  };

  const removeGroup = (id: string) => {
    const target = groups.find(g => g.id === id);
    if (!target) return;
    if (groups.length <= 1) { showToast("至少要保留一个分组哦", "warning"); return; }
    if (id === formData.activeBgGroup) { showToast("使用中的分组不能删除，请先切换到其他分组", "warning"); return; }
    updateGroups(groups.filter(g => g.id !== id));
    if (editingId === id) setEditingId('');
    showToast(`已删除分组「${target.name}」`, "success");
  };

  const activateGroup = (id: string) => {
    handleUpdate('activeBgGroup', id);
    const target = groups.find(g => g.id === id);
    showToast(`✨ 已启用分组「${target?.name}」，前台将轮播该组壁纸`, "success");
  };

  const confirmRename = () => {
    const name = renameValue.trim();
    if (!name) { setRenamingId(null); return; }
    if (groups.some(g => g.name === name && g.id !== renamingId)) { showToast("已经有同名的分组啦", "warning"); return; }
    updateGroups(groups.map(g => g.id === renamingId ? { ...g, name } : g));
    setRenamingId(null);
    showToast("分组已重命名", "success");
  };

  // ============ 组内图片操作 ============
  const addImageToGroup = (url: string) => {
    if (!editingGroup) { showToast("请先选择一个分组", "warning"); return; }
    if (editingGroup.images.includes(url)) { showToast("这张图已经在该分组里啦", "warning"); return; }
    updateGroups(groups.map(g => g.id === editingGroup.id ? { ...g, images: [...g.images, url] } : g));
  };

  const removeImageFromGroup = (index: number) => {
    if (!editingGroup) return;
    updateGroups(groups.map(g => g.id === editingGroup.id ? { ...g, images: g.images.filter((_, i) => i !== index) } : g));
    showToast("已移除一张壁纸", "success");
  };

  const addBgUrl = () => {
    if (!formData.newBgUrl) {
      showToast("URL不能为空哦", "warning");
      return;
    }
    addImageToGroup(formData.newBgUrl);
    handleUpdate('newBgUrl', '');
    showToast("✅ 成功添加壁纸！", "success");
  };

  // 【核心功能】：真实的图床上传逻辑
  const handleFileUpload = async (file: File) => {
    const picUrl = formData.picBedUrl || "https://pic.dusays.com";
    const picToken = formData.picBedToken;

    if (!picToken) {
      showToast("⛔ 无法上传！请先在【图库配置管理】中填写图床 Token", "error");
      return;
    }
    if (!file.type.startsWith('image/')) {
      showToast("只能上传图片文件哦！", "warning");
      return;
    }

    setIsUploading(true);
    showToast("正在将图片传送至图床引擎...", "info");

    try {
      const configRes = await fetch(`/backend_config.json?t=${Date.now()}`);
      const configData = await configRes.json();

      // 构建 multipart/form-data
      const uploadData = new FormData();
      uploadData.append('file', file);
      uploadData.append('url', picUrl);
      uploadData.append('token', picToken);

      const res = await fetch(`http://127.0.0.1:${configData.api_port}/api/picbed/upload`, {
        method: 'POST',
        body: uploadData,
      });

      const data = await res.json();
      if (data.success && data.url) {
        showToast("🎉 图片上传成功！请确认是否加入分组", "success");
        // 👈 上传成功，拿到真实 URL，触发确认面板
        setPendingImageUrl(data.url);
      } else {
        showToast(`上传失败: ${data.message}`, "error");
      }
    } catch (error) {
      showToast("无法连接到 Python 引擎上传通道", "error");
    } finally {
      setIsUploading(false);
    }
  };

  // 确认或取消加入分组
  const confirmAddPendingImage = () => {
    if (pendingImageUrl) {
      addImageToGroup(pendingImageUrl);
      showToast(`✅ 已加入分组「${editingGroup?.name}」！`, "success");
      setPendingImageUrl(null);
    }
  };

  const cancelPendingImage = () => {
    setPendingImageUrl(null);
    showToast("已取消操作，但图片已保存在图床中", "info");
  };

  const onDragOver = (e: any) => { e.preventDefault(); setIsDragging(true); };
  const onDragLeave = (e: any) => { e.preventDefault(); setIsDragging(false); };
  const onDrop = (e: any) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  };

  return (
    <motion.section initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} className="bg-white/40 dark:bg-slate-900/40 backdrop-blur-2xl border border-white/50 dark:border-slate-800/50 rounded-[40px] p-8 shadow-2xl flex flex-col gap-8 relative overflow-hidden">

      <header className="flex justify-between items-end relative z-10">
        <div>
          <h2 className="text-xl font-black text-slate-800 dark:text-white flex items-center gap-2">🌌 视觉背景配置</h2>
          <p className="text-[10px] font-bold text-slate-400 mt-2 uppercase">壁纸分组管理 · 启用的分组将在前台轮播播放</p>
        </div>
        <button onClick={() => pushToQueue('视觉背景分组', 'bgGroups', formData.bgGroups)} className="px-6 py-2 bg-indigo-500 text-white rounded-xl text-xs font-black shadow-lg shadow-indigo-500/20 active:scale-95 transition-all">
          暂存背景修改
        </button>
      </header>

      {/* 🌟 分组管理区 */}
      <div className="bg-white/50 dark:bg-slate-800/50 rounded-3xl p-5 border border-white/40 dark:border-slate-700/50 shadow-sm">
        <p className="text-[10px] font-black text-slate-400 uppercase mb-3">📁 壁纸分组（点击卡片切换编辑，点击 ⭐ 启用分组）</p>
        <div className="flex flex-wrap gap-3">
          <AnimatePresence>
            {groups.map((group) => {
              const isActive = group.id === formData.activeBgGroup;
              const isEditing = group.id === editingGroup?.id;
              return (
                <motion.div
                  key={group.id}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  className={`relative rounded-2xl px-4 py-3 border-2 transition-all cursor-pointer min-w-[140px] ${isActive
                    ? 'border-pink-400 bg-pink-50/80 dark:bg-pink-500/10'
                    : isEditing
                      ? 'border-indigo-400 bg-indigo-50/80 dark:bg-indigo-500/10'
                      : 'border-slate-200 dark:border-slate-600 hover:border-indigo-300'
                    }`}
                  onClick={() => setEditingId(group.id)}
                >
                  <div className="flex items-center justify-between gap-3">
                    {renamingId === group.id ? (
                      <input
                        autoFocus
                        type="text"
                        value={renameValue}
                        onChange={e => setRenameValue(e.target.value)}
                        onBlur={confirmRename}
                        onKeyDown={e => e.key === 'Enter' && confirmRename()}
                        onClick={e => e.stopPropagation()}
                        className="w-24 bg-white dark:bg-slate-900 rounded-lg px-2 py-1 text-xs outline-none border border-indigo-300"
                      />
                    ) : (
                      <span
                        className="text-sm font-black text-slate-700 dark:text-slate-200"
                        onClick={e => { e.stopPropagation(); setRenamingId(group.id); setRenameValue(group.name); }}
                        title="点击重命名"
                      >
                        {group.name}
                      </span>
                    )}
                    <span className="text-[10px] font-bold text-slate-400">{group.images.length} 张</span>
                  </div>
                  {isActive && <p className="text-[10px] font-black text-pink-500 mt-1">⭐ 使用中</p>}

                  <div className="absolute -top-2 -right-2 flex gap-1">
                    <button
                      onClick={e => { e.stopPropagation(); activateGroup(group.id); }}
                      title={isActive ? '当前使用中' : '启用此分组'}
                      className={`w-6 h-6 rounded-full text-[10px] font-black shadow-md transition-all ${isActive ? 'bg-pink-500 text-white cursor-default' : 'bg-white dark:bg-slate-700 text-amber-400 hover:bg-amber-400 hover:text-white'}`}
                    >
                      ⭐
                    </button>
                    <button
                      onClick={e => { e.stopPropagation(); removeGroup(group.id); }}
                      title="删除分组"
                      className="w-6 h-6 rounded-full bg-white dark:bg-slate-700 text-red-400 hover:bg-red-500 hover:text-white text-[10px] font-black shadow-md transition-all"
                    >
                      ✕
                    </button>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>

          {/* 新建分组 */}
          <div className="rounded-2xl px-4 py-3 border-2 border-dashed border-slate-300 dark:border-slate-600 flex items-center gap-2">
            <input
              type="text"
              placeholder="新分组名称"
              value={newGroupName}
              onChange={e => setNewGroupName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && createGroup()}
              className="w-24 bg-transparent text-xs outline-none placeholder:text-slate-400"
            />
            <button onClick={createGroup} className="px-3 py-1.5 bg-emerald-500 text-white rounded-xl text-xs font-black shadow-lg shadow-emerald-500/20 active:scale-95">
              + 新建
            </button>
          </div>
        </div>
      </div>

      {/* 当前编辑分组的图片管理 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 relative z-10">
        <div className="bg-slate-100/50 dark:bg-slate-800/50 rounded-3xl p-6 custom-scrollbar max-h-[450px] overflow-y-auto">
          <p className="text-[10px] font-black text-slate-400 uppercase mb-3">
            🖼️ 分组「{editingGroup?.name || '未选择'}」的壁纸 ({displayImages.length} 张)
          </p>
          <div className="grid grid-cols-2 gap-4">
            <AnimatePresence>
              {displayImages.map((url: string, index: number) => (
                <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }} key={index} className="relative group rounded-2xl overflow-hidden aspect-video shadow-md border border-white/20">
                  <img src={url} alt={`bg-${index}`} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" />
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center backdrop-blur-sm">
                    <button onClick={() => removeImageFromGroup(index)} className="w-10 h-10 bg-red-500 text-white rounded-full flex items-center justify-center font-bold shadow-xl hover:bg-red-600 scale-0 group-hover:scale-100 transition-transform">✕</button>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
          {displayImages.length === 0 && (
            <div className="w-full h-32 flex items-center justify-center border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-2xl text-slate-400 text-xs font-bold">该分组还没有壁纸，去右边添加吧！</div>
          )}
        </div>

        <div className="space-y-6 flex flex-col relative">
          <div className="bg-white/50 dark:bg-slate-800/50 rounded-3xl p-5 border border-white/40 dark:border-slate-700/50 shadow-sm">
            <p className="text-[10px] font-black text-slate-400 uppercase mb-3">🔗 粘贴网络图片 URL（加入「{editingGroup?.name || '当前'}」分组）</p>
            <div className="flex gap-2">
              <input type="text" placeholder="https://..." value={formData.newBgUrl || ''} onChange={e => handleUpdate('newBgUrl', e.target.value)} className="flex-1 bg-white dark:bg-slate-900 border-none rounded-xl px-4 py-2 text-xs outline-none shadow-inner" />
              <button onClick={addBgUrl} className="px-4 py-2 bg-emerald-500 text-white rounded-xl text-xs font-black shadow-lg shadow-emerald-500/20 active:scale-95">添加</button>
            </div>
          </div>

          <div
            onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}
            onClick={() => !isUploading && fileInputRef.current?.click()}
            className={`flex-1 min-h-[200px] border-2 border-dashed rounded-3xl flex flex-col items-center justify-center gap-4 cursor-pointer transition-all duration-300 relative overflow-hidden
            ${isDragging ? 'border-indigo-500 bg-indigo-500/10 scale-[1.02]' : 'border-slate-300 dark:border-slate-600 hover:bg-slate-100/50 dark:hover:bg-slate-800/50 hover:border-indigo-400'}
            `}
          >
            <input type="file" ref={fileInputRef} onChange={e => e.target.files && handleFileUpload(e.target.files[0])} className="hidden" accept="image/*" />

            <div className={`w-16 h-16 rounded-full flex items-center justify-center text-2xl shadow-xl transition-all duration-300 ${isDragging ? 'bg-indigo-500 text-white rotate-12' : 'bg-white dark:bg-slate-800 text-slate-500'}`}>
              {isUploading ? "⏳" : "☁️"}
            </div>

            <div className="text-center z-10">
              <p className="text-sm font-bold text-slate-700 dark:text-slate-200">
                {isUploading ? "正在上传至图床..." : "点击或将图片拖拽至此"}
              </p>
            </div>

            {isUploading && (
              <div className="absolute inset-0 bg-white/50 dark:bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-10">
                <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 👈 【新增】：上传成功后的浮动确认面板 */}
      <AnimatePresence>
        {pendingImageUrl && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            className="absolute inset-0 z-50 bg-slate-900/40 backdrop-blur-md rounded-[40px] flex items-center justify-center p-6"
          >
            <div className="bg-white dark:bg-slate-800 rounded-3xl p-6 max-w-sm w-full shadow-2xl border border-white/20">
              <h3 className="text-lg font-black text-slate-800 dark:text-white mb-4 text-center">✅ 图床返回成功！</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-4 text-center">是否将此图片加入分组「{editingGroup?.name || '当前'}」？</p>

              <div className="w-full aspect-video rounded-xl overflow-hidden mb-6 shadow-inner border border-slate-200 dark:border-slate-700">
                <img src={pendingImageUrl} alt="preview" className="w-full h-full object-cover" />
              </div>

              <div className="flex gap-3">
                <button onClick={cancelPendingImage} className="flex-1 py-3 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-xl text-xs font-bold hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors">
                  不了，仅上传
                </button>
                <button onClick={confirmAddPendingImage} className="flex-1 py-3 bg-pink-500 text-white rounded-xl text-xs font-black shadow-lg shadow-pink-500/30 hover:bg-pink-600 active:scale-95 transition-all">
                  ✨ 加入分组
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

    </motion.section>
  );
}
