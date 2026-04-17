/**
 * 日志工具 — 本地 console 输出 + 异步回传后端
 * 保持 LogSession 接口不变，调用方无需修改。
 *
 * 回传：每条 log/dump 发射后不管地 POST 到后端 `/api/logs`，
 *       由后端打印到服务进程 stdout，便于在同一视图看前后端完整链路。
 *       网络失败不影响业务，静默吞异常。
 */

import { API_GENERATE_BASE, apiUrl } from './api-config';
import { getClientContext } from './client-context';

export interface LogSession {
  /** 追加一行日志 */
  log(level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG', message: string): void;
  /** 追加大段内容（如完整输入/输出） */
  dump(label: string, content: string): void;
  /** 会话标识 */
  filePath: string;
}

const LOGS_UPSTREAM = apiUrl(API_GENERATE_BASE, '/api/logs');

/** 发射后不管地转发到后端；任何异常都吞掉，避免影响业务流程 */
function forward(payload: Record<string, unknown>): void {
  try {
    // 每次回传都带上 clientContext（sessionId / userAgent / screen / ...）
    const body = JSON.stringify({ ...payload, clientContext: getClientContext() });
    // 非阻塞；无 await
    fetch(LOGS_UPSTREAM, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      // 保证浏览器关页面时仍尽力发送（仅在浏览器端有效，Node 端忽略）
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* 静默 */
  }
}

/**
 * 创建一个日志会话，所有内容输出到 console 并异步回传后端
 * @param prefix 会话前缀，如 "generate-code"
 */
export function createLogSession(prefix: string): LogSession {
  const sessionId = `${prefix}_${Date.now()}`;
  console.log(`[${prefix}] === LOG SESSION START === ${new Date().toISOString()}`);

  return {
    filePath: sessionId,
    log(level, message) {
      const line = `[${prefix}] [${level}] ${message}`;
      if (level === 'ERROR') console.error(line);
      else if (level === 'WARN') console.warn(line);
      else console.log(line);

      forward({ kind: 'log', prefix, level, message });
    },
    dump(label, content) {
      console.log(`[${prefix}] --- ${label} (${content.length} chars) ---`);
      console.log(content);

      forward({ kind: 'dump', prefix, label, content });
    },
  };
}
