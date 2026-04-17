/**
 * 日志工具 — 输出到 console，由 FaaS 平台统一收集
 * 保持 LogSession 接口不变，调用方无需修改
 */

export interface LogSession {
  /** 追加一行日志 */
  log(level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG', message: string): void;
  /** 追加大段内容（如完整输入/输出） */
  dump(label: string, content: string): void;
  /** 会话标识 */
  filePath: string;
}

/**
 * 创建一个日志会话，所有内容输出到 console
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
    },
    dump(label, content) {
      console.log(`[${prefix}] --- ${label} (${content.length} chars) ---`);
      console.log(content);
    },
  };
}
