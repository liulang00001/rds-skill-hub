'use client';

import { useState } from 'react';
import { X, ChevronDown, ChevronRight, Copy, Check, Trash2 } from 'lucide-react';

export interface RequestLogEntry {
  id: number;
  timestamp: string;
  method: string;
  url: string;
  requestBody: any;
  responseStatus: number | null;
  responseBody: any;
  duration: number | null; // ms
  isSSE: boolean;
  sseEvents?: Array<{ type: string; data: any }>;
  error?: string;
}

interface Props {
  logs: RequestLogEntry[];
  onClear: () => void;
  onClose: () => void;
}

function JsonBlock({ data, label }: { data: any; label: string }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  if (data === null || data === undefined) {
    return <span className="text-gray-400 text-[11px]">{label}: (空)</span>;
  }

  const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  const isLong = text.length > 120;

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="mt-1">
      <div
        className="flex items-center gap-1 cursor-pointer text-[11px] text-gray-500 hover:text-gray-700"
        onClick={() => setExpanded(!expanded)}
      >
        {isLong ? (expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />) : null}
        <span className="font-medium">{label}</span>
        <button onClick={handleCopy} className="ml-auto p-0.5 hover:text-blue-500" title="复制">
          {copied ? <Check size={11} className="text-green-500" /> : <Copy size={11} />}
        </button>
      </div>
      {(expanded || !isLong) && (
        <pre className="mt-0.5 p-2 bg-gray-50 border border-gray-200 rounded text-[11px] font-mono whitespace-pre-wrap break-all max-h-[300px] overflow-auto">
          {text}
        </pre>
      )}
      {!expanded && isLong && (
        <div className="mt-0.5 p-1.5 bg-gray-50 border border-gray-200 rounded text-[11px] font-mono text-gray-400 truncate">
          {text.slice(0, 120)}...
        </div>
      )}
    </div>
  );
}

function LogEntry({ entry }: { entry: RequestLogEntry }) {
  const [expanded, setExpanded] = useState(false);

  const statusColor = entry.error
    ? 'text-red-600 bg-red-50'
    : entry.responseStatus && entry.responseStatus >= 400
      ? 'text-orange-600 bg-orange-50'
      : 'text-green-600 bg-green-50';

  return (
    <div className="border-b border-gray-100 last:border-b-0">
      <div
        className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-gray-50 transition text-xs"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <ChevronDown size={12} className="text-gray-400 shrink-0" /> : <ChevronRight size={12} className="text-gray-400 shrink-0" />}
        <span className="font-mono font-bold text-[11px] w-12 shrink-0">{entry.method}</span>
        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${statusColor}`}>
          {entry.error ? 'ERR' : entry.responseStatus ?? '...'}
        </span>
        <span className="font-mono text-[11px] truncate flex-1 min-w-0" title={entry.url}>{entry.url}</span>
        {entry.isSSE && (
          <span className="px-1.5 py-0.5 rounded text-[10px] bg-purple-50 text-purple-600 shrink-0">SSE</span>
        )}
        {entry.duration !== null && (
          <span className="text-[10px] text-gray-400 shrink-0 w-16 text-right">{entry.duration}ms</span>
        )}
        <span className="text-[10px] text-gray-300 shrink-0">{entry.timestamp}</span>
      </div>

      {expanded && (
        <div className="px-3 pb-3 ml-5 space-y-2">
          {/* 完整 URL */}
          <div className="text-[11px]">
            <span className="text-gray-500 font-medium">完整地址: </span>
            <span className="font-mono text-blue-600 break-all">{entry.url}</span>
          </div>

          {/* 请求参数 */}
          {entry.requestBody && (
            <JsonBlock data={entry.requestBody} label="请求参数" />
          )}

          {/* 响应结果 */}
          {entry.responseBody !== undefined && (
            <JsonBlock data={entry.responseBody} label="响应结果" />
          )}

          {/* SSE 事件列表 */}
          {entry.isSSE && entry.sseEvents && entry.sseEvents.length > 0 && (
            <div className="mt-1">
              <div className="text-[11px] text-gray-500 font-medium mb-1">SSE 事件 ({entry.sseEvents.length})</div>
              <div className="max-h-[200px] overflow-auto border border-gray-200 rounded">
                {entry.sseEvents.map((evt, i) => (
                  <div key={i} className="flex items-start gap-2 px-2 py-1 text-[10px] font-mono border-b border-gray-50 last:border-b-0">
                    <span className={`shrink-0 px-1 py-0.5 rounded ${
                      evt.type === 'error' ? 'bg-red-100 text-red-600' :
                      evt.type === 'done' ? 'bg-green-100 text-green-600' :
                      evt.type === 'thinking' ? 'bg-yellow-100 text-yellow-600' :
                      'bg-gray-100 text-gray-500'
                    }`}>{evt.type}</span>
                    <span className="break-all text-gray-600 min-w-0">
                      {typeof evt.data === 'string' ? evt.data.slice(0, 200) : JSON.stringify(evt.data).slice(0, 200)}
                      {(typeof evt.data === 'string' ? evt.data.length : JSON.stringify(evt.data).length) > 200 && '...'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 错误信息 */}
          {entry.error && (
            <div className="mt-1 p-2 bg-red-50 border border-red-200 rounded text-[11px] text-red-600">
              {entry.error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function RequestLogPanel({ logs, onClear, onClose }: Props) {
  return (
    <div className="border-t border-gray-300 bg-white flex flex-col" style={{ height: '40%', minHeight: 200 }}>
      {/* 标题栏 */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-200 bg-gray-50 shrink-0">
        <span className="text-xs font-bold text-gray-600">网络请求日志</span>
        <span className="text-[10px] text-gray-400">({logs.length} 条)</span>
        <div className="flex-1" />
        <button
          onClick={onClear}
          className="flex items-center gap-1 px-2 py-0.5 text-[10px] text-gray-400 hover:text-red-500 transition"
          title="清空日志"
        >
          <Trash2 size={11} /> 清空
        </button>
        <button onClick={onClose} className="p-0.5 text-gray-400 hover:text-gray-600 transition">
          <X size={14} />
        </button>
      </div>

      {/* 日志列表 */}
      <div className="flex-1 overflow-auto">
        {logs.length === 0 ? (
          <div className="flex items-center justify-center h-full text-xs text-gray-400">
            暂无请求记录，操作后会自动记录
          </div>
        ) : (
          logs.map(entry => <LogEntry key={entry.id} entry={entry} />)
        )}
      </div>
    </div>
  );
}
