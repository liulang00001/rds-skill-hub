'use client';

/**
 * 浮窗反馈组件 — 右侧可纵向拖动，悬浮按钮展开 tag 菜单
 *
 * 交互：
 *   - 左侧 grip 图标按住可沿右侧上下拖动；位置持久化到 localStorage
 *   - 悬浮（或点击）👍 / 👎 → 弹出左侧小菜单，列出 4 个维度 tag
 *   - 点击菜单中任一 tag → 发出一条反馈（rating + tag）并显示已提交状态 2s
 *
 * 通道：复用现有 /api/logs（logEvent → browser-logger → logger.forward → POST /api/logs）
 *   后端零改动；stdout 带 `[FEEDBACK]` 标签，运维可 `grep FEEDBACK` 捞出所有反馈
 *
 * 契约（stdout）：
 *   [2026-04-22 ...] [INFO] [web:ui] [...] [FEEDBACK] rating=up tag=逻辑校验
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ThumbsUp, ThumbsDown, GripVertical } from 'lucide-react';

import { logEvent } from '@/lib/browser-logger';

const TAG_OPTIONS = ['逻辑校验', '流程图', '执行结果', '其他'] as const;
type Tag = (typeof TAG_OPTIONS)[number];
type Rating = 'up' | 'down';
type SubmitState = 'idle' | 'done-up' | 'done-down';

const COOLDOWN_MS = 2000;
const POPUP_CLOSE_GRACE_MS = 180;
const STORAGE_KEY = 'rds_feedback_fab_bottom';
const DEFAULT_BOTTOM = 80;
const MIN_BOTTOM = 12;
/** 估计整个浮窗高度（grip + 两个按钮 + padding / gap），用于 drag 时 clamp 不越出视口 */
const WIDGET_ESTIMATED_HEIGHT = 140;

