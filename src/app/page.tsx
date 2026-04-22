'use client';

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { FlowChart, DataTable, ExecutionResult } from '@/lib/types';
import { WorkflowDefinition } from '@/lib/workflow-schema';
import { workflowToFlowChart } from '@/lib/json-to-flow';
import ResultPanel from '@/components/ResultPanel';
import LineNumberedTextarea from '@/components/LineNumberedTextarea';
import DataPreviewPanel, { formatHeader } from '@/components/DataPreviewPanel';
import { FileUp, Play, Sparkles, Code2, GitBranch, Terminal, Save, Trash2, Table2, Braces, Check, X, ClipboardList, ShieldCheck, AlertTriangle, CheckCircle2, Info, XCircle, BookMarked, ChevronDown, Diff, Activity } from 'lucide-react';
import { API_VALIDATE_BASE, API_GENERATE_BASE, apiUrl } from '@/lib/api-config';
import { getClientContext } from '@/lib/client-context';
import { logEvent } from '@/lib/browser-logger';
import { parseSSEStream } from '@/lib/sse-parser';
import ThinkingDrawer from '@/components/ThinkingDrawer';
import DiffModal from '@/components/DiffModal';
import RequestLogPanel, { RequestLogEntry } from '@/components/RequestLogPanel';
import FeedbackFab from '@/components/FeedbackFab';

interface SavedSkill {
  name: string;
  fileName: string;
  updatedAt: string;
  size: number;
  description: string;
}

interface SkillData {
  name: string;
  description: string;
  signalsDef: string;
  analyzeSteps: string;
  workflowDef: any;
  code: string;
  validationResult?: ValidationResult | null;
  savedAt: string;
}

// 动态加载避免 SSR 问题
const CodeEditor = dynamic(() => import('@/components/CodeEditor'), { ssr: false });
const FlowChartView = dynamic(() => import('@/components/FlowChart'), { ssr: false });
const MonacoEditor = dynamic(() => import('@monaco-editor/react').then(m => m.default), { ssr: false });

type Tab = 'logic' | 'flow' | 'data' | 'result' | 'code';

interface ValidationResult {
  signalCheck: { passed: boolean; issues: Array<{ signal: string; line?: number; message: string; suggestion?: string }> };
  logicCheck: { passed: boolean; issues: Array<{ step: string; line?: number; type: string; message: string }> };
  adaptabilityCheck: { passed: boolean; issues: Array<{ step: string; line?: number; type: string; message: string; suggestion?: string }> };
  summary: string;
  optimizedSteps?: string;
}

