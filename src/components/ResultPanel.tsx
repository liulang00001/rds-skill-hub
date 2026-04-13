'use client';

import { useCallback, useState } from 'react';
import { ExecutionResult, StepReport } from '@/lib/types';
import { Download, ChevronDown, ChevronRight, Activity, Search, BarChart3, Clock, Zap, GitBranch, Repeat, Filter, Hash, ArrowRightLeft, ListOrdered, SlidersHorizontal, Gauge, TrendingUp, Layers } from 'lucide-react';

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

interface ResultPanelProps {
  result: ExecutionResult;
  code?: string;
}

/** 步骤卡片组件 */
function StepCard({ step, defaultOpen }: { step: StepReport; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const icon = MODULE_ICONS[step.module] || <Activity size={14} className="text-gray-400" />;
  const moduleLabel = MODULE_LABELS[step.module] || step.module;

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-gray-50 hover:bg-gray-100 transition text-left"
      >
        {open ? <ChevronDown size={14} className="text-gray-400 shrink-0" /> : <ChevronRight size={14} className="text-gray-400 shrink-0" />}
        {icon}
        <span className="font-medium text-sm truncate">{step.label}</span>
        <span className="ml-auto flex items-center gap-2 shrink-0">
          <span className="px-1.5 py-0.5 text-[10px] rounded bg-gray-200 text-gray-600 font-mono">{moduleLabel}</span>
          <span className="text-[10px] text-gray-400">{step.messages.length} 条</span>
        </span>
      </button>
      {open && (
        <div className="px-3 py-2 bg-white space-y-0.5 max-h-48 overflow-auto">
          {step.messages.map((msg, i) => (
            <div key={i} className="text-xs font-mono text-gray-700 leading-relaxed py-0.5">
              <span className="text-gray-300 mr-2 select-none">{i + 1}.</span>
              {msg}
            </div>
          ))}
        </div>
      )}
    </div>
  );
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
  const [showDebugLogs, setShowDebugLogs] = useState(false);

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

  const hasSteps = result.steps && result.steps.length > 0;

  return (
    <div className="h-full overflow-auto p-4 space-y-4 text-sm">
      {/* 摘要卡片：成功/失败 + summary + 耗时 */}
      <div className={`p-3 rounded border-l-4 ${result.success ? 'bg-green-50 border-green-500 text-green-800' : 'bg-red-50 border-red-500 text-red-800'}`}>
        <div className="flex items-center justify-between">
          <div className="font-bold">{result.success ? '✅ 执行成功' : '❌ 执行失败'}</div>
          <button
            onClick={handleDownloadLog}
            className="flex items-center gap-1 px-2 py-1 text-xs bg-white border border-gray-300 rounded hover:bg-gray-50 transition text-gray-700"
          >
            <Download size={12} />
            下载调试日志
          </button>
        </div>
        <div className="mt-1">{result.summary}</div>
        <div className="mt-1 text-xs opacity-70">耗时 {result.duration}ms</div>
      </div>

      {/* 步骤卡片列表 */}
      {hasSteps && (
        <div>
          <h3 className="font-bold mb-2 text-gray-700">分析步骤 ({result.steps.length})</h3>
          <div className="space-y-2">
            {result.steps.map((step, i) => (
              <StepCard key={step.stepId} step={step} defaultOpen={i < 2} />
            ))}
          </div>
        </div>
      )}

      {/* 兼容旧代码：无 steps 时回退显示 report */}
      {!hasSteps && result.report && result.report.length > 0 && (
        <div>
          <h3 className="font-bold mb-2 text-gray-700">分析报告</h3>
          <div className="bg-white border border-gray-200 rounded-lg p-3 text-xs font-mono space-y-0.5 max-h-80 overflow-auto">
            {result.report.map((line, i) => (
              <div key={i} className="leading-relaxed">{line}</div>
            ))}
          </div>
        </div>
      )}

      {/* 系统调试日志（可折叠） */}
      {result.logs.length > 0 && (
        <div>
          <button
            onClick={() => setShowDebugLogs(!showDebugLogs)}
            className="flex items-center gap-1 font-bold mb-2 text-gray-500 hover:text-gray-700 transition"
          >
            {showDebugLogs ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            系统调试日志 ({result.logs.length})
          </button>
          {showDebugLogs && (
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
          )}
        </div>
      )}
    </div>
  );
}
