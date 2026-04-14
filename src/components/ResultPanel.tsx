'use client';

import { useCallback } from 'react';
import { ExecutionResult, Finding, StepReport, OutputEntry } from '@/lib/types';
import { Download, Activity, Search, BarChart3, Clock, Zap, GitBranch, Repeat, Filter, Hash, ArrowRightLeft, ListOrdered, SlidersHorizontal, Gauge, TrendingUp, Layers, CheckCircle2, AlertTriangle, XCircle, Info } from 'lucide-react';

/** 模块类型 → 图标映射 */
const MODULE_ICONS: Record<string, React.ReactNode> = {
  detectTransition: <Zap size={14} className="text-amber-500" />,
  detectMultiTransition: <Zap size={14} className="text-amber-600" />,
  forEachEvent: <Repeat size={14} className="text-blue-500" />,
  scanAll: <Search size={14} className="text-blue-500" />,
  loopScan: <Repeat size={14} className="text-indigo-500" />,
  aggregate: <BarChart3 size={14} className="text-green-500" />,
  detectDuration: <Clock size={14} className="text-purple-500" />,
  countOccurrences: <Hash size={14} className="text-teal-500" />,
  findFirst: <Search size={14} className="text-cyan-500" />,
  findAll: <Search size={14} className="text-cyan-600" />,
  checkValue: <Filter size={14} className="text-orange-500" />,
  checkMultiValues: <Filter size={14} className="text-orange-600" />,
  checkTimeRange: <Clock size={14} className="text-violet-500" />,
  switchValue: <GitBranch size={14} className="text-pink-500" />,
  compareSignals: <ArrowRightLeft size={14} className="text-rose-500" />,
  detectSequence: <ListOrdered size={14} className="text-emerald-500" />,
  slidingWindow: <SlidersHorizontal size={14} className="text-sky-500" />,
  detectStable: <Gauge size={14} className="text-lime-600" />,
  detectOscillation: <Activity size={14} className="text-red-500" />,
  computeRate: <TrendingUp size={14} className="text-fuchsia-500" />,
  groupByState: <Layers size={14} className="text-stone-500" />,
};

/** 模块类型 → 中文名 */
const MODULE_LABELS: Record<string, string> = {
  detectTransition: '跳变检测',
  detectMultiTransition: '多信号跳变',
  forEachEvent: '遍历事件',
  scanAll: '全量扫描',
  loopScan: '循环扫描',
  aggregate: '统计分析',
  detectDuration: '持续检测',
  countOccurrences: '计数',
  findFirst: '查找首个',
  findAll: '查找全部',
  checkValue: '值检查',
  checkMultiValues: '多值检查',
  checkTimeRange: '时间范围',
  switchValue: '分支',
  compareSignals: '信号比较',
  detectSequence: '序列检测',
  slidingWindow: '滑动窗口',
  detectStable: '稳态检测',
  detectOscillation: '抖动检测',
  computeRate: '变化率',
  groupByState: '状态分组',
};

/** Finding 类型 → 颜色样式 */
const FINDING_STYLES: Record<string, { icon: React.ReactNode; text: string; dot: string }> = {
  success: { icon: <CheckCircle2 size={13} className="text-green-500 shrink-0" />, text: 'text-green-700', dot: 'bg-green-500' },
  warning: { icon: <AlertTriangle size={13} className="text-amber-500 shrink-0" />, text: 'text-amber-700', dot: 'bg-amber-500' },
  error:   { icon: <XCircle size={13} className="text-red-500 shrink-0" />, text: 'text-red-700', dot: 'bg-red-500' },
  info:    { icon: <Info size={13} className="text-blue-500 shrink-0" />, text: 'text-blue-700', dot: 'bg-blue-500' },
};

interface ResultPanelProps {
  result: ExecutionResult;
  code?: string;
}

/** 生成调试日志文件内容 */
function buildDebugLog(result: ExecutionResult, code?: string): string {
  const lines: string[] = [];
  const now = new Date().toLocaleString('zh-CN');

  lines.push('='.repeat(60));
  lines.push(`  调试日志 - ${now}`);
  lines.push('='.repeat(60));
  lines.push('');

  lines.push('## 执行概况');
  lines.push(`状态: ${result.success ? '成功' : '失败'}`);
  lines.push(`耗时: ${result.duration}ms`);
  lines.push(`摘要: ${result.summary}`);
  lines.push('');

  // 步骤报告
  if (result.steps && result.steps.length > 0) {
    lines.push('## 步骤报告');
    for (const step of result.steps) {
      lines.push(`[${step.module}] ${step.label}`);
      for (const msg of step.messages) {
        lines.push(`  ${msg}`);
      }
    }
    lines.push('');
  }

  // 兼容旧 report
  if (result.report && result.report.length > 0) {
    lines.push('## 分析报告');
    for (const line of result.report) lines.push(line);
    lines.push('');
  }

  lines.push('## 分析发现');
  if (result.findings.length === 0) {
    lines.push('（无）');
  } else {
    for (const f of result.findings) {
      const icon = f.type === 'success' ? '[OK]' : f.type === 'warning' ? '[WARN]' : f.type === 'error' ? '[ERR]' : '[INFO]';
      lines.push(`${icon} ${f.message}`);
      if (f.time) lines.push(`     时间: ${f.time}`);
      if (f.details) lines.push(`     详情: ${JSON.stringify(f.details)}`);
    }
  }
  lines.push('');

  lines.push('## 系统调试日志');
  if (result.logs.length > 0) {
    for (const log of result.logs) lines.push(log);
  } else {
    lines.push('（无）');
  }
  lines.push('');

  if (code) {
    lines.push('## 分析代码');
    lines.push('```typescript');
    lines.push(code);
    lines.push('```');
    lines.push('');
  }

  lines.push('='.repeat(60));
  return lines.join('\n');
}

