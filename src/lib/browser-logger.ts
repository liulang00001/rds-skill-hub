/**
 * 浏览器端日志门面
 *
 * 作用：让 `'use client'` 组件可以方便地打日志，通过 /api/logs 回传到后端 stdout。
 *
 * 与 logger.ts 的区别：
 *   - logger.ts 的 createLogSession() 设计为**一次操作一个 session**，
 *     被 Next.js 服务端 API Route 使用（每次请求新建 session）
 *   - browser-logger.ts 是**整个 SPA 生命周期共享一个 session**，
 *     被客户端组件使用（按钮点击、错误弹窗、保存成功等事件）
 *
 * 客户端 log 自动带上真实 clientContext（sessionId / UA / screen / ...），
 * 因为在浏览器上下文执行，typeof window !== 'undefined'。
 */

import { createLogSession, type LogSession } from './logger';

let _session: LogSession | null = null;

/**
 * 获取全局浏览器 logger 单例。
 * 首次调用时懒加载，之后返回同一个 session。
 *
 * 注意：此函数只能在客户端组件（`'use client'`）或浏览器环境中调用；
 * 在 Next.js 服务端 API Route 中调用会得到 sessionId='server' 的占位 session。
 */
export function getBrowserLogger(): LogSession {
  if (!_session) {
    _session = createLogSession('ui');
  }
  return _session;
}

/**
 * 便捷 API：一次性打一条 log，无需先取 session。
 * 等价于 getBrowserLogger().log(level, message)
 */
export function logEvent(
  level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG',
  message: string,
): void {
  getBrowserLogger().log(level, message);
}

/**
 * 便捷 API：一次性 dump 大段内容。
 */
export function logDump(label: string, content: string): void {
  getBrowserLogger().dump(label, content);
}
