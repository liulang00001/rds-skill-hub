/**
 * 客户端上下文 — Session ID + 设备/浏览器信息
 *
 * Session ID 通过 localStorage 持久化，同一设备的所有浏览器标签页共享同一个 id。
 * 清除浏览器缓存或调用 resetSessionId() 会生成新 id。
 *
 * SSR 安全：所有 window/localStorage 访问都做 typeof window 守卫，
 * 在 Next.js 服务端渲染或 API Route 中调用时返回"server"占位值。
 */

const STORAGE_KEY = 'rds_session_id';

export interface ClientContext {
  sessionId: string;
  userAgent: string;
  platform: string;
  language: string;
  screen: string;      // 格式: "1920x1080"
  timezone: string;    // 格式: "Asia/Shanghai"
  /** 前端运行环境：browser（客户端组件）或 server（Next.js SSR / API Route） */
  runtime: 'browser' | 'server';
}

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof localStorage !== 'undefined';
}

/** 生成 UUID：优先 crypto.randomUUID()，回退到时间戳 + 随机数拼接 */
function genUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // 回退方案：足够唯一用于诊断场景（非安全场景）
  const rnd = () => Math.random().toString(16).slice(2, 10);
  return `${Date.now().toString(16)}-${rnd()}-${rnd()}-${rnd()}`;
}

/** 获取当前 session id；浏览器端懒加载+持久化，服务端返回 "server" */
export function getSessionId(): string {
  if (!isBrowser()) return 'server';
  try {
    let id = localStorage.getItem(STORAGE_KEY);
    if (!id) {
      id = genUuid();
      localStorage.setItem(STORAGE_KEY, id);
    }
    return id;
  } catch {
    // localStorage 被禁用时仍返回一个临时 id（本次 import 生命周期内稳定）
    return _fallbackSessionId;
  }
}

/** 强制重置 session id（如用户主动"新建会话"） */
export function resetSessionId(): string {
  if (!isBrowser()) return 'server';
  const id = genUuid();
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch { /* 忽略 */ }
  return id;
}

const _fallbackSessionId = genUuid();

// 模块级缓存：userAgent 等值在页面生命周期内不会变，计算一次即可
let _cached: ClientContext | null = null;

/** 获取完整 client context（供注入到请求体 / 日志转发） */
export function getClientContext(): ClientContext {
  if (_cached) return _cached;

  if (!isBrowser()) {
    _cached = {
      sessionId: 'server',
      userAgent: 'server',
      platform: 'server',
      language: 'unknown',
      screen: 'unknown',
      timezone: 'unknown',
      runtime: 'server',
    };
    return _cached;
  }

  let screen = 'unknown';
  try {
    if (window.screen) screen = `${window.screen.width}x${window.screen.height}`;
  } catch { /* 忽略 */ }

  let timezone = 'unknown';
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown';
  } catch { /* 忽略 */ }

  _cached = {
    sessionId: getSessionId(),
    userAgent: navigator.userAgent || 'unknown',
    platform: navigator.platform || 'unknown',
    language: navigator.language || 'unknown',
    screen,
    timezone,
    runtime: 'browser',
  };
  return _cached;
}
