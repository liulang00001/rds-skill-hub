/**
 * 代码执行器：在受控环境中执行 LLM 生成的分析代码
 *
 * 策略：用 ts-morph 将 TypeScript 编译为 JavaScript，再通过 Function 构造器执行
 * 生产环境可升级为 quickjs-emscripten 沙箱
 */
import { DataTable, ExecutionResult, Finding, StepReport, OutputEntry } from './types';
import { Project, ScriptTarget, ModuleKind, SyntaxKind } from 'ts-morph';
import {
  scanAll, checkValue, checkMultiValues,
  detectTransition, detectMultiTransition,
  checkTimeRange, loopScan, switchValue, forEachEvent,
  aggregate, detectDuration, countOccurrences,
  findFirst, findAll,
  // V2.1 新增模块
  compareSignals, detectSequence, slidingWindow,
  detectStable, detectOscillation, computeRate, groupByState,
} from './standard-modules';

/** 将 DataTable 转为 SignalRow[] 格式供分析函数使用 */
function tableToSignalRows(table: DataTable): Record<string, any>[] {
  const timeColIdx = table.headers.findIndex(h => {
    const cleaned = h.replace(/[\r\n]+/g, '').trim();
    return cleaned.includes('时间') || cleaned.includes('time') || cleaned.includes('Time') || cleaned.includes('采集');
  });

  // 清理列名中的换行符和多余空格
  const cleanHeaders = table.headers.map(h => h.replace(/[\r\n]+/g, '').trim());

  return table.rows.map(row => {
    const obj: Record<string, any> = {};
    for (let i = 0; i < cleanHeaders.length; i++) {
      const header = cleanHeaders[i];
      let value = row[i];
      // 自动转数字
      if (typeof value === 'string') {
        const num = Number(value);
        if (!isNaN(num) && value.trim() !== '') value = num;
      }
      obj[header] = value;
      // 时间列特殊处理
      if (i === timeColIdx) obj['time'] = String(value);
    }
    // 确保有 time 字段
    if (!obj['time'] && timeColIdx >= 0) obj['time'] = String(row[timeColIdx]);
    if (!obj['time']) obj['time'] = `row_${table.rows.indexOf(row)}`;
    return obj;
  });
}

/** 用 ts-morph 将 TypeScript 编译为 JavaScript */
function compileTypeScript(code: string): string {
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: {
      target: ScriptTarget.ES2020,
      module: ModuleKind.None,
      strict: false,
      removeComments: false,
    },
  });

  const sourceFile = project.createSourceFile('analyze.ts', code);
  const emitOutput = sourceFile.getEmitOutput();
  const jsFile = emitOutput.getOutputFiles()[0];

  if (!jsFile) {
    throw new Error('TypeScript 编译失败：无输出');
  }

  return jsFile.getText()
    .replace(/^"use strict";\s*/gm, '')
    .replace(/^Object\.defineProperty\(exports.*\n?/gm, '')
    .replace(/^exports\.\w+\s*=.*\n?/gm, '')
    .replace(/^export\s+/gm, '');
}

/** 从 TypeScript 源码中提取所有顶层函数名 */
function extractFunctionNames(code: string): string[] {
  const project = new Project({ useInMemoryFileSystem: true });
  const sourceFile = project.createSourceFile('_extract.ts', code);
  return sourceFile.getFunctions().map(f => f.getName()).filter((n): n is string => !!n);
}