export default function FeedbackFab() {
  // 从 localStorage 懒加载位置：useEffect 里读取，避免 SSR / 客户端水合不一致
  const [bottomPx, setBottomPx] = useState<number>(DEFAULT_BOTTOM);
  const [state, setState] = useState<SubmitState>('idle');
  const [hoveredRating, setHoveredRating] = useState<Rating | null>(null);

  const dragStartRef = useRef<{ clientY: number; startBottom: number } | null>(null);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const popupCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 跟踪最新的 bottomPx 给 mouseup 用（避免把 bottomPx 放进 useEffect deps 里反复绑监听）
  const bottomPxRef = useRef(bottomPx);
  bottomPxRef.current = bottomPx;

  // === 首次 mount 后读取 localStorage ===
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      const n = stored ? parseInt(stored, 10) : NaN;
      if (Number.isFinite(n)) {
        const maxBottom = window.innerHeight - WIDGET_ESTIMATED_HEIGHT;
        setBottomPx(Math.max(MIN_BOTTOM, Math.min(n, maxBottom)));
      }
    } catch {
      /* localStorage 被禁用：保持默认值 */
    }
  }, []);

  // === 拖动 ===
  // 注意：只绑一次 document 监听，通过 ref 读当前值，不因每次 render 重新绑
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragStartRef.current) return;
      const delta = e.clientY - dragStartRef.current.clientY;
      // 鼠标向下移动（clientY 增大）→ bottomPx 应该减小（更贴近底部）
      const raw = dragStartRef.current.startBottom - delta;
      const maxBottom = window.innerHeight - WIDGET_ESTIMATED_HEIGHT;
      const clamped = Math.max(MIN_BOTTOM, Math.min(raw, maxBottom));
      setBottomPx(clamped);
    };
    const onUp = () => {
      if (!dragStartRef.current) return;
      dragStartRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      try {
        localStorage.setItem(STORAGE_KEY, String(bottomPxRef.current));
      } catch {
        /* 忽略 */
      }
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, []);

  // 视口缩小时，若当前位置越界则自动回收
  useEffect(() => {
    const onResize = () => {
      const maxBottom = window.innerHeight - WIDGET_ESTIMATED_HEIGHT;
      setBottomPx((prev) => Math.max(MIN_BOTTOM, Math.min(prev, maxBottom)));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragStartRef.current = { clientY: e.clientY, startBottom: bottomPx };
      document.body.style.cursor = 'grabbing';
      document.body.style.userSelect = 'none';
    },
    [bottomPx],
  );

  // === 提交反馈 ===
  const submit = useCallback((rating: Rating, tag: Tag) => {
    logEvent('INFO', `[FEEDBACK] rating=${rating} tag=${tag}`);
    setState(rating === 'up' ? 'done-up' : 'done-down');
    setHoveredRating(null);

    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    resetTimerRef.current = setTimeout(() => setState('idle'), COOLDOWN_MS);
  }, []);

  // === 悬浮菜单控制 ===
  const openPopup = useCallback(
    (rating: Rating) => {
      if (popupCloseTimerRef.current) {
        clearTimeout(popupCloseTimerRef.current);
        popupCloseTimerRef.current = null;
      }
      if (state !== 'idle') return; // 冷却期禁止打开
      setHoveredRating(rating);
    },
    [state],
  );

  const schedulePopupClose = useCallback(() => {
    if (popupCloseTimerRef.current) clearTimeout(popupCloseTimerRef.current);
    popupCloseTimerRef.current = setTimeout(() => {
      setHoveredRating(null);
    }, POPUP_CLOSE_GRACE_MS);
  }, []);

  const locked = state !== 'idle';

  return (
    <div
      className="fixed right-4 z-50 flex flex-col items-center gap-1.5 px-1.5 py-1.5 bg-white/95 border border-slate-200 rounded-full shadow-lg backdrop-blur-sm"
      style={{ bottom: bottomPx }}
    >
      {/* 拖动手柄 */}
      <div
        onMouseDown={handleDragStart}
        className="p-0.5 text-slate-400 hover:text-slate-600 cursor-grab active:cursor-grabbing select-none transition-colors"
        title="按住上下拖动"
        aria-label="拖动调整位置"
      >
        <GripVertical size={14} />
      </div>

      {/* 👍 按钮 + 悬浮 tag 菜单 */}
      <RatingButton
        rating="up"
        icon={<ThumbsUp size={14} />}
        isHovered={hoveredRating === 'up'}
        isConfirmed={state === 'done-up'}
        locked={locked}
        onHoverEnter={() => openPopup('up')}
        onHoverLeave={schedulePopupClose}
        onSelectTag={(tag) => submit('up', tag)}
      />

      {/* 👎 按钮 + 悬浮 tag 菜单 */}
      <RatingButton
        rating="down"
        icon={<ThumbsDown size={14} />}
        isHovered={hoveredRating === 'down'}
        isConfirmed={state === 'done-down'}
        locked={locked}
        onHoverEnter={() => openPopup('down')}
        onHoverLeave={schedulePopupClose}
        onSelectTag={(tag) => submit('down', tag)}
      />
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────

interface RatingButtonProps {
  rating: Rating;
  icon: React.ReactNode;
  isHovered: boolean;
  isConfirmed: boolean;
  locked: boolean;
  onHoverEnter: () => void;
  onHoverLeave: () => void;
  onSelectTag: (tag: Tag) => void;
}

/**
 * 单个 rating 按钮 + 其专属悬浮菜单
 *
 * 关键点：wrapper div 上的 onMouseEnter/Leave 覆盖按钮 + 菜单**两者**，
 * 所以鼠标从按钮滑进菜单不会触发 leave → 不会关闭；只有真正移出组合区才关。
 */
function RatingButton({
  rating,
  icon,
  isHovered,
  isConfirmed,
  locked,
  onHoverEnter,
  onHoverLeave,
  onSelectTag,
}: RatingButtonProps) {
  const isUp = rating === 'up';

  // 颜色方案：emerald / rose 比纯 green / red 更柔和现代
  const buttonClass = [
    'flex items-center justify-center w-8 h-8 rounded-full border transition-colors',
    isConfirmed
      ? isUp
        ? 'bg-emerald-500 text-white border-emerald-500 shadow-md shadow-emerald-200'
        : 'bg-rose-500 text-white border-rose-500 shadow-md shadow-rose-200'
      : isUp
        ? 'bg-emerald-50 text-emerald-600 border-emerald-200 hover:bg-emerald-500 hover:text-white hover:border-emerald-500'
        : 'bg-rose-50 text-rose-600 border-rose-200 hover:bg-rose-500 hover:text-white hover:border-rose-500',
    locked && !isConfirmed ? 'opacity-40 cursor-not-allowed' : '',
  ].join(' ');

  // 菜单项：hover 时渲染 rating 专属填充色
  const itemHoverClass = isUp
    ? 'hover:bg-emerald-500 hover:text-white'
    : 'hover:bg-rose-500 hover:text-white';

  const headerClass = isUp ? 'text-emerald-600' : 'text-rose-600';

  return (
    <div
      className="relative"
      onMouseEnter={onHoverEnter}
      onMouseLeave={onHoverLeave}
    >
      <button
        type="button"
        className={buttonClass}
        aria-label={isUp ? '点赞' : '点踩'}
        title={isUp ? '点赞（悬浮选择维度）' : '点踩（悬浮选择维度）'}
        // 点击按钮本身不直接提交；由悬浮/点击后出现的菜单项触发
        // 但在触屏设备上点击会先触发 mouseEnter（合成事件）再触发 click，
        // 所以菜单会打开 — 无需额外 onClick
      >
        {icon}
      </button>

      {isHovered && !locked && (
        <div
          className="absolute right-full top-1/2 -translate-y-1/2 mr-2 bg-white border border-slate-200 rounded-lg shadow-xl py-1 min-w-[96px] animate-in fade-in-0 zoom-in-95"
          role="menu"
        >
          <div
            className={`px-3 py-1 text-[10px] font-medium border-b border-slate-100 ${headerClass} select-none`}
          >
            {isUp ? '👍 点赞维度' : '👎 点踩维度'}
          </div>
          {TAG_OPTIONS.map((tag) => (
            <button
              key={tag}
              type="button"
              role="menuitem"
              onClick={() => onSelectTag(tag)}
              className={[
                'block w-full text-left px-3 py-1.5 text-xs text-slate-700 transition-colors',
                itemHoverClass,
              ].join(' ')}
            >
              {tag}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
