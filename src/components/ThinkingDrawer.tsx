'use client';

import { useEffect, useRef, useState } from 'react';
import { X, Brain } from 'lucide-react';

interface ThinkingDrawerProps {
  /** 是否打开抽屉 */
  open: boolean;
  /** 思考内容（流式追加） */
  content: string;
  /** 思考是否已结束 */
  finished: boolean;
  /** 关闭回调 */
  onClose: () => void;
  /** 自动关闭延迟（ms），默认 2000 */
  autoCloseDelay?: number;
}

export default function ThinkingDrawer({
  open,
  content,
  finished,
  onClose,
  autoCloseDelay = 2000,
}: ThinkingDrawerProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(null);
  // 控制 DOM 中是否渲染（用于退出动画结束后卸载）
  const [mounted, setMounted] = useState(false);
  // 控制 CSS 动画状态
  const [visible, setVisible] = useState(false);

  // 打开时挂载 + 触发进入动画
  useEffect(() => {
    if (open) {
      setMounted(true);
      // 下一帧触发动画
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setVisible(true));
      });
    } else {
      setVisible(false);
      // 动画结束后卸载
      const t = setTimeout(() => setMounted(false), 300);
      return () => clearTimeout(t);
    }
  }, [open]);

  // 自动滚动到底部
  useEffect(() => {
    if (contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [content]);

  // 思考结束后自动关闭
  useEffect(() => {
    if (finished && open) {
      timerRef.current = setTimeout(onClose, autoCloseDelay);
      return () => {
        if (timerRef.current) clearTimeout(timerRef.current);
      };
    }
  }, [finished, open, onClose, autoCloseDelay]);

  if (!mounted) return null;

  return (
    <>
      {/* 半透明遮罩 — 点击可关闭 */}
      <div
        className="fixed inset-0 z-40 transition-opacity duration-300"
        style={{
          backgroundColor: 'rgba(0,0,0,0.2)',
          opacity: visible ? 1 : 0,
          pointerEvents: visible ? 'auto' : 'none',
        }}
        onClick={onClose}
      />

      {/* 抽屉面板 */}
      <div
        className="fixed top-0 right-0 z-50 h-full flex flex-col shadow-2xl transition-transform duration-300 ease-out"
        style={{
          width: '420px',
          maxWidth: '90vw',
          backgroundColor: 'var(--bg)',
          borderLeft: '1px solid var(--border)',
          transform: visible ? 'translateX(0)' : 'translateX(100%)',
        }}
      >
        {/* 标题栏 */}
        <div
          className="flex items-center gap-2 px-4 py-3 shrink-0"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          <Brain size={18} style={{ color: 'var(--accent)' }} />
          <span className="font-semibold text-sm">思考过程</span>
          {!finished && (
            <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--muted)' }}>
              <span className="thinking-dot-animation">●</span>
              思考中…
            </span>
          )}
          {finished && (
            <span className="text-xs" style={{ color: 'var(--success)' }}>
              ✓ 思考完成
            </span>
          )}
          <div className="flex-1" />
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-[var(--accent-light)] transition-colors"
            title="关闭"
          >
            <X size={16} />
          </button>
        </div>

        {/* 思考内容 */}
        <div
          ref={contentRef}
          className="flex-1 overflow-y-auto px-4 py-3 text-sm leading-relaxed"
          style={{ color: 'var(--fg)', fontFamily: 'system-ui, -apple-system, sans-serif' }}
        >
          {content ? (
            <div className="whitespace-pre-wrap break-words thinking-content">{content}</div>
          ) : (
            <div className="flex items-center justify-center h-full" style={{ color: 'var(--muted)' }}>
              等待思考内容…
            </div>
          )}
          {/* 光标闪烁效果 */}
          {!finished && content && (
            <span className="thinking-cursor">▎</span>
          )}
        </div>
      </div>
    </>
  );
}