/** 从代码中提取可能被引用的信号名，与实际列名做预检 */
function preflightSignalCheck(code: string, headers: string[]): string[] {
  const warnings: string[] = [];
  const cleanHeaders = headers.map(h => h.replace(/[\r\n]+/g, '').trim());
  const headerSet = new Set(cleanHeaders);

  // 提取代码中所有被引号包裹的字符串字面量
  const strLiterals = new Set<string>();
  // 匹配单引号和双引号字符串
  const regex = /["']([^"']{2,})["']/g;
  let match;
  while ((match = regex.exec(code)) !== null) {
    strLiterals.add(match[1]);
  }

  // 排除明显不是信号名的关键字
  const excludeSet = new Set([
    'and', 'or', 'true', 'false', 'always', 'ever', 'never',
    'success', 'warning', 'info', 'error',
    'abs', 'in', 'not_in', 'use strict',
    'row', 'data', 'findings', 'idx', 'time',
    '__step', 'label', 'module', 'msg',
  ]);

  // 排除长文本（消息模板等）和包含空格的句子
  const candidateSignals: string[] = [];
  for (const s of strLiterals) {
    if (excludeSet.has(s)) continue;
    if (s.length > 60) continue; // 太长的不是信号名
    if (/[\u4e00-\u9fa5].*[\u4e00-\u9fa5]/.test(s) && s.length > 20) continue; // 中文长句
    // 只保留看起来像信号名的：英文标识符、或带中文的短名称
    if (/^[a-zA-Z_][\w]*$/.test(s) || /^[\u4e00-\u9fa5a-zA-Z0-9_()（）]+$/.test(s)) {
      candidateSignals.push(s);
    }
  }

  // 与实际列名对比
  const missingSignals: string[] = [];
  for (const signal of candidateSignals) {
    if (!headerSet.has(signal) && signal !== 'time') {
      // 排除代码关键字和模块名
      if (/^(function|const|let|var|return|if|else|for|while|break|continue|switch|case|typeof|string|number|boolean|object|any|void|null|undefined|SignalRow|Finding|AnalysisResult)$/.test(signal)) continue;
      missingSignals.push(signal);
    }
  }

  if (missingSignals.length > 0) {
    warnings.push(`[WARN] 以下信号名在数据列中未找到: ${missingSignals.join(', ')}`);
    warnings.push(`[WARN] 可用列名: ${cleanHeaders.join(', ')}`);

    // 简单相似度匹配：为每个缺失信号找最相似的列名
    for (const missing of missingSignals) {
      const similar = cleanHeaders.filter(h =>
        h.toLowerCase().includes(missing.toLowerCase()) ||
        missing.toLowerCase().includes(h.toLowerCase())
      );
      if (similar.length > 0) {
        warnings.push(`[HINT] "${missing}" → 最相似的列名: ${similar.join(', ')}`);
      }
    }
  }

  return warnings;
}

/** 生成函数追踪包装代码（输出到 console.log） */
function buildTraceCode(funcNames: string[]): string {
  const helpers = funcNames.filter(n => n !== 'analyze');
  if (helpers.length === 0) return '';

  let code = `
var __callSeq = 0;
var __debuggedFns = {};
function __wrapTrace(name, fn) {
  return function() {
    var seq = ++__callSeq;
    var argsSummary = [];
    for (var i = 0; i < arguments.length; i++) {
      var a = arguments[i];
      if (a && typeof a === 'object' && a.time) argsSummary.push('row@' + a.time);
      else if (Array.isArray(a)) argsSummary.push('Array(' + a.length + ')');
      else argsSummary.push(typeof a === 'object' ? JSON.stringify(a).substring(0, 60) : String(a));
    }
    console.log('[TRACE #' + seq + '] >> ' + name + '(' + argsSummary.join(', ') + ')');

    // 前5次调用打印每个参数的所有字段值
    if (!__debuggedFns[name]) __debuggedFns[name] = 0;
    __debuggedFns[name]++;
    if (__debuggedFns[name] <= 5) {
      for (var i = 0; i < arguments.length; i++) {
        var a = arguments[i];
        if (a && typeof a === 'object' && !Array.isArray(a)) {
          var keys = Object.keys(a);
          var details = [];
          for (var k = 0; k < keys.length; k++) {
            var key = keys[k];
            var val = a[key];
            details.push(key + '=' + JSON.stringify(val));
          }
          console.log('[DEBUG #' + __debuggedFns[name] + '] ' + name + ' arg[' + i + ']: {' + details.join(', ') + '}');
        }
      }
    }

    var result = fn.apply(this, arguments);
    var resultStr = typeof result === 'object' && result !== null ? JSON.stringify(result).substring(0, 120) : String(result);
    console.log('[TRACE #' + seq + '] << ' + name + ' => ' + resultStr);
    return result;
  };
}
`;
  code += helpers.map(n => `${n} = __wrapTrace('${n}', ${n});`).join('\n');
  return code;
}

