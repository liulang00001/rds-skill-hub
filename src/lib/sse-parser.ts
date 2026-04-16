/**
 * 通用 SSE 流式解析器
 * 用于 SSE 接口的客户端解析
 */

export interface SSEHandlers {
  onProgress?: (message: string) => void;
  onToken?: (content: string) => void;
  onThinking?: (content: string) => void;
  onDone?: (data: Record<string, unknown>) => void;
  onError?: (error: string, debug?: string) => void;
}

/**
 * 从 fetch Response 中读取 SSE 流并分发到对应的 handler
 * @returns 当流结束时 resolve
 */
export async function parseSSEStream(
  response: Response,
  handlers: SSEHandlers,
): Promise<void> {
  if (!response.body) throw new Error('不支持流式响应');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split('\n\n');
      buffer = blocks.pop() ?? '';

      for (const block of blocks) {
        const line = block.trim();
        if (!line.startsWith('data:')) continue;
        const raw = line.slice(5).trim();
        try {
          const msg = JSON.parse(raw);
          switch (msg.type) {
            case 'progress':
              handlers.onProgress?.(msg.message);
              break;
            case 'token':
              handlers.onToken?.(msg.content);
              break;
            case 'thinking':
              handlers.onThinking?.(msg.content);
              break;
            case 'done':
              handlers.onDone?.(msg);
              break;
            case 'error':
              handlers.onError?.(msg.error, msg.debug);
              break;
          }
        } catch (parseErr) {
          // JSON 解析失败则跳过该块（可能是不完整的数据）
          if (parseErr instanceof SyntaxError) continue;
          throw parseErr;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
