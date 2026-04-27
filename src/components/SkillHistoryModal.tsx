'use client';

import { useCallback, useEffect, useState } from 'react';
import { X, History, RotateCcw, Check } from 'lucide-react';

export interface HistoryItem {
  version: number;
  description: string;
  createdAt: string;
}

interface SkillHistoryModalProps {
  /** 要查看历史的 skill 名，null 代表关闭 */
  skillName: string | null;
  /** 当前活跃版本号（用于标记） */
  currentVersion: number | null;
  /** 关闭回调 */
  onClose: () => void;
  /** 预览历史版本（加载到编辑器只读查看） */
  onPreview: (name: string, version: number) => void;
  /** 从历史版本恢复为新版本 */
  onRestore: (name: string, version: number) => Promise<void>;
}

/**
 * Skill 历史版本查看 Modal
 * - 顶部标题 + 关闭按钮
 * - 列表：每行显示 v号、描述、创建时间、「预览」「恢复」两个操作
 * - 恢复会弹二次确认
 */
export default function SkillHistoryModal({
  skillName,
  currentVersion,
  onClose,
  onPreview,
  onRestore,
}: SkillHistoryModalProps) {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<number | null>(null);

  const loadHistory = useCallback(async (name: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/skills/${encodeURIComponent(name)}/versions`, { cache: 'no-store' });
      const json = await res.json();
      if (json.success) {
        setItems(json.versions || []);
      } else {
        setError(json.error || '加载失败');
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (skillName) loadHistory(skillName);
    else setItems([]);
  }, [skillName, loadHistory]);

  const handleRestore = useCallback(async (version: number) => {
    if (!skillName) return;
    if (!window.confirm(`确认把 v${version} 的内容恢复为新版本？\n这会生成一个新的版本号（v${(currentVersion || 0) + 1}），不会删除历史。`)) {
      return;
    }
    setRestoring(version);
    try {
      await onRestore(skillName, version);
      // 刷新列表（应会多出一条新版本）
      await loadHistory(skillName);
    } finally {
      setRestoring(null);
    }
  }, [skillName, currentVersion, onRestore, loadHistory]);

  if (!skillName) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-lg shadow-xl w-[560px] max-h-[80vh] flex flex-col border border-[var(--border)]">
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
          <div className="flex items-center gap-2">
            <History size={16} className="text-[var(--accent)]" />
            <div>
              <div className="text-sm font-semibold">历史版本</div>
              <div className="text-[11px] text-[var(--muted)] font-mono">{skillName}</div>
            </div>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded transition" title="关闭">
            <X size={16} />
          </button>
        </div>

        {/* 列表 */}
        <div className="flex-1 overflow-auto">
          {loading && <div className="px-4 py-6 text-xs text-[var(--muted)] text-center">加载中...</div>}
          {error && <div className="px-4 py-6 text-xs text-red-500 text-center">{error}</div>}
          {!loading && !error && items.length === 0 && (
            <div className="px-4 py-6 text-xs text-[var(--muted)] text-center">暂无历史版本</div>
          )}
          {!loading && !error && items.map(item => {
            const isCurrent = item.version === currentVersion;
            return (
              <div
                key={item.version}
                className={`flex items-center gap-3 px-4 py-3 border-b border-[var(--border)] text-xs transition ${
                  isCurrent ? 'bg-blue-50' : 'hover:bg-gray-50'
                }`}
              >
                <div className="shrink-0 w-14 text-center">
                  <span className={`px-1.5 py-0.5 font-mono rounded border ${
                    isCurrent
                      ? 'bg-[var(--accent)] text-white border-[var(--accent)]'
                      : 'text-[var(--accent)] border-[var(--accent)]/30'
                  }`}>
                    v{item.version}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="truncate">
                    {item.description || <span className="text-[var(--muted)] italic">（无描述）</span>}
                  </div>
                  <div className="text-[var(--muted)] text-[10px]">
                    {new Date(item.createdAt).toLocaleString('zh-CN')}
                    {isCurrent && <span className="ml-2 text-[var(--accent)] font-medium">· 当前版本</span>}
                  </div>
                </div>
                <div className="shrink-0 flex items-center gap-1">
                  <button
                    onClick={() => onPreview(skillName, item.version)}
                    className="px-2 py-1 text-[11px] border border-[var(--border)] rounded hover:bg-[var(--accent-light)] transition"
                    title="加载该版本到编辑器（只读预览）"
                  >
                    预览
                  </button>
                  {!isCurrent && (
                    <button
                      onClick={() => handleRestore(item.version)}
                      disabled={restoring === item.version}
                      className="px-2 py-1 text-[11px] border border-[var(--accent)]/30 text-[var(--accent)] rounded hover:bg-[var(--accent-light)] transition flex items-center gap-1 disabled:opacity-50"
                      title="把该版本内容作为新版本"
                    >
                      {restoring === item.version ? (
                        <>处理中...</>
                      ) : (
                        <><RotateCcw size={11} /> 恢复</>
                      )}
                    </button>
                  )}
                  {isCurrent && (
                    <span className="px-2 py-1 text-[11px] text-[var(--accent)] flex items-center gap-1">
                      <Check size={11} /> 活跃
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* 说明 */}
        <div className="px-4 py-2 border-t border-[var(--border)] bg-gray-50 text-[10px] text-[var(--muted)]">
          恢复 vN 会把其内容复制为新版本（v{(currentVersion || 0) + 1}），历史不会被删除或改写。
        </div>
      </div>
    </div>
  );
}
