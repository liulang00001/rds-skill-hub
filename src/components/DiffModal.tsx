'use client';

import { useMemo, useRef, useCallback, useEffect } from 'react';
import { X, ArrowRight } from 'lucide-react';

interface DiffModalProps {
  /** 是否显示 */
  open: boolean;
  /** 原始文本 */
  original: string;
  /** 优化后文本 */
  optimized: string;
  /** 关闭回调 */
  onClose: () => void;
  /** 应用优化回调 */
  onApply: () => void;
}

interface DiffLine {
  leftLineNo: number | null;
  rightLineNo: number | null;
  leftText: string;
  rightText: string;
  type: 'same' | 'modified' | 'added' | 'removed';
}

/**
 * 计算两段文本的最长公共子序列（LCS），用于对齐差异行。
 * 返回对齐后的逐行差异列表，风格类似 Beyond Compare。
 */
function computeDiff(original: string, optimized: string): DiffLine[] {
  const linesA = original.split('\n');
  const linesB = optimized.split('\n');
  const m = linesA.length;
  const n = linesB.length;

  // 构建 LCS 表
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (linesA[i - 1] === linesB[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // 回溯 LCS 生成对齐结果
  const result: DiffLine[] = [];
  let i = m, j = n;

  const pending: DiffLine[] = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && linesA[i - 1] === linesB[j - 1]) {
      // 相同行
      pending.push({
        leftLineNo: i,
        rightLineNo: j,
        leftText: linesA[i - 1],
        rightText: linesB[j - 1],
        type: 'same',
      });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      // 右侧新增
      pending.push({
        leftLineNo: null,
        rightLineNo: j,
        leftText: '',
        rightText: linesB[j - 1],
        type: 'added',
      });
      j--;
    } else if (i > 0) {
      // 左侧删除
      pending.push({
        leftLineNo: i,
        rightLineNo: null,
        leftText: linesA[i - 1],
        rightText: '',
        type: 'removed',
      });
      i--;
    }
  }

  // 回溯是倒序的，翻转
  pending.reverse();

  // 后处理：将连续的 removed 块 + 紧随的 added 块 批量配对为 modified
  // 例如 [R,R,R,A,A,A,A] → [M,M,M,A]（3对modified + 1个多出的added）
  let idx = 0;
  while (idx < pending.length) {
    // 收集连续 removed
    const removedChunk: DiffLine[] = [];
    while (idx < pending.length && pending[idx].type === 'removed') {
      removedChunk.push(pending[idx]);
      idx++;
    }
    // 收集紧随的连续 added
    const addedChunk: DiffLine[] = [];
    while (idx < pending.length && pending[idx].type === 'added') {
      addedChunk.push(pending[idx]);
      idx++;
    }

    if (removedChunk.length > 0 && addedChunk.length > 0) {
      // 一一配对为 modified
      const pairCount = Math.min(removedChunk.length, addedChunk.length);
      for (let k = 0; k < pairCount; k++) {
        result.push({
          leftLineNo: removedChunk[k].leftLineNo,
          rightLineNo: addedChunk[k].rightLineNo,
          leftText: removedChunk[k].leftText,
          rightText: addedChunk[k].rightText,
          type: 'modified',
        });
      }
      // 多出的 removed 保持为删除
      for (let k = pairCount; k < removedChunk.length; k++) {
        result.push(removedChunk[k]);
      }
      // 多出的 added 保持为新增
      for (let k = pairCount; k < addedChunk.length; k++) {
        result.push(addedChunk[k]);
      }
    } else {
      // 只有 removed 或只有 added（没有配对对象），原样保留
      for (const r of removedChunk) result.push(r);
      for (const a of addedChunk) result.push(a);
    }

    // 非 removed/added 的行（same）直接加入
    if (idx < pending.length && pending[idx].type === 'same') {
      result.push(pending[idx]);
      idx++;
    }
  }

  return result;
}