/**
 * 执行分析代码
 */
export function executeCode(code: string, table: DataTable): ExecutionResult {
  const startTime = Date.now();
  const report: string[] = [];  // 代码中 console.log 输出 → 分析报告（兼容旧代码）
  const logs: string[] = [];    // 系统追踪日志
  const findings: Finding[] = [];
  const stepsMap = new Map<string, StepReport>();  // 结构化步骤报告
  const outputTimeline: OutputEntry[] = [];  // 按实际执行顺序记录所有输出

  try {
    const data = tableToSignalRows(table);
    const funcNames = extractFunctionNames(code);
    const cleanedCode = compileTypeScript(code);
    const traceCode = buildTraceCode(funcNames);

    logs.push(`[INFO] 数据行数: ${data.length}`);
    logs.push(`[INFO] 数据列名: ${table.headers.join(', ')}`);
    logs.push(`[INFO] 首行数据: ${JSON.stringify(data[0]).substring(0, 300)}`);
    logs.push(`[INFO] 检测到函数: ${funcNames.join(', ')}`);

    // 预检：信号名与列名对比
    const preflightWarnings = preflightSignalCheck(code, table.headers);
    for (const w of preflightWarnings) {
      logs.push(w);
    }

    logs.push(`[INFO] 开始执行分析...`);

    // 构建可执行代码
    const execCode = `
      ${cleanedCode}
      ${traceCode}

      // 执行入口
      var __result = analyze(__data);
      __result;
    `;

    // 创建受控 console：区分报告输出和系统日志
    const safeConsole = {
      log: (...args: any[]) => {
        const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
        // 系统追踪前缀 → 归入 logs
        if (msg.startsWith('[TRACE') || msg.startsWith('[DEBUG') || msg.startsWith('[INFO]')) {
          logs.push(msg);
          return;
        }
        // 尝试解析结构化步骤输出
        try {
          const parsed = JSON.parse(msg);
          if (parsed && parsed.__step) {
            const key = parsed.__step;
            if (!stepsMap.has(key)) {
              stepsMap.set(key, { stepId: key, label: parsed.label || key, module: parsed.module || '', messages: [] });
            }
            stepsMap.get(key)!.messages.push(parsed.msg);
            // 每次调用都写入时间线，不去重
            outputTimeline.push({ kind: 'step-header', stepId: key, label: parsed.label || key, module: parsed.module || '' });
            outputTimeline.push({ kind: 'step-msg', stepId: key, text: parsed.msg });
            return;
          }
        } catch { /* 非 JSON，走兜底 */ }
        // 兜底：普通文本 → report（兼容旧代码/用户手写代码）
        report.push(msg);
        outputTimeline.push({ kind: 'log', text: msg });
      },
      warn: (...args: any[]) => {
        const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
        logs.push(`[WARN] ${msg}`);
      },
      error: (...args: any[]) => {
        const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
        logs.push(`[ERROR] ${msg}`);
      },
    };

    // 运行时信号名缺失检测（去重）
    const warnedSignals = new Set<string>();
    const dataKeys = data.length > 0 ? new Set(Object.keys(data[0])) : new Set<string>();
    const warnMissingSignal = (signal: string, context: string) => {
      if (warnedSignals.has(signal)) return;
      if (!dataKeys.has(signal)) {
        warnedSignals.add(signal);
        safeConsole.warn(`信号 "${signal}" 在数据中不存在 (调用自 ${context})。可用列名: ${[...dataKeys].join(', ')}`);
      }
    };

    // 包装 checkValue：当 signal 在数据中不存在时发出警告
    const wrappedCheckValue: typeof checkValue = (row, signal, operator, value, transform?) => {
      if (row && row[signal] === undefined) {
        warnMissingSignal(signal, 'checkValue');
      }
      return checkValue(row, signal, operator, value, transform);
    };

    // 包装 detectTransition：检查 signal 是否存在
    const wrappedDetectTransition: typeof detectTransition = (data, signal, from, to, multiple?, startIndex?, endIndex?) => {
      if (data.length > 0 && data[0][signal] === undefined) {
        warnMissingSignal(signal, 'detectTransition');
      }
      return detectTransition(data, signal, from, to, multiple, startIndex, endIndex);
    };

    // 包装 aggregate：检查 signal 是否存在
    const wrappedAggregate: typeof aggregate = (data, signal, startIndex, endIndex) => {
      if (data.length > 0 && data[0][signal] === undefined) {
        warnMissingSignal(signal, 'aggregate');
      }
      return aggregate(data, signal, startIndex, endIndex);
    };

    // 包装 compareSignals：检查两个 signal 是否存在
    const wrappedCompareSignals: typeof compareSignals = (row, signalA, operator, signalB, offsetB?) => {
      if (row) {
        if (row[signalA] === undefined) warnMissingSignal(signalA, 'compareSignals');
        if (row[signalB] === undefined) warnMissingSignal(signalB, 'compareSignals');
      }
      return compareSignals(row, signalA, operator, signalB, offsetB);
    };

    // 包装 detectStable：检查 signal 是否存在
    const wrappedDetectStable: typeof detectStable = (data, signal, startIndex, tolerance, minDuration?, maxRows?) => {
      if (data.length > 0 && data[0][signal] === undefined) {
        warnMissingSignal(signal, 'detectStable');
      }
      return detectStable(data, signal, startIndex, tolerance, minDuration, maxRows);
    };

    // 包装 detectOscillation：检查 signal 是否存在
    const wrappedDetectOscillation: typeof detectOscillation = (data, signal, startIndex, windowSize, minChanges?) => {
      if (data.length > 0 && data[0][signal] === undefined) {
        warnMissingSignal(signal, 'detectOscillation');
      }
      return detectOscillation(data, signal, startIndex, windowSize, minChanges);
    };

    // 包装 computeRate：检查 signal 是否存在
    const wrappedComputeRate: typeof computeRate = (data, signal, startIndex?, endIndex?) => {
      if (data.length > 0 && data[0][signal] === undefined) {
        warnMissingSignal(signal, 'computeRate');
      }
      return computeRate(data, signal, startIndex, endIndex);
    };

    // 包装 groupByState：检查 signal 是否存在
    const wrappedGroupByState: typeof groupByState = (data, signal, startIndex?, endIndex?) => {
      if (data.length > 0 && data[0][signal] === undefined) {
        warnMissingSignal(signal, 'groupByState');
      }
      return groupByState(data, signal, startIndex, endIndex);
    };

    // 包装 checkMultiValues：检查每个 condition 的 signal 是否存在
    const wrappedCheckMultiValues: typeof checkMultiValues = (row, conditions, logic?) => {
      if (row) {
        for (const c of conditions) {
          if (row[c.signal] === undefined) {
            warnMissingSignal(c.signal, 'checkMultiValues');
          }
        }
      }
      return checkMultiValues(row, conditions, logic);
    };

    // 包装 detectMultiTransition：检查每个 transition 的 signal 是否存在
    const wrappedDetectMultiTransition: typeof detectMultiTransition = (data, transitions, contextConditions?, multiple?, startIndex?, endIndex?) => {
      if (data.length > 0) {
        for (const t of transitions) {
          if (data[0][t.signal] === undefined) {
            warnMissingSignal(t.signal, 'detectMultiTransition');
          }
        }
        if (contextConditions) {
          for (const c of contextConditions) {
            if (data[0][c.signal] === undefined) {
              warnMissingSignal(c.signal, 'detectMultiTransition.contextConditions');
            }
          }
        }
      }
      return detectMultiTransition(data, transitions, contextConditions, multiple, startIndex, endIndex);
    };

    // 包装 switchValue：检查 signal 是否存在
    const wrappedSwitchValue: typeof switchValue = (row, signal, cases, defaultHandler?) => {
      if (row && row[signal] === undefined) {
        warnMissingSignal(signal, 'switchValue');
      }
      return switchValue(row, signal, cases, defaultHandler);
    };

    // 用 Function 构造器执行（受控作用域，注入标准模块）
    const fn = new Function(
      '__data', 'console', 'Math', 'JSON', 'Array', 'Object', 'Number', 'String', 'Boolean', 'Date', 'isNaN', 'parseInt', 'parseFloat', 'Infinity', 'NaN', 'undefined',
      'max', 'min', 'abs', 'floor', 'ceil', 'round', 'sqrt', 'pow',
      // 标准模块注入（使用包装版本）
      'scanAll', 'checkValue', 'checkMultiValues',
      'detectTransition', 'detectMultiTransition',
      'checkTimeRange', 'loopScan', 'switchValue', 'forEachEvent',
      'aggregate', 'detectDuration', 'countOccurrences',
      'findFirst', 'findAll',
      // V2.1 新增模块
      'compareSignals', 'detectSequence', 'slidingWindow',
      'detectStable', 'detectOscillation', 'computeRate', 'groupByState',
      execCode
    );

    const result = fn(
      data, safeConsole, Math, JSON, Array, Object, Number, String, Boolean, Date, isNaN, parseInt, parseFloat, Infinity, NaN, undefined,
      Math.max, Math.min, Math.abs, Math.floor, Math.ceil, Math.round, Math.sqrt, Math.pow,
      // 标准模块函数（使用包装版本检测信号名缺失）
      scanAll, wrappedCheckValue, wrappedCheckMultiValues,
      wrappedDetectTransition, wrappedDetectMultiTransition,
      checkTimeRange, loopScan, wrappedSwitchValue, forEachEvent,
      wrappedAggregate, detectDuration, countOccurrences,
      findFirst, findAll,
      // V2.1 新增模块
      wrappedCompareSignals, detectSequence, slidingWindow,
      wrappedDetectStable, wrappedDetectOscillation, wrappedComputeRate, wrappedGroupByState
    );

    const duration = Date.now() - startTime;

    if (result && result.findings) {
      findings.push(...result.findings);
      // findings 也按顺序追加到统一时间线
      for (const f of result.findings) {
        outputTimeline.push({ kind: 'finding', finding: f });
      }
    }

    // 生成时间轴
    const timeline = findings.map((f, i) => ({
      time: f.time || `#${i + 1}`,
      event: `[${f.type}] ${f.message}`,
      row: f.details?.row,
    }));

    return {
      success: true,
      findings,
      timeline,
      summary: result?.summary || `分析完成，发现 ${findings.length} 个事件`,
      duration,
      report,
      logs,
      steps: Array.from(stepsMap.values()),
      outputTimeline,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    const errMsg = error instanceof Error ? error.message : String(error);
    logs.push(`[FATAL] ${errMsg}`);

    outputTimeline.push({ kind: 'finding', finding: { time: '', type: 'error', message: `执行错误: ${errMsg}` } });

    return {
      success: false,
      findings: [{ time: '', type: 'error', message: `执行错误: ${errMsg}` }],
      timeline: [],
      summary: `执行失败: ${errMsg}`,
      duration,
      report,
      logs,
      steps: Array.from(stepsMap.values()),
      outputTimeline,
    };
  }
}