export default function Home() {
  // === 核心状态 ===
  const [workflowDef, setWorkflowDef] = useState<WorkflowDefinition | null>(null);
  const [code, setCode] = useState('');
  const [flowChart, setFlowChart] = useState<FlowChart | null>(null);
  const [data, setData] = useState<DataTable | null>(null);
  const [headerOverrides, setHeaderOverrides] = useState<Record<number, string>>({});
  const [result, setResult] = useState<ExecutionResult | null>(null);
  const [status, setStatus] = useState<'idle' | 'generating' | 'generating-code' | 'executing'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('logic');
  const [highlightRange, setHighlightRange] = useState<{ startLine: number; endLine: number } | null>(null);
  const [showCodeTab, setShowCodeTab] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // === JSON 编辑面板状态 ===
  const [showJsonPanel, setShowJsonPanel] = useState(false);
  const [jsonText, setJsonText] = useState('');
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [jsonDirty, setJsonDirty] = useState(false);
  /** JSON 面板宽度（像素）；支持拖拽调整，localStorage 持久化 */
  const [jsonPanelWidth, setJsonPanelWidth] = useState(480);

  /** 「生成工作流」拦截弹框开关；被拦原因在 gateReason 里现场计算 */
  const [showGenerateGate, setShowGenerateGate] = useState(false);

  // === Skill 管理 ===
  const [savedSkills, setSavedSkills] = useState<SavedSkill[]>([]);
  const [skillSaveName, setSkillSaveName] = useState('');
  const [skillSaveDesc, setSkillSaveDesc] = useState('');
  const [showSkillSave, setShowSkillSave] = useState(false);
  const [showSkillList, setShowSkillList] = useState(false);
  const [activeSkillName, setActiveSkillName] = useState<string | null>(null);
  /** 「我的 Skill」下拉外层容器 — 用于判断点击是否发生在组件外以触发关闭 */
  const skillListWrapperRef = useRef<HTMLDivElement>(null);

  // === 逻辑描述与处理 ===
  const [signalsDef, setSignalsDef] = useState('');
  const [analyzeSteps, setAnalyzeSteps] = useState('');
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
  const [validating, setValidating] = useState(false);
  const [showDiff, setShowDiff] = useState(false);

  // === 请求日志 ===
  const [requestLogs, setRequestLogs] = useState<RequestLogEntry[]>([]);
  const [showRequestLog, setShowRequestLog] = useState(false);
  const requestIdRef = useRef(0);

  /** 记录请求的 fetch 包装器（非 SSE） */
  const loggedFetch = useCallback(async (url: string, init?: RequestInit): Promise<Response> => {
    const id = ++requestIdRef.current;
    const method = init?.method || 'GET';
    let requestBody: any = null;
    try { requestBody = init?.body ? JSON.parse(init.body as string) : null; } catch { requestBody = init?.body; }

    const entry: RequestLogEntry = {
      id,
      timestamp: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
      method,
      url,
      requestBody,
      responseStatus: null,
      responseBody: undefined,
      duration: null,
      isSSE: false,
    };
    setRequestLogs(prev => [entry, ...prev]);

    const start = performance.now();
    try {
      const res = await fetch(url, init);
      const duration = Math.round(performance.now() - start);

      // 克隆响应以读取 body 而不消耗原始流
      let responseBody: any;
      try { responseBody = await res.clone().json(); } catch { responseBody = '(非 JSON 响应)'; }

      setRequestLogs(prev => prev.map(e => e.id === id ? { ...e, responseStatus: res.status, responseBody, duration } : e));
      return res;
    } catch (err) {
      const duration = Math.round(performance.now() - start);
      setRequestLogs(prev => prev.map(e => e.id === id ? { ...e, error: String(err), duration } : e));
      throw err;
    }
  }, []);

  /** 记录 SSE 请求的 fetch 包装器 — 返回 response 和 logId 以便后续追加 SSE 事件 */
  const loggedFetchSSE = useCallback(async (url: string, init?: RequestInit): Promise<{ res: Response; logId: number }> => {
    const id = ++requestIdRef.current;
    const method = init?.method || 'GET';
    let requestBody: any = null;
    try { requestBody = init?.body ? JSON.parse(init.body as string) : null; } catch { requestBody = init?.body; }

    const entry: RequestLogEntry = {
      id,
      timestamp: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
      method,
      url,
      requestBody,
      responseStatus: null,
      responseBody: undefined,
      duration: null,
      isSSE: true,
      sseEvents: [],
    };
    setRequestLogs(prev => [entry, ...prev]);

    const start = performance.now();
    try {
      const res = await fetch(url, init);
      setRequestLogs(prev => prev.map(e => e.id === id ? { ...e, responseStatus: res.status } : e));
      return { res, logId: id };
    } catch (err) {
      const duration = Math.round(performance.now() - start);
      setRequestLogs(prev => prev.map(e => e.id === id ? { ...e, error: String(err), duration } : e));
      throw err;
    }
  }, []);

  /** 向 SSE 日志追加事件 */
  const appendSSEEvent = useCallback((logId: number, type: string, data: any) => {
    setRequestLogs(prev => prev.map(e =>
      e.id === logId ? { ...e, sseEvents: [...(e.sseEvents || []), { type, data }] } : e
    ));
  }, []);

  /** 结束 SSE 日志记录 */
  const finishSSELog = useCallback((logId: number, responseBody?: any, error?: string) => {
    setRequestLogs(prev => prev.map(e => {
      if (e.id !== logId) return e;
      // 计算 SSE 首事件到现在的时间作为 duration（近似）
      return { ...e, responseBody, error: error || e.error, duration: Math.round(performance.now()) };
    }));
  }, []);

  // === 实时信号引用检查（不走大模型） ===
  // 1) 从信号清单解析出已定义的信号名集合
  const definedSignalNames = useMemo<Set<string>>(() => {
    const set = new Set<string>();
    if (!signalsDef.trim()) return set;
    for (const line of signalsDef.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const name = trimmed.split(/\s+/)[0];
      if (name) set.add(name);
    }
    return set;
  }, [signalsDef]);

  // 2) 实时扫描分析步骤中引用的信号，检查是否在信号清单中
  const realtimeSignalIssues = useMemo<Array<{ line: number; signal: string }>>(() => {
    if (definedSignalNames.size === 0 || !analyzeSteps.trim()) return [];
    const issues: Array<{ line: number; signal: string }> = [];
    const seen = new Set<string>(); // 避免同一信号重复报告

    // 收集所有已定义信号名，用于构建正则：精确匹配这些信号名的变体 or 类似模式
    // 策略：找所有看起来像信号名的词（大驼峰/含数字的标识符，至少3字符）
    // 然后检查它是否在已定义集合中
    const signalPattern = /\b([A-Z][a-zA-Z0-9]{2,})\b/g;

    const lines = analyzeSteps.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let match;
      signalPattern.lastIndex = 0;
      while ((match = signalPattern.exec(line)) !== null) {
        const word = match[1];
        // 跳过常见的非信号关键词
        if (/^(AND|OR|NOT|TRUE|FALSE|NULL|NaN|Infinity)$/i.test(word)) continue;
        // 只对看起来确实像信号名的词报告（至少有一个小写字母+一个大写字母 or 含数字）
        const looksLikeSignal = (/[a-z]/.test(word) && /[A-Z]/.test(word)) || /\d/.test(word);
        if (!looksLikeSignal) continue;
        // 如果在已定义信号集合中，跳过
        if (definedSignalNames.has(word)) continue;
        // 新发现的未定义信号
        const key = `${i + 1}:${word}`;
        if (!seen.has(key)) {
          seen.add(key);
          issues.push({ line: i + 1, signal: word });
        }
      }
    }
    return issues;
  }, [analyzeSteps, definedSignalNames]);

  // 实时信号错误：行号 → 该行需要标红的信号名列表
  const highlightWords = useMemo<Map<number, string[]>>(() => {
    const map = new Map<number, string[]>();
    for (const issue of realtimeSignalIssues) {
      const existing = map.get(issue.line) || [];
      existing.push(issue.signal);
      map.set(issue.line, existing);
    }
    return map;
  }, [realtimeSignalIssues]);

  // LLM 逻辑校验结果的整行错误行号
  const errorLines = useMemo<Set<number>>(() => {
    const set = new Set<number>();
    if (!validationResult) return set;
    for (const issue of validationResult.logicCheck.issues) {
      if (issue.line) set.add(issue.line);
    }
    return set;
  }, [validationResult]);

  // === 生成进度流 ===
  const [streamLog, setStreamLog] = useState<Array<{ type: 'progress' | 'token' | 'error'; text: string }>>([]);
  const streamLogRef = useRef<HTMLDivElement>(null);

  // === 思考过程抽屉 ===
  const [thinkingContent, setThinkingContent] = useState('');
  const [thinkingOpen, setThinkingOpen] = useState(false);
  const [thinkingFinished, setThinkingFinished] = useState(false);

  const loadSkillList = useCallback(async () => {
    try {
      const res = await loggedFetch('/api/skills');
      const json = await res.json();
      if (json.success) setSavedSkills(json.skills);
    } catch {}
  }, [loggedFetch]);

  useEffect(() => { loadSkillList(); }, [loadSkillList]);

  // === 开启思考抽屉的辅助函数 ===
  const startThinking = useCallback(() => {
    setThinkingContent('');
    setThinkingFinished(false);
    setThinkingOpen(true);
  }, []);

  const finishThinking = useCallback(() => {
    setThinkingFinished(true);
  }, []);

  // === 逻辑校验（SSE 流式） ===
  // override.steps：允许调用方直接传入一段 steps（绕过 closure 里可能过期的 analyzeSteps），
  //   用于「应用优化后逻辑并校验」这种 setAnalyzeSteps 尚未提交、但立即需要发起校验的场景。
  const handleValidateLogic = useCallback(async (override?: { steps?: string }) => {
    const effectiveSteps = override?.steps ?? analyzeSteps;
    if (!signalsDef.trim() && !effectiveSteps.trim()) return;
    logEvent('INFO', `[UI] 点击逻辑校验 signals_len=${signalsDef.length} steps_len=${effectiveSteps.length}${override?.steps ? ' (override)' : ''}`);
    setValidating(true);
    setValidationResult(null);
    setShowDiff(false);
    setError(null);
    startThinking();

    try {
      const sseUrl = apiUrl(API_VALIDATE_BASE, '/api/validate-logic');
      const { res, logId } = await loggedFetchSSE(sseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signals: signalsDef, steps: effectiveSteps, clientContext: getClientContext() }),
      });

      let result: ValidationResult | null = null;
      let thinkingDone = false;

      await parseSSEStream(res, {
        onThinking: (content) => {
          setThinkingContent(prev => prev + content);
          appendSSEEvent(logId, 'thinking', content);
        },
        onToken: (content) => {
          if (!thinkingDone) {
            thinkingDone = true;
            finishThinking();
          }
          appendSSEEvent(logId, 'token', content);
        },
        onProgress: (message) => {
          appendSSEEvent(logId, 'progress', message);
        },
        onDone: (msg) => {
          if (!thinkingDone) { thinkingDone = true; finishThinking(); }
          if (msg.result) {
            result = msg.result as unknown as ValidationResult;
          } else if (msg.error) {
            setError(msg.error as string);
            logEvent('ERROR', `[UI] 逻辑校验失败(done携带error): ${msg.error}`);
          }
          appendSSEEvent(logId, 'done', msg);
        },
        onError: (error) => {
          if (!thinkingDone) { thinkingDone = true; finishThinking(); }
          setError(error);
          logEvent('ERROR', `[UI] 逻辑校验 SSE onError: ${error}`);
          appendSSEEvent(logId, 'error', error);
        },
      });

      finishSSELog(logId, result || '(无结果)');

      if (result) {
        setValidationResult(result);
        const r = result as ValidationResult;
        logEvent('INFO', `[UI] 逻辑校验完成 signal=${r.signalCheck?.passed} logic=${r.logicCheck?.passed} adapt=${r.adaptabilityCheck?.passed}`);
      }
    } catch (e) {
      finishThinking();
      setError(String(e));
      logEvent('ERROR', `[UI] 逻辑校验异常: ${String(e)}`);
    } finally {
      setValidating(false);
    }
  }, [signalsDef, analyzeSteps, startThinking, finishThinking, loggedFetchSSE, appendSSEEvent, finishSSELog]);

  // === 解析信号清单 ===
  const parseSignals = useCallback(() => {
    if (!signalsDef.trim()) return [];
    return signalsDef.trim().split('\n').filter(l => l.trim() && !l.trim().startsWith('#')).map(line => {
      const parts = line.trim().split(/\s+/);
      const name = parts[0];
      const rest = parts.slice(1).join(' ');
      const valMatch = rest.match(/^(.+?)\s+([\d]+:.+)$/);
      if (valMatch) {
        const description = valMatch[1];
        const valPairs = valMatch[2].split(',').reduce((acc: Record<string, string>, pair: string) => {
          const [k, v] = pair.split(':');
          if (k !== undefined && v !== undefined) acc[k.trim()] = v.trim();
          return acc;
        }, {});
        return { name, description, values: valPairs };
      }
      return { name, description: rest };
    });
  }, [signalsDef]);

  // 当 workflowDef 变化时，同步 JSON 文本
  useEffect(() => {
    if (workflowDef) {
      setJsonText(JSON.stringify(workflowDef, null, 2));
      setJsonDirty(false);
      setJsonError(null);
    }
  }, [workflowDef]);

  // 流日志自动滚动到底部
  useEffect(() => {
    if (streamLogRef.current) {
      streamLogRef.current.scrollTop = streamLogRef.current.scrollHeight;
    }
  }, [streamLog]);

  // === Skill 保存 ===
  const handleSaveSkill = useCallback(async () => {
    if (!skillSaveName.trim()) return;
    logEvent('INFO', `[UI] 点击保存 Skill name="${skillSaveName.trim()}" desc_len=${skillSaveDesc.length} has_workflow=${!!workflowDef} code_len=${code.length}`);
    try {
      const res = await loggedFetch('/api/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: skillSaveName.trim(),
          description: skillSaveDesc.trim(),
          signalsDef,
          analyzeSteps,
          workflowDef,
          code,
          validationResult,
        }),
      });
      const json = await res.json();
      if (json.success) {
        logEvent('INFO', `[UI] Skill 保存成功 name="${json.name}"`);
        setShowSkillSave(false);
        setSkillSaveName('');
        setSkillSaveDesc('');
        setActiveSkillName(json.name);
        loadSkillList();
      } else {
        logEvent('ERROR', `[UI] Skill 保存失败: ${json.error}`);
        setError(json.error);
      }
    } catch (e) {
      logEvent('ERROR', `[UI] Skill 保存异常: ${String(e)}`);
      setError(String(e));
    }
  }, [skillSaveName, skillSaveDesc, signalsDef, analyzeSteps, workflowDef, code, validationResult, loadSkillList, loggedFetch]);

  // === Skill 加载 ===
  const handleLoadSkill = useCallback(async (name: string) => {
    logEvent('INFO', `[UI] 点击加载 Skill name="${name}"`);
    try {
      const res = await loggedFetch(`/api/skills/${encodeURIComponent(name)}`);
      const json = await res.json();
      if (json.success) {
        const skill: SkillData = json.skill;
        logEvent('INFO', `[UI] Skill 加载成功 name="${name}" has_workflow=${!!skill.workflowDef} code_len=${(skill.code || '').length}`);
        setSignalsDef(skill.signalsDef || '');
        setAnalyzeSteps(skill.analyzeSteps || '');
        if (skill.workflowDef) {
          setWorkflowDef(skill.workflowDef);
          const chart = workflowToFlowChart(skill.workflowDef);
          setFlowChart(chart);
        } else {
          setWorkflowDef(null);
          setFlowChart(null);
        }
        setCode(skill.code || '');
        if (skill.code) setShowCodeTab(true);
        setValidationResult(skill.validationResult || null);
        setActiveSkillName(name);
        setShowSkillList(false);
        setResult(null);
        setActiveTab('logic');
      } else {
        logEvent('ERROR', `[UI] Skill 加载失败 name="${name}" err=${json.error}`);
        setError(json.error);
      }
    } catch (e) {
      logEvent('ERROR', `[UI] Skill 加载异常 name="${name}": ${String(e)}`);
      setError(String(e));
    }
  }, [loggedFetch]);

  // === Skill 删除 ===
  const handleDeleteSkill = useCallback(async (name: string) => {
    logEvent('INFO', `[UI] 点击删除 Skill name="${name}"`);
    try {
      const res = await loggedFetch('/api/skills', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const json = await res.json();
      if (json.success) {
        logEvent('INFO', `[UI] Skill 删除成功 name="${name}"`);
        if (activeSkillName === name) setActiveSkillName(null);
        loadSkillList();
      } else {
        logEvent('WARN', `[UI] Skill 删除失败 name="${name}" err=${json.error}`);
      }
    } catch (e) {
      logEvent('ERROR', `[UI] Skill 删除异常 name="${name}": ${String(e)}`);
    }
  }, [activeSkillName, loadSkillList, loggedFetch]);

  // === 步骤 1: 自然语言 → JSON 工作流定义 → 流程图（SSE 流式） ===
  const handleGenerate = useCallback(async () => {
    if (!analyzeSteps.trim()) return;

    const parsedSignals = parseSignals();
    logEvent('INFO', `[UI] 点击生成工作流 steps_len=${analyzeSteps.length} signals_count=${parsedSignals.length}`);

    setStatus('generating');
    setError(null);
    setStreamLog([]);
    setFlowChart(null);
    setWorkflowDef(null);
    setCode('');
    setActiveTab('flow');
    startThinking();

    try {
      const genUrl = apiUrl(API_GENERATE_BASE, '/api/generate');
      const { res, logId } = await loggedFetchSSE(genUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: analyzeSteps, signals: parsedSignals, clientContext: getClientContext() }),
      });

      let wfDef: WorkflowDefinition | null = null;

      let thinkingDone = false;

      await parseSSEStream(res, {
        onThinking: (content) => {
          setThinkingContent(prev => prev + content);
          appendSSEEvent(logId, 'thinking', content);
        },
        onProgress: (message) => {
          setStreamLog(prev => [...prev, { type: 'progress', text: message }]);
          appendSSEEvent(logId, 'progress', message);
        },
        onToken: (content) => {
          if (!thinkingDone) {
            thinkingDone = true;
            finishThinking();
          }
          setStreamLog(prev => {
            const last = prev[prev.length - 1];
            if (last?.type === 'token') {
              return [...prev.slice(0, -1), { type: 'token', text: last.text + content }];
            }
            return [...prev, { type: 'token', text: content }];
          });
          appendSSEEvent(logId, 'token', content);
        },
        onDone: (msg) => {
          if (!thinkingDone) { thinkingDone = true; finishThinking(); }
          wfDef = msg.workflowDef as unknown as WorkflowDefinition;
          appendSSEEvent(logId, 'done', msg);
        },
        onError: (error) => {
          if (!thinkingDone) { thinkingDone = true; finishThinking(); }
          appendSSEEvent(logId, 'error', error);
          throw new Error(error);
        },
      });

      finishSSELog(logId, wfDef || '(无结果)');

      if (!wfDef) throw new Error('未收到工作流定义');

      const wf = wfDef as WorkflowDefinition;
      logEvent('INFO', `[UI] 工作流生成成功 name="${wf.name || ''}" steps=${wf.steps?.length ?? 0}`);

      setWorkflowDef(wfDef);
      const chart = workflowToFlowChart(wfDef);
      setFlowChart(chart);

      // 自动生成 TS 代码
      setStatus('generating-code');
      setStreamLog(prev => [...prev, { type: 'progress', text: '正在生成 TypeScript 代码...' }]);

      const codeRes = await loggedFetch('/api/generate-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflowDef: wfDef }),
      });
      const codeJson = await codeRes.json();
      if (codeJson.success) {
        setCode(codeJson.code);
        logEvent('INFO', `[UI] TS 代码生成成功 code_len=${codeJson.code.length}`);
        setStreamLog(prev => [...prev, { type: 'progress', text: `✓ 全部完成，代码 ${codeJson.code.length} 字符` }]);
      } else {
        logEvent('ERROR', `[UI] TS 代码生成失败: ${codeJson.error}`);
        setError(`代码生成失败: ${codeJson.error}`);
      }
    } catch (e) {
      finishThinking();
      logEvent('ERROR', `[UI] 生成工作流异常: ${String(e)}`);
      setError(String(e));
      setStreamLog(prev => [...prev, { type: 'error', text: String(e) }]);
    } finally {
      setStatus('idle');
    }
  }, [analyzeSteps, parseSignals, startThinking, finishThinking, loggedFetch, loggedFetchSSE, appendSSEEvent, finishSSELog]);

  // === 「生成工作流」拦截：校验前置 ===
  // 把 gate 状态派生自 validationResult，单一数据源；弹框打开时实时反映当前校验状态。
  // 注意：adaptabilityCheck 不参与 gate —— 它是软建议（优化点）而非硬错误，不应阻塞生成。
  type GateReason = 'no-validation' | 'signal-failed' | 'logic-failed' | 'both-failed';
  const gateReason = useMemo<GateReason | null>(() => {
    if (!validationResult) return 'no-validation';
    const signalBad = !validationResult.signalCheck.passed;
    const logicBad = !validationResult.logicCheck.passed;
    if (signalBad && logicBad) return 'both-failed';
    if (signalBad) return 'signal-failed';
    if (logicBad) return 'logic-failed';
    return null;
  }, [validationResult]);

  /**
   * 按钮点击入口：仅在「用户主动点击」路径上做拦截。
   * handleGenerate 本体保持纯净，供其它路径（如 Skill 加载后自动生成等）直接调用。
   */
  const handleGenerateClick = useCallback(() => {
    if (gateReason !== null) {
      logEvent('INFO', `[UI] 生成工作流被拦截 reason=${gateReason}`);
      setShowGenerateGate(true);
      return;
    }
    handleGenerate();
  }, [gateReason, handleGenerate]);

  /**
   * 应用 LLM 给出的优化后 steps 并立即重新校验。
   * 关键：setAnalyzeSteps 是异步（下一帧生效），所以用 override.steps 把新值直接注入
   *   handleValidateLogic，避免读到 closure 里过期的 analyzeSteps。
   */
  const applyOptimizedAndValidate = useCallback(() => {
    const optimized = validationResult?.optimizedSteps;
    if (optimized) {
      setAnalyzeSteps(optimized);
      handleValidateLogic({ steps: optimized });
    } else {
      // LLM 没给优化版本，退化为普通重新校验
      handleValidateLogic();
    }
  }, [validationResult, handleValidateLogic]);

  // === JSON 编辑 → 应用更改 ===
  const handleJsonChange = useCallback((value: string | undefined) => {
    const text = value || '';
    setJsonText(text);
    setJsonDirty(true);
    try {
      JSON.parse(text);
      setJsonError(null);
    } catch (e) {
      setJsonError(String(e).replace('SyntaxError: ', ''));
    }
  }, []);

  const handleApplyJson = useCallback(async () => {
    try {
      const parsed = JSON.parse(jsonText) as WorkflowDefinition;
      if (!parsed.steps || !Array.isArray(parsed.steps)) {
        setJsonError('JSON 必须包含 steps 数组');
        return;
      }
      setWorkflowDef(parsed);
      setJsonDirty(false);
      setJsonError(null);
      const chart = workflowToFlowChart(parsed);
      setFlowChart(chart);
      setCode('');
      const codeRes = await loggedFetch('/api/generate-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflowDef: parsed }),
      });
      const codeJson = await codeRes.json();
      if (codeJson.success) {
        setCode(codeJson.code);
      } else {
        setJsonError(`代码生成失败: ${codeJson.error}`);
      }
      setResult(null);
    } catch (e) {
      setJsonError(String(e).replace('SyntaxError: ', ''));
    }
  }, [jsonText, loggedFetch]);

  const handleRevertJson = useCallback(() => {
    if (workflowDef) {
      setJsonText(JSON.stringify(workflowDef, null, 2));
      setJsonDirty(false);
      setJsonError(null);
    }
  }, [workflowDef]);


  // === 文件上传 ===

  /** Excel Date/Time 对象 → 可读字符串（使用 UTC 以匹配 xlsx cellDates 输出） */
  function formatExcelDate(d: Date): string {
    const pad = (n: number) => n.toString().padStart(2, '0');
    const h = pad(d.getUTCHours());
    const m = pad(d.getUTCMinutes());
    const s = pad(d.getUTCSeconds());
    const ms = d.getUTCMilliseconds();
    const timeStr = ms > 0
      ? `${h}:${m}:${s}.${ms.toString().padStart(3, '0')}`
      : `${h}:${m}:${s}`;

    // 时间型单元格：Excel 内部存为 1899-12-30 + 时间偏移
    if (d.getUTCFullYear() <= 1900) return timeStr;

    // 日期+时间型
    const y = d.getUTCFullYear();
    const M = pad(d.getUTCMonth() + 1);
    const day = pad(d.getUTCDate());
    return `${y}-${M}-${day} ${timeStr}`;
  }

  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    logEvent('INFO', `[UI] 上传数据文件 name="${file.name}" size=${file.size}`);

    try {
      const XLSX = await import('xlsx');
      const arrayBuffer = await file.arrayBuffer();
      // cellDates: true → 让 xlsx 将日期/时间单元格转为 JS Date 对象
      const workbook = XLSX.read(arrayBuffer, { type: 'array', cellDates: true });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];

      if (raw.length < 2) {
        logEvent('WARN', `[UI] Excel 文件行数不足 rows=${raw.length}`);
        setError('Excel 文件至少需要 2 行（标题 + 数据）');
        return;
      }

      const headers = raw[0].map((h: any) => String(h).replace(/[\r\n]+/g, '').trim());
      const rows = raw.slice(1).map(row =>
        headers.map((_, i) => {
          const v = row[i];
          if (v === undefined || v === null) return 0;
          // Excel 日期/时间类型 → 可读字符串
          if (v instanceof Date) {
            return formatExcelDate(v);
          }
          const num = Number(v);
          return isNaN(num) ? v : num;
        })
      );

      setData({ headers, rows, fileName: file.name });
      setHeaderOverrides({});
      setResult(null);
      setError(null);
      setActiveTab('data');
      logEvent('INFO', `[UI] Excel 解析成功 cols=${headers.length} rows=${rows.length}`);

      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (err) {
      logEvent('ERROR', `[UI] Excel 解析异常 name="${file.name}": ${String(err)}`);
      setError(`Excel 解析失败: ${String(err)}`);
    }
  }, []);

  const getEffectiveData = useCallback((): DataTable | null => {
    if (!data) return null;
    const effectiveHeaders = data.headers.map((h, i) => {
      if (i in headerOverrides) return headerOverrides[i];
      return formatHeader(h);
    });
    return { ...data, headers: effectiveHeaders };
  }, [data, headerOverrides]);

  // === 执行代码 ===
  const handleExecute = useCallback(async () => {
    logEvent('INFO', `[UI] 点击执行 has_data=${!!data} has_code=${!!code.trim()} has_workflow=${!!workflowDef}`);
    if (!data) {
      logEvent('WARN', '[UI] 执行中断: 未上传数据');
      setError('请先上传数据');
      return;
    }

    if (!code.trim() && workflowDef) {
      setStatus('generating-code');
      try {
        const codeRes = await loggedFetch('/api/generate-code', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workflowDef }),
        });
        const codeJson = await codeRes.json();
        if (!codeJson.success) throw new Error(codeJson.error);
        setCode(codeJson.code);
      } catch (e) {
        logEvent('ERROR', `[UI] 执行前补生成代码失败: ${String(e)}`);
        setError(String(e));
        setStatus('idle');
        return;
      }
    }

    if (!code.trim()) {
      logEvent('WARN', '[UI] 执行中断: 无代码可运行');
      setError('需要先生成工作流');
      return;
    }

    setStatus('executing');
    setError(null);

    const effectiveData = getEffectiveData();
    try {
      const res = await loggedFetch('/api/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, data: effectiveData }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);

      setResult(json.result);
      setActiveTab('result');
      logEvent('INFO', `[UI] 执行成功 rows=${effectiveData?.rows?.length ?? 0}`);
    } catch (e) {
      logEvent('ERROR', `[UI] 执行失败: ${String(e)}`);
      setError(String(e));
    } finally {
      setStatus('idle');
    }
  }, [code, data, workflowDef, getEffectiveData, loggedFetch]);

  // === 流程图节点点击 ===
  const handleNodeClick = useCallback((nodeId: string, codeRange?: { startLine: number; endLine: number }) => {
    if (codeRange) {
      setHighlightRange(codeRange);
      setShowCodeTab(true);
      setActiveTab('code');
    }
  }, []);

  // === 代码编辑 ===
  const handleCodeChange = useCallback((newCode: string) => {
    setCode(newCode);
  }, []);

  const isGenerating = status === 'generating' || status === 'generating-code';

  const signalCount = signalsDef.trim() ? signalsDef.trim().split('\n').filter(l => l.trim() && !l.startsWith('#')).length : 0;
  const stepCount = (analyzeSteps.match(/^##\s/gm) || []).length;

  // === 可拖拽分割线：左右（信号清单 vs 分析步骤） ===
  const [leftWidth, setLeftWidth] = useState(30); // 百分比，默认 3:7
  const logicContainerRef = useRef<HTMLDivElement>(null);

  const handleHDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const container = logicContainerRef.current;
    if (!container) return;
    const containerRect = container.getBoundingClientRect();

    const onMove = (ev: MouseEvent) => {
      const x = ev.clientX - containerRect.left;
      const pct = (x / containerRect.width) * 100;
      setLeftWidth(Math.max(20, Math.min(80, pct)));
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, []);

  // === 可拖拽分割线：上下（分析步骤 vs 校验结果） ===
  const [topHeight, setTopHeight] = useState(60); // 百分比
  const rightPanelRef = useRef<HTMLDivElement>(null);

  const handleVDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const container = rightPanelRef.current;
    if (!container) return;
    const containerRect = container.getBoundingClientRect();

    const onMove = (ev: MouseEvent) => {
      const y = ev.clientY - containerRect.top;
      const pct = (y / containerRect.height) * 100;
      setTopHeight(Math.max(20, Math.min(80, pct)));
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, []);

  // === 可拖拽分割线：左右（流程图 vs JSON 面板） ===
  // 首次 mount 读取 localStorage（放 useEffect 避免 SSR 水合不一致）
  useEffect(() => {
    try {
      const stored = localStorage.getItem('rds_json_panel_width');
      const n = stored ? parseInt(stored, 10) : NaN;
      if (Number.isFinite(n)) {
        const maxW = Math.min(window.innerWidth - 320, 1400);
        setJsonPanelWidth(Math.max(280, Math.min(n, maxW)));
      }
    } catch {
      /* localStorage 被禁用：保持默认 */
    }
  }, []);

  const handleJsonHDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = jsonPanelWidth;
    // 在 closure 内维护最新值，避免 onUp 回调从 state closure 读到旧值
    let latestWidth = startWidth;

    const onMove = (ev: MouseEvent) => {
      // 分隔条在 JSON 面板左侧；鼠标向左移动（delta 为负）→ 面板应变宽
      const delta = ev.clientX - startX;
      const raw = startWidth - delta;
      // 下限：保证 monaco 能渲染；上限：给左侧流程图至少 320px 空间
      const maxW = Math.min(window.innerWidth - 320, 1400);
      latestWidth = Math.max(280, Math.min(raw, maxW));
      setJsonPanelWidth(latestWidth);
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      try {
        localStorage.setItem('rds_json_panel_width', String(latestWidth));
      } catch {
        /* 忽略 */
      }
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [jsonPanelWidth]);

  // === 「我的 Skill」下拉：点击外部关闭 ===
  // 关键：用 setTimeout(0) 把监听挂到下一个 macrotask，让「打开的这次 click」
  //   的所有事件派发（mousedown/mouseup/click/synthetic）完全跑完再上监听，
  //   否则 React 19 下 useEffect 可能与事件派发同帧，导致打开的同一拍即刻误关。
  useEffect(() => {
    if (!showSkillList) return;

    const onDocMouseDown = (e: MouseEvent) => {
      if (!skillListWrapperRef.current) return;
      if (!skillListWrapperRef.current.contains(e.target as Node)) {
        setShowSkillList(false);
      }
    };

    const timer = setTimeout(() => {
      document.addEventListener('mousedown', onDocMouseDown);
    }, 0);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', onDocMouseDown);
    };
  }, [showSkillList]);

  return (
    <div className="h-screen flex flex-col">
      {/* 顶部栏 */}
      <header className="border-b border-[var(--border)] px-4 py-2 flex items-center gap-4 shrink-0">
        <h1 className="font-bold text-lg">RDS SKILL HUB</h1>
        <span className="text-xs text-[var(--muted)]">信号定义 → 逻辑校验 → 工作流 → 代码 → 执行</span>

        <div className="flex-1" />

        {/* 错误提示 */}
        {error && (
          <div className="px-3 py-1 bg-red-50 border border-red-200 rounded text-xs text-red-600 max-w-md truncate" title={error}>
            {error}
          </div>
        )}

        {/* 状态指示灯 */}
        <div className="flex items-center gap-3 text-[10px] text-[var(--muted)]">
          <span className="flex items-center gap-1">
            <span className={`w-1.5 h-1.5 rounded-full ${workflowDef ? 'bg-green-400' : 'bg-gray-300'}`} />
            工作流
          </span>
          <span className="flex items-center gap-1">
            <span className={`w-1.5 h-1.5 rounded-full ${code ? 'bg-green-400' : 'bg-gray-300'}`} />
            代码
          </span>
          <span className="flex items-center gap-1">
            <span className={`w-1.5 h-1.5 rounded-full ${data ? 'bg-green-400' : 'bg-gray-300'}`} />
            数据
          </span>
          <span className="flex items-center gap-1">
            <span className={`w-1.5 h-1.5 rounded-full ${result ? 'bg-green-400' : 'bg-gray-300'}`} />
            结果
          </span>
        </div>

        {/* 请求日志开关 */}
        <button
          onClick={() => setShowRequestLog(!showRequestLog)}
          className={`flex items-center gap-1 px-2 py-1 text-[10px] rounded transition ${
            showRequestLog
              ? 'bg-orange-100 text-orange-600 border border-orange-300'
              : 'text-[var(--muted)] hover:text-[var(--fg)] border border-transparent hover:border-[var(--border)]'
          }`}
          title="网络请求日志"
        >
          <Activity size={12} />
          请求日志
          {requestLogs.length > 0 && (
            <span className="ml-0.5 px-1 py-0 text-[9px] rounded-full bg-orange-400 text-white leading-tight">{requestLogs.length}</span>
          )}
        </button>

        {/* 隐藏的文件上传 input */}
        <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleFileUpload} className="hidden" />

        {/* 执行按钮 */}
        <button
          onClick={handleExecute}
          disabled={(!code && !workflowDef) || !data || status === 'executing'}
          className="flex items-center gap-1.5 px-4 py-1.5 text-xs bg-[var(--accent)] text-white rounded hover:opacity-90 transition disabled:opacity-40"
        >
          <Play size={14} />
          {status === 'executing' ? '执行中...' : status === 'generating-code' ? '生成代码...' : '执行分析'}
        </button>

        {/* 保存 Skill */}
        <button
          onClick={() => { setShowSkillSave(true); setShowSkillList(false); setSkillSaveName(activeSkillName || ''); }}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-[var(--border)] rounded hover:bg-[var(--accent-light)] transition"
        >
          <Save size={14} />
          保存 Skill
        </button>

        {/* 我的 Skill */}
        <div className="relative" ref={skillListWrapperRef}>
          <button
            onClick={() => { setShowSkillList(!showSkillList); setShowSkillSave(false); }}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs border rounded transition ${
              activeSkillName
                ? 'border-[var(--accent)] text-[var(--accent)] bg-blue-50'
                : 'border-[var(--border)] hover:bg-[var(--accent-light)]'
            }`}
          >
            <BookMarked size={14} />
            我的 Skill
            <ChevronDown size={12} />
          </button>

          {/* Skill 列表下拉 */}
          {showSkillList && (
            <div className="absolute right-0 top-full mt-1 w-72 bg-[var(--bg)] border border-[var(--border)] rounded-lg shadow-lg z-50 overflow-hidden">
              <div className="px-3 py-2 border-b border-[var(--border)] text-xs font-bold text-[var(--muted)]">
                我的 Skill ({savedSkills.length})
              </div>
              <div className="max-h-80 overflow-auto">
                {savedSkills.length === 0 ? (
                  <div className="px-3 py-6 text-xs text-[var(--muted)] text-center">暂无保存的 Skill</div>
                ) : (
                  savedSkills.map(s => (
                    <div
                      key={s.name}
                      className={`group flex items-center gap-2 px-3 py-2 text-xs cursor-pointer hover:bg-[var(--accent-light)] transition ${
                        activeSkillName === s.name ? 'bg-blue-50 border-l-2 border-[var(--accent)]' : ''
                      }`}
                      onClick={() => handleLoadSkill(s.name)}
                    >
                      <BookMarked size={12} className="text-[var(--muted)] shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{s.name}</div>
                        {s.description && <div className="text-[var(--muted)] text-[10px] truncate">{s.description}</div>}
                        <div className="text-[var(--muted)] text-[10px]">
                          {new Date(s.updatedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>
                      <button
                        onClick={e => { e.stopPropagation(); handleDeleteSkill(s.name); }}
                        className="opacity-0 group-hover:opacity-100 p-1 text-red-400 hover:text-red-600 transition"
                        title="删除"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </header>

      {/* Skill 保存弹出面板 */}
      {showSkillSave && (
        <div className="border-b border-[var(--border)] px-4 py-2.5 flex items-center gap-3 bg-gray-50 shrink-0">
          <Save size={14} className="text-[var(--muted)] shrink-0" />
          <input
            value={skillSaveName}
            onChange={e => setSkillSaveName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSaveSkill()}
            placeholder="Skill 名称..."
            className="w-40 px-2 py-1 text-xs border border-[var(--border)] rounded bg-white"
            autoFocus
          />
          <input
            value={skillSaveDesc}
            onChange={e => setSkillSaveDesc(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSaveSkill()}
            placeholder="描述（可选）..."
            className="flex-1 max-w-sm px-2 py-1 text-xs border border-[var(--border)] rounded bg-white"
          />
          <div className="flex items-center gap-1.5 text-[10px] text-[var(--muted)]">
            <span className={signalsDef.trim() ? 'text-green-600' : ''}>信号{signalsDef.trim() ? '✓' : '—'}</span>
            <span className={analyzeSteps.trim() ? 'text-green-600' : ''}>步骤{analyzeSteps.trim() ? '✓' : '—'}</span>
            <span className={workflowDef ? 'text-green-600' : ''}>工作流{workflowDef ? '✓' : '—'}</span>
            <span className={code ? 'text-green-600' : ''}>代码{code ? '✓' : '—'}</span>
          </div>
          <button
            onClick={handleSaveSkill}
            disabled={!skillSaveName.trim()}
            className="px-3 py-1 text-xs bg-[var(--accent)] text-white rounded disabled:opacity-40"
          >
            保存
          </button>
          <button
            onClick={() => setShowSkillSave(false)}
            className="px-2 py-1 text-xs text-[var(--muted)] hover:text-[var(--fg)]"
          >
            取消
          </button>
        </div>
      )}

      {/* 全屏 Tab 区域 */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Tab 栏 */}
        <div className="flex border-b border-[var(--border)] shrink-0">
          <button
            onClick={() => setActiveTab('logic')}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm border-b-2 transition ${
              activeTab === 'logic' ? 'border-[var(--accent)] text-[var(--accent)]' : 'border-transparent text-[var(--muted)]'
            }`}
          >
            <ClipboardList size={14} /> 逻辑描述与处理
            {(signalCount > 0 || stepCount > 0) && (
              <span className="ml-1 px-1.5 py-0.5 text-[10px] rounded-full bg-indigo-100 text-indigo-700">
                {signalCount}信号 {stepCount}步骤
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('flow')}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm border-b-2 transition ${
              activeTab === 'flow' ? 'border-[var(--accent)] text-[var(--accent)]' : 'border-transparent text-[var(--muted)]'
            }`}
          >
            <GitBranch size={14} /> 流程图
            {flowChart && (
              <span className="ml-1 px-1.5 py-0.5 text-[10px] rounded-full bg-purple-100 text-purple-700">
                {flowChart.nodes.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('data')}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm border-b-2 transition ${
              activeTab === 'data' ? 'border-[var(--accent)] text-[var(--accent)]' : 'border-transparent text-[var(--muted)]'
            }`}
          >
            <Table2 size={14} /> 数据加工
            {data && (
              <span className="ml-1 px-1.5 py-0.5 text-[10px] rounded-full bg-blue-100 text-blue-700">
                {data.rows.length}行
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('result')}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm border-b-2 transition ${
              activeTab === 'result' ? 'border-[var(--accent)] text-[var(--accent)]' : 'border-transparent text-[var(--muted)]'
            }`}
          >
            <Terminal size={14} /> 结果输出 {result && `(${result.findings.length})`}
          </button>

          {showCodeTab && (
            <button
              onClick={() => setActiveTab('code')}
              className={`flex items-center gap-1.5 px-4 py-2 text-sm border-b-2 transition ${
                activeTab === 'code' ? 'border-[var(--accent)] text-[var(--accent)]' : 'border-transparent text-[var(--muted)]'
              }`}
            >
              <Code2 size={14} /> 代码
            </button>
          )}

          <div className="flex-1" />

          {code && !showCodeTab && (
            <button
              onClick={() => { setShowCodeTab(true); setActiveTab('code'); }}
              className="mr-2 px-3 py-1 text-xs text-[var(--muted)] hover:text-[var(--accent)] transition"
            >
              <Code2 size={14} className="inline mr-1" />
              查看代码
            </button>
          )}

        </div>

        {/* Tab 内容 */}
        <div className="flex-1 overflow-hidden">
          {/* ========== 逻辑描述与处理 Tab ========== */}
          {activeTab === 'logic' && (
            <div ref={logicContainerRef} className="h-full flex">
              {/* 左：信号清单 */}
              <div style={{ width: `${leftWidth}%` }} className="h-full flex flex-col shrink-0">
                <div className="px-4 py-3 border-b border-[var(--border)] shrink-0">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-bold">
                      信号清单
                      <span className="ml-2 text-xs font-normal text-[var(--muted)]">{signalCount} 个信号</span>
                    </label>
                  </div>
                  <p className="text-xs text-[var(--muted)] mt-1">定义所有需要分析的信号名称、描述和取值含义</p>
                </div>
                <div className="flex-1 p-4 overflow-hidden flex flex-col">
                  <textarea
                    value={signalsDef}
                    onChange={e => setSignalsDef(e.target.value)}
                    placeholder={"# 信号定义格式示例\n# 信号名称 描述 值定义\n\nVehLckngSta 车锁信号 0:解锁,2:内锁,3:外锁\nRLDoorOpenSts 左后门开关信号 0:关闭,2:半开,3:全开\nRRDoorOpenSts 右后门开关信号 0:关闭,2:半开,3:全开\nDrvrDoorOpenSts 主驾门开关信号 0:关闭,2:半开,3:全开\nFrtPsngDoorOpenSts 副驾门开关信号 0:关闭,2:半开,3:全开\nLdspcOpenSts 后备箱开关信号 0:关闭,1:打开\nBCMDrvrDetSts 主驾占位信号 0:无占位,1:有占位\nDigKey1Loctn 主账号蓝牙钥匙位置 0,1,2:落锁区域,3-11:解锁区域\nDigKey2Loctn 授权账号蓝牙钥匙位置 0,1,2:落锁区域,3-11:解锁区域\nEPTRdy 车辆Ready状态 0:未上Ready,1:已上Ready"}
                    className="flex-1 w-full p-3 text-sm border border-[var(--border)] rounded resize-none bg-transparent font-mono leading-relaxed"
                  />
                  <p className="text-[10px] text-[var(--muted)] mt-2">格式: 信号名称 描述 值:含义,值:含义...</p>
                </div>
              </div>

              {/* 左右拖拽分割线 */}
              <div
                onMouseDown={handleHDragStart}
                className="w-1 hover:w-1.5 bg-[var(--border)] hover:bg-[var(--accent)] cursor-col-resize shrink-0 transition-all relative group"
              >
                <div className="absolute inset-y-0 -left-1 -right-1" />
              </div>

              {/* 右：分析步骤 + 校验结果 */}
              <div ref={rightPanelRef} className="flex-1 h-full flex flex-col min-w-0">
                <div className="px-4 py-3 border-b border-[var(--border)] shrink-0">
                  <label className="text-sm font-bold">
                    分析步骤
                    <span className="ml-2 text-xs font-normal text-[var(--muted)]">{stepCount} 个步骤</span>
                  </label>
                  <p className="text-xs text-[var(--muted)] mt-1">定义分析的逻辑流程，包括条件和动作（输入时实时校验）</p>
                </div>

                <div className="flex-1 flex flex-col min-h-0">
                  {/* 上部：分析步骤输入区 */}
                  <div style={{ height: validationResult ? `${topHeight}%` : '100%' }} className="p-4 flex flex-col min-h-0 shrink-0">
                    <LineNumberedTextarea
                      value={analyzeSteps}
                      onChange={setAnalyzeSteps}
                      placeholder={"# 分析逻辑格式示例\n\n## 步骤1：识别离车场景\n- 条件：四门一盖全部等于0\n- 动作：记录关闭最后一扇门的时间\n- 下一步：步骤2\n\n## 步骤2：检查蓝牙连接状态\n- 条件：DigKey1Loctn或DigKey2Loctn任一不为0\n- 若不满足：输出\"蓝牙钥匙已断联\""}
                      className="flex-1"
                      errorLines={errorLines}
                      highlightWords={highlightWords}
                    />
                    <p className="text-[10px] text-[var(--muted)] mt-2">格式: ## 步骤N: 标题 + 条件/动作列表</p>

                    {/* 实时信号扫描提醒（仅前端启发式扫描，后端会以 LLM 做准确校验；黄色提示而非红色错误） */}
                    {realtimeSignalIssues.length > 0 && (
                      <div className="mt-2 px-2.5 py-1.5 bg-yellow-50 border border-yellow-200 rounded text-[11px] text-yellow-800 flex items-start gap-1.5 shrink-0">
                        <AlertTriangle size={13} className="shrink-0 mt-0.5 text-yellow-500" />
                        <div className="flex-1 min-w-0">
                          <span className="font-medium">信号实时扫描提醒，检测到未匹配信号，以校验结果为准：</span>
                          <span className="flex flex-wrap gap-x-2 gap-y-0.5 mt-0.5">
                            {realtimeSignalIssues.map((issue, i) => (
                              <span key={i}>
                                <span className="inline-block px-1 py-0.5 rounded bg-yellow-100 text-yellow-700 text-[10px] font-mono mr-0.5">L{issue.line}</span>
                                <span className="font-mono text-yellow-700">{issue.signal}</span>
                              </span>
                            ))}
                          </span>
                        </div>
                      </div>
                    )}

                    {/* 操作按钮 */}
                    <div className="flex gap-2 mt-3 shrink-0">
                      <button
                        onClick={handleValidateLogic}
                        disabled={(!signalsDef.trim() && !analyzeSteps.trim()) || validating || isGenerating}
                        className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 text-sm border-2 border-[var(--accent)] text-[var(--accent)] rounded-lg hover:bg-[var(--accent)] hover:text-white transition disabled:opacity-40"
                      >
                        <ShieldCheck size={15} />
                        {validating ? '校验中...' : '逻辑校验'}
                      </button>
                      <button
                        onClick={handleGenerateClick}
                        disabled={!analyzeSteps.trim() || isGenerating || validating}
                        className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 text-sm bg-[var(--accent)] text-white rounded-lg hover:opacity-90 transition disabled:opacity-40"
                      >
                        <Sparkles size={15} />
                        {isGenerating ? '生成中...' : '生成工作流'}
                      </button>
                    </div>
                  </div>

                  {/* 上下拖拽分割线 + 校验结果 */}
                  {validationResult && (
                    <>
                      <div
                        onMouseDown={handleVDragStart}
                        className="h-1 hover:h-1.5 bg-[var(--border)] hover:bg-[var(--accent)] cursor-row-resize shrink-0 transition-all relative group"
                      >
                        <div className="absolute inset-x-0 -top-1 -bottom-1" />
                      </div>

                      <div style={{ height: `${100 - topHeight}%` }} className="overflow-auto p-4 min-h-0">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-bold">校验结果</span>
                          <button onClick={() => setValidationResult(null)} className="text-[var(--muted)] hover:text-[var(--fg)]">
                            <X size={14} />
                          </button>
                        </div>
                      <div className="text-xs space-y-3">
                        {/* 总结 */}
                        <div className={`p-2.5 rounded ${
                          validationResult.signalCheck.passed && validationResult.logicCheck.passed && validationResult.adaptabilityCheck.passed
                            ? 'bg-green-50 border border-green-200 text-green-700'
                            : 'bg-amber-50 border border-amber-200 text-amber-700'
                        }`}>
                          {validationResult.summary}
                        </div>

                        {/* 信号检查 */}
                        <div>
                          <div className="flex items-center gap-1.5 font-medium mb-1">
                            {validationResult.signalCheck.passed
                              ? <CheckCircle2 size={13} className="text-green-500" />
                              : <XCircle size={13} className="text-red-500" />}
                            信号引用检查
                          </div>
                          {validationResult.signalCheck.issues.length > 0 ? (
                            <div className="space-y-1 ml-5">
                              {validationResult.signalCheck.issues.map((issue, i) => (
                                <div key={i} className="text-[11px]">
                                  {issue.line && <span className="inline-block px-1 py-0.5 mr-1 rounded bg-red-100 text-red-600 text-[10px] font-mono">L{issue.line}</span>}
                                  <span className="text-red-500 font-mono">{issue.signal}</span>
                                  <span className="text-[var(--muted)]"> — {issue.message}</span>
                                  {issue.suggestion && <span className="text-blue-500"> 建议: {issue.suggestion}</span>}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="ml-5 text-[11px] text-green-600">所有信号引用正确</div>
                          )}
                        </div>

                        {/* 逻辑检查 */}
                        <div>
                          <div className="flex items-center gap-1.5 font-medium mb-1">
                            {validationResult.logicCheck.passed
                              ? <CheckCircle2 size={13} className="text-green-500" />
                              : <XCircle size={13} className="text-red-500" />}
                            逻辑完整性检查
                          </div>
                          {validationResult.logicCheck.issues.length > 0 ? (
                            <div className="space-y-1 ml-5">
                              {validationResult.logicCheck.issues.map((issue, i) => (
                                <div key={i} className="text-[11px]">
                                  {issue.line && <span className="inline-block px-1 py-0.5 mr-1 rounded bg-amber-100 text-amber-700 text-[10px] font-mono">L{issue.line}</span>}
                                  <span className="font-medium">[{issue.step}]</span>
                                  <span className="text-[var(--muted)]"> {issue.message}</span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="ml-5 text-[11px] text-green-600">逻辑结构完整</div>
                          )}
                        </div>

                        {/* 适配性检查 */}
                        <div>
                          <div className="flex items-center gap-1.5 font-medium mb-1">
                            {validationResult.adaptabilityCheck.passed
                              ? <CheckCircle2 size={13} className="text-green-500" />
                              : <Info size={13} className="text-blue-500" />}
                            工作流适配性检查
                          </div>
                          {validationResult.adaptabilityCheck.issues.length > 0 ? (
                            <div className="space-y-1 ml-5">
                              {validationResult.adaptabilityCheck.issues.map((issue, i) => (
                                <div key={i} className="text-[11px]">
                                  {issue.line && <span className="inline-block px-1 py-0.5 mr-1 rounded bg-blue-100 text-blue-700 text-[10px] font-mono">L{issue.line}</span>}
                                  <span className="font-medium">[{issue.step}]</span>
                                  <span className="text-[var(--muted)]"> {issue.message}</span>
                                  {issue.suggestion && <div className="text-blue-500 ml-2">→ {issue.suggestion}</div>}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="ml-5 text-[11px] text-green-600">步骤描述适合工作流生成</div>
                          )}
                        </div>

                        {/* 优化后的步骤 */}
                        {validationResult.optimizedSteps && (
                          <div className="border-t border-[var(--border)] pt-2">
                            <div className="flex items-center justify-between mb-1">
                              <span className="font-medium flex items-center gap-1.5">
                                <Sparkles size={13} className="text-purple-500" />
                                优化建议
                              </span>
                              <div className="flex items-center gap-1.5">
                                <button
                                  onClick={() => setShowDiff(true)}
                                  className="px-2.5 py-1 text-[11px] rounded transition flex items-center gap-1 bg-blue-50 text-blue-600 hover:bg-blue-100"
                                >
                                  <Diff size={12} />
                                  差异对比
                                </button>
                                <button
                                  onClick={() => {
                                    if (validationResult.optimizedSteps) {
                                      setAnalyzeSteps(validationResult.optimizedSteps);
                                    }
                                  }}
                                  className="px-2.5 py-1 text-[11px] bg-purple-100 text-purple-700 rounded hover:bg-purple-200 transition"
                                >
                                  应用优化
                                </button>
                              </div>
                            </div>
                            <pre className="text-[11px] p-3 bg-gray-50 border border-gray-200 rounded max-h-[150px] overflow-auto whitespace-pre-wrap font-mono">
                              {validationResult.optimizedSteps}
                            </pre>
                          </div>
                        )}
                      </div>
                    </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ========== 流程图 Tab ========== */}
          {activeTab === 'flow' && (
            <div className="h-full relative flex">
              <div className={`h-full transition-all duration-300 ${showJsonPanel ? 'flex-1 min-w-0' : 'w-full'}`}>
                {isGenerating ? (
                  <div className="h-full flex flex-col p-4 gap-3">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <span className="inline-block w-2.5 h-2.5 rounded-full bg-[var(--accent)] animate-pulse" />
                      <span className="text-[var(--fg)]">
                        {status === 'generating' ? '正在生成工作流...' : '正在生成代码...'}
                      </span>
                    </div>
                    <div
                      ref={streamLogRef}
                      className="flex-1 overflow-auto rounded border border-[var(--border)] bg-[#0d1117] p-3 font-mono text-xs leading-relaxed"
                    >
                      {streamLog.map((entry, i) => (
                        <div key={i} className={
                          entry.type === 'progress' ? 'text-blue-400 mb-1'
                            : entry.type === 'error' ? 'text-red-400 mb-1'
                            : 'text-green-300 whitespace-pre-wrap'
                        }>
                          {entry.type === 'progress' && <span className="text-gray-500 mr-1">›</span>}
                          {entry.text}
                          {entry.type === 'token' && i === streamLog.length - 1 && isGenerating && (
                            <span className="animate-pulse text-white">▋</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : flowChart ? (
                  <FlowChartView flowChart={flowChart} onNodeClick={handleNodeClick} />
                ) : (
                  <div className="h-full flex items-center justify-center text-[var(--muted)]">
                    请先在「逻辑描述与处理」中输入分析步骤并生成工作流
                  </div>
                )}

                {workflowDef && !showJsonPanel && !isGenerating && flowChart && (
                  <button
                    onClick={() => setShowJsonPanel(true)}
                    className="absolute top-3 right-3 z-10 flex items-center gap-1.5 px-3 py-1.5 text-xs bg-white border border-[var(--border)] rounded-lg shadow-sm hover:shadow-md hover:border-[var(--accent)] transition"
                    title="查看/编辑 JSON"
                  >
                    <Braces size={14} />
                    编辑 JSON
                    {jsonDirty && <span className="w-2 h-2 rounded-full bg-orange-400" />}
                  </button>
                )}
              </div>

              {/* JSON 编辑面板 + 左侧可拖拽分隔条 */}
              {showJsonPanel && (
                <div
                  onMouseDown={handleJsonHDragStart}
                  className="shrink-0 w-1 cursor-col-resize bg-[var(--border)] hover:bg-[var(--accent)] transition-colors"
                  title="拖动调整 JSON 面板宽度"
                />
              )}
              {showJsonPanel && (
                <div
                  style={{ width: jsonPanelWidth }}
                  className="h-full flex flex-col bg-[var(--bg)] shrink-0">
                  <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border)]">
                    <Braces size={14} className="text-[var(--muted)]" />
                    <span className="text-xs font-bold">工作流 JSON</span>
                    <div className="flex-1" />
                    {jsonError && (
                      <span className="text-[10px] text-red-500 truncate max-w-[150px]" title={jsonError}>格式错误</span>
                    )}
                    {jsonDirty && !jsonError && (
                      <span className="text-[10px] text-orange-500">已修改</span>
                    )}
                    {jsonDirty && (
                      <>
                        <button onClick={handleRevertJson} className="flex items-center gap-1 px-2 py-1 text-xs border border-[var(--border)] rounded hover:bg-red-50 hover:text-red-600 transition" title="撤销修改">
                          <X size={12} />
                        </button>
                        <button onClick={handleApplyJson} disabled={!!jsonError} className="flex items-center gap-1 px-2.5 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700 transition disabled:opacity-40" title="保存并更新流程图">
                          <Check size={12} /> 保存
                        </button>
                      </>
                    )}
                    <button onClick={() => setShowJsonPanel(false)} className="p-1 text-[var(--muted)] hover:text-[var(--fg)] transition" title="关闭">
                      <X size={14} />
                    </button>
                  </div>
                  <div className="flex-1 overflow-hidden">
                    <MonacoEditor
                      height="100%"
                      language="json"
                      value={jsonText}
                      onChange={handleJsonChange}
                      theme="vs-dark"
                      options={{
                        minimap: { enabled: false },
                        fontSize: 12,
                        lineNumbers: 'on',
                        wordWrap: 'on',
                        scrollBeyondLastLine: false,
                        automaticLayout: true,
                        tabSize: 2,
                        formatOnPaste: true,
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ========== 数据加工 Tab ========== */}
          {activeTab === 'data' && (
            <div className="h-full flex flex-col">
              {/* 数据加工顶部操作栏 */}
              <div className="px-4 py-2 border-b border-[var(--border)] flex items-center gap-3 shrink-0">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-[var(--border)] rounded hover:bg-[var(--accent-light)] transition"
                >
                  <FileUp size={14} />
                  {data ? '重新上传' : '上传数据'}
                </button>
                {data && (
                  <span className="text-xs text-[var(--muted)]">
                    当前: {data.fileName} ({data.rows.length} 行 × {data.headers.length} 列)
                  </span>
                )}
              </div>
              <div className="flex-1 overflow-hidden">
                <DataPreviewPanel
                  data={data}
                  headerOverrides={headerOverrides}
                  onHeaderRename={(idx, name) => setHeaderOverrides(prev => ({ ...prev, [idx]: name }))}
                  onHeaderReset={(idx) => setHeaderOverrides(prev => {
                    const next = { ...prev };
                    delete next[idx];
                    return next;
                  })}
                  onHeaderResetAll={() => setHeaderOverrides({})}
                />
              </div>
            </div>
          )}

          {/* ========== 结果输出 Tab ========== */}
          {activeTab === 'result' && (
            result ? (
              <ResultPanel result={result} code={code} />
            ) : (
              <div className="h-full flex items-center justify-center text-[var(--muted)]">
                请上传数据并执行分析
              </div>
            )
          )}

          {/* ========== 代码 Tab ========== */}
          {activeTab === 'code' && showCodeTab && (
            <CodeEditor
              code={code}
              onChange={handleCodeChange}
              highlightRange={highlightRange}
            />
          )}
        </div>
      </div>

      {/* 思考过程抽屉 */}
      <ThinkingDrawer
        open={thinkingOpen}
        content={thinkingContent}
        finished={thinkingFinished}
        onClose={() => setThinkingOpen(false)}
      />

      {/* 差异对比弹窗 */}
      <DiffModal
        open={showDiff}
        original={analyzeSteps}
        optimized={validationResult?.optimizedSteps || ''}
        onClose={() => setShowDiff(false)}
        onApply={() => {
          if (validationResult?.optimizedSteps) {
            setAnalyzeSteps(validationResult.optimizedSteps);
          }
        }}
      />

      {/* 请求日志面板 */}
      {showRequestLog && (
        <RequestLogPanel
          logs={requestLogs}
          onClear={() => setRequestLogs([])}
          onClose={() => setShowRequestLog(false)}
        />
      )}

      {/* 点赞点踩浮窗（固定右下角，走 /api/logs 通道；tag 由组件内下拉选择） */}
      <FeedbackFab />

      {/* 「生成工作流」拦截弹框：校验未做 / 信号引用 / 逻辑完整性不通过 */}
      {showGenerateGate && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => setShowGenerateGate(false)}
        >
          <div
            className="bg-white rounded-lg shadow-xl w-[480px] max-w-[92vw] max-h-[80vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 头部 */}
            <div className="flex items-center gap-2 px-5 py-3 border-b border-[var(--border)]">
              <AlertTriangle size={18} className="text-amber-500 shrink-0" />
              <h3 className="text-sm font-bold flex-1">
                {gateReason === 'no-validation' ? '请先进行逻辑校验' : '校验未通过，无法生成工作流'}
              </h3>
              <button
                onClick={() => setShowGenerateGate(false)}
                className="text-[var(--muted)] hover:text-[var(--fg)] transition"
                aria-label="关闭"
              >
                <X size={16} />
              </button>
            </div>

            {/* 正文 */}
            <div className="px-5 py-4 overflow-auto flex-1 text-sm">
              {gateReason === 'no-validation' && (
                <p className="text-[var(--fg)]">
                  在生成工作流之前，请先点击&nbsp;
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 border border-[var(--accent)] text-[var(--accent)] rounded text-xs">
                    <ShieldCheck size={12} /> 逻辑校验
                  </span>
                  &nbsp;按钮，让系统检查信号引用与逻辑完整性。
                </p>
              )}

              {validationResult && (gateReason === 'signal-failed' || gateReason === 'both-failed') && (
                <div className="mb-3">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-red-600 mb-1.5">
                    <XCircle size={13} />
                    信号引用检查未通过（{validationResult.signalCheck.issues.length} 项）
                  </div>
                  <ul className="ml-5 space-y-1 list-disc text-xs text-[var(--fg)]">
                    {validationResult.signalCheck.issues.slice(0, 5).map((issue, i) => (
                      <li key={i}>
                        <span className="font-mono text-red-500">{issue.signal}</span>：{issue.message}
                      </li>
                    ))}
                    {validationResult.signalCheck.issues.length > 5 && (
                      <li className="text-[var(--muted)]">
                        …还有 {validationResult.signalCheck.issues.length - 5} 项
                      </li>
                    )}
                  </ul>
                </div>
              )}

              {validationResult && (gateReason === 'logic-failed' || gateReason === 'both-failed') && (
                <div>
                  <div className="flex items-center gap-1.5 text-xs font-bold text-red-600 mb-1.5">
                    <XCircle size={13} />
                    逻辑完整性检查未通过（{validationResult.logicCheck.issues.length} 项）
                  </div>
                  <ul className="ml-5 space-y-1 list-disc text-xs text-[var(--fg)]">
                    {validationResult.logicCheck.issues.slice(0, 5).map((issue, i) => (
                      <li key={i}>
                        <span className="font-mono text-red-500">{issue.step}</span>：{issue.message}
                      </li>
                    ))}
                    {validationResult.logicCheck.issues.length > 5 && (
                      <li className="text-[var(--muted)]">
                        …还有 {validationResult.logicCheck.issues.length - 5} 项
                      </li>
                    )}
                  </ul>
                </div>
              )}
            </div>

            {/* 底部按钮 */}
            <div className="flex justify-end gap-2 px-5 py-3 border-t border-[var(--border)] bg-gray-50">
              <button
                onClick={() => setShowGenerateGate(false)}
                className="px-3 py-1.5 text-xs border border-[var(--border)] rounded hover:bg-white transition"
              >
                关闭
              </button>
              {gateReason === 'no-validation' ? (
                <button
                  onClick={() => {
                    setShowGenerateGate(false);
                    handleValidateLogic();
                  }}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs bg-[var(--accent)] text-white rounded hover:opacity-90 transition"
                >
                  <ShieldCheck size={12} />
                  立即校验
                </button>
              ) : (
                // 2/3/4：尽量「应用优化后逻辑并校验」；若 LLM 没给 optimizedSteps 则退化为重新校验
                <button
                  onClick={() => {
                    setShowGenerateGate(false);
                    applyOptimizedAndValidate();
                  }}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs bg-[var(--accent)] text-white rounded hover:opacity-90 transition"
                >
                  <ShieldCheck size={12} />
                  {validationResult?.optimizedSteps ? '应用优化后逻辑并校验' : '重新校验'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