export default function DiffModal({ open, original, optimized, onClose, onApply }: DiffModalProps) {
  const diffLines = useMemo(() => {
    if (!open) return [];
    return computeDiff(original, optimized);
  }, [open, original, optimized]);

  // 同步左右滚动
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const syncing = useRef(false);

  const syncScroll = useCallback((source: 'left' | 'right') => {
    if (syncing.current) return;
    syncing.current = true;
    const from = source === 'left' ? leftRef.current : rightRef.current;
    const to = source === 'left' ? rightRef.current : leftRef.current;
    if (from && to) {
      to.scrollTop = from.scrollTop;
    }
    requestAnimationFrame(() => { syncing.current = false; });
  }, []);

  // ESC 关闭
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  // 统计差异
  const stats = useMemo(() => {
    let modified = 0, added = 0, removed = 0;
    for (const line of diffLines) {
      if (line.type === 'modified') modified++;
      else if (line.type === 'added') added++;
      else if (line.type === 'removed') removed++;
    }
    return { modified, added, removed, total: modified + added + removed };
  }, [diffLines]);

  if (!open) return null;

  const lineNoWidth = 'w-8';

  // 行背景色
  const getLeftBg = (type: DiffLine['type']) => {
    if (type === 'modified') return 'bg-red-50';
    if (type === 'removed') return 'bg-red-100';
    return '';
  };
  const getRightBg = (type: DiffLine['type']) => {
    if (type === 'modified') return 'bg-green-50';
    if (type === 'added') return 'bg-green-100';
    return '';
  };

  // 行号颜色
  const getLeftLineNoColor = (type: DiffLine['type']) => {
    if (type === 'modified' || type === 'removed') return 'text-red-400 bg-red-100';
    return 'text-gray-400 bg-gray-50';
  };
  const getRightLineNoColor = (type: DiffLine['type']) => {
    if (type === 'modified' || type === 'added') return 'text-green-500 bg-green-100';
    return 'text-gray-400 bg-gray-50';
  };

  return (
    <>
      {/* 遮罩 */}
      <div className="fixed inset-0 z-[60] bg-black/40" onClick={onClose} />

      {/* 弹窗 */}
      <div className="fixed inset-4 z-[61] flex flex-col bg-[var(--bg)] rounded-xl shadow-2xl border border-[var(--border)] overflow-hidden">
        {/* 标题栏 */}
        <div className="flex items-center gap-3 px-4 py-2.5 border-b border-[var(--border)] shrink-0 bg-gray-50">
          <span className="font-bold text-sm">差异对比</span>
          <div className="flex items-center gap-2 text-[10px]">
            {stats.modified > 0 && (
              <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">{stats.modified} 处修改</span>
            )}
            {stats.added > 0 && (
              <span className="px-1.5 py-0.5 rounded bg-green-100 text-green-700">{stats.added} 行新增</span>
            )}
            {stats.removed > 0 && (
              <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-700">{stats.removed} 行删除</span>
            )}
            {stats.total === 0 && (
              <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">无差异</span>
            )}
          </div>
          <div className="flex-1" />
          <button
            onClick={() => { onApply(); onClose(); }}
            className="px-3 py-1 text-xs bg-purple-600 text-white rounded hover:bg-purple-700 transition flex items-center gap-1"
          >
            <ArrowRight size={12} />
            应用优化
          </button>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-200 transition" title="关闭 (ESC)">
            <X size={16} />
          </button>
        </div>

        {/* 左右标题 */}
        <div className="flex shrink-0 border-b border-[var(--border)] text-xs font-medium">
          <div className="flex-1 px-4 py-1.5 bg-red-50/50 text-red-700 border-r border-[var(--border)]">
            ← 原始分析步骤
          </div>
          <div className="flex-1 px-4 py-1.5 bg-green-50/50 text-green-700">
            优化后分析步骤 →
          </div>
        </div>

        {/* 对比内容区 */}
        <div className="flex-1 flex min-h-0">
          {/* 左侧：原始 */}
          <div
            ref={leftRef}
            className="flex-1 overflow-auto border-r border-[var(--border)] font-mono text-[12px] leading-[1.7] diff-scroll"
            onScroll={() => syncScroll('left')}
          >
            {diffLines.map((line, i) => (
              <div key={i} className={`flex min-h-[1.7em] ${getLeftBg(line.type)}`}>
                <span className={`${lineNoWidth} shrink-0 text-right pr-2 select-none text-[10px] leading-[1.7em] border-r border-gray-200 ${getLeftLineNoColor(line.type)}`}>
                  {line.leftLineNo ?? ''}
                </span>
                <span className={`flex-1 px-2 whitespace-pre-wrap break-all ${
                  line.type === 'removed' ? 'text-red-700' :
                  line.type === 'modified' ? 'text-red-800' :
                  line.type === 'added' ? 'text-gray-300' : ''
                }`}>
                  {line.type === 'added' ? '' : (line.leftText || ' ')}
                </span>
              </div>
            ))}
          </div>

          {/* 右侧：优化后 */}
          <div
            ref={rightRef}
            className="flex-1 overflow-auto font-mono text-[12px] leading-[1.7] diff-scroll"
            onScroll={() => syncScroll('right')}
          >
            {diffLines.map((line, i) => (
              <div key={i} className={`flex min-h-[1.7em] ${getRightBg(line.type)}`}>
                <span className={`${lineNoWidth} shrink-0 text-right pr-2 select-none text-[10px] leading-[1.7em] border-r border-gray-200 ${getRightLineNoColor(line.type)}`}>
                  {line.rightLineNo ?? ''}
                </span>
                <span className={`flex-1 px-2 whitespace-pre-wrap break-all ${
                  line.type === 'added' ? 'text-green-800' :
                  line.type === 'modified' ? 'text-green-800' :
                  line.type === 'removed' ? 'text-gray-300' : ''
                }`}>
                  {line.type === 'removed' ? '' : (line.rightText || ' ')}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* 底部图例 */}
        <div className="flex items-center gap-4 px-4 py-1.5 border-t border-[var(--border)] text-[10px] text-[var(--muted)] bg-gray-50 shrink-0">
          <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-red-100 border border-red-200" /> 删除</span>
          <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-amber-100 border border-amber-200" /> 修改</span>
          <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-green-100 border border-green-200" /> 新增</span>
          <div className="flex-1" />
          <span>按 ESC 关闭</span>
        </div>
      </div>
    </>
  );
}