export default function ResultPanel({ result, code }: ResultPanelProps) {
  const handleDownloadLog = useCallback(() => {
    const content = buildDebugLog(result, code);
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    a.href = url;
    a.download = `debug-log-${timestamp}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }, [result, code]);

  const outputTimeline = result.outputTimeline || [];
  const hasTimeline = outputTimeline.length > 0;

  return (
    <div className="h-full overflow-auto p-4 space-y-4 text-sm">
      {/* ===== 摘要卡片：成功/失败 + 耗时（无 summary） ===== */}
      <div className={`px-3 py-2 rounded border-l-4 flex items-center justify-between ${result.success ? 'bg-green-50 border-green-500 text-green-800' : 'bg-red-50 border-red-500 text-red-800'}`}>
        <div className="font-bold">{result.success ? '✅ 执行成功' : '❌ 执行失败'}</div>
        <div className="text-xs opacity-70">耗时 {result.duration}ms</div>
      </div>

      {/* ===== 判断结果 — 按实际执行顺序的时间线树 ===== */}
      {hasTimeline && (
        <div>
          <h3 className="font-bold mb-2 text-gray-700">判断结果</h3>
          <div className="relative pl-4 border-l-2 border-gray-200 space-y-0">
            {outputTimeline.map((item, i) => {
              if (item.kind === 'step-header') {
                const icon = MODULE_ICONS[item.module] || <Activity size={14} className="text-gray-400" />;
                const moduleLabel = MODULE_LABELS[item.module] || item.module;
                return (
                  <div key={`sh-${i}`} className="relative flex items-center gap-2 py-1.5">
                    <div className="absolute -left-[21px] w-2.5 h-2.5 rounded-full bg-gray-400 border-2 border-white" />
                    {icon}
                    <span className="font-semibold text-sm text-gray-800">{item.label}</span>
                    <span className="px-1.5 py-0.5 text-[10px] rounded bg-gray-100 text-gray-500 font-mono">{moduleLabel}</span>
                  </div>
                );
              }

              if (item.kind === 'step-msg') {
                return (
                  <div key={`msg-${i}`} className="relative pl-5 py-0.5">
                    <div className="absolute -left-[17px] top-[10px] w-1.5 h-1.5 rounded-full bg-gray-300" />
                    <div className="text-xs font-mono text-gray-600 leading-relaxed">{item.text}</div>
                  </div>
                );
              }

              if (item.kind === 'log') {
                return (
                  <div key={`log-${i}`} className="relative pl-5 py-0.5">
                    <div className="absolute -left-[17px] top-[10px] w-1.5 h-1.5 rounded-full bg-violet-400" />
                    <div className="text-xs font-mono text-violet-700 leading-relaxed">{item.text}</div>
                  </div>
                );
              }

              if (item.kind === 'finding') {
                const style = FINDING_STYLES[item.finding.type] || FINDING_STYLES.info;
                return (
                  <div key={`fd-${i}`} className="relative flex items-start gap-2 pl-5 py-1">
                    <div className={`absolute -left-[19px] top-[8px] w-2 h-2 rounded-full ${style.dot} border-2 border-white`} />
                    {style.icon}
                    <div className="flex-1 min-w-0">
                      <span className={`text-xs font-medium ${style.text}`}>{item.finding.message}</span>
                      {(item.finding.time || item.finding.details) && (
                        <div className="text-[11px] text-gray-400 mt-0.5">
                          {item.finding.time && <span>时间: {item.finding.time}</span>}
                          {item.finding.details && Object.keys(item.finding.details).length > 0 && (
                            <span className="ml-2 font-mono">
                              {Object.entries(item.finding.details).map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`).join('  ')}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              }

              return null;
            })}
          </div>
        </div>
      )}

      {/* ===== 系统调试日志 — 默认展开，日志下载按钮在标题右侧 ===== */}
      {result.logs.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-bold text-gray-500">系统调试日志 ({result.logs.length})</h3>
            <button
              onClick={handleDownloadLog}
              className="flex items-center gap-1 px-2 py-1 text-xs bg-white border border-gray-300 rounded hover:bg-gray-50 transition text-gray-700"
            >
              <Download size={12} />
              日志下载
            </button>
          </div>
          <div className="bg-gray-900 text-green-400 rounded p-3 text-xs font-mono max-h-60 overflow-auto">
            {result.logs.map((log, i) => (
              <div key={i} className={
                log.includes('[FATAL]') || log.includes('[ERROR]') ? 'text-red-400' :
                log.includes('[WARN]') ? 'text-yellow-400' :
                log.includes('[TRACE') ? 'text-cyan-400' :
                log.includes('[DEBUG') ? 'text-purple-400' :
                log.includes('[INFO]') ? 'text-blue-400' :
                ''
              }>
                {log}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
