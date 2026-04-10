# RDS Skill Hub

## 项目概述
远程诊断技能工作台 — 用户输入自然语言描述 → LLM 生成工作流 JSON → 自动生成流程图 + 可执行 TS 代码 → 上传数据执行分析。

## 技术栈
- **框架**: Next.js 15 (App Router) + React 19 + TypeScript
- **样式**: Tailwind CSS 4 + PostCSS
- **流程图**: @xyflow/react 12 + @dagrejs/dagre（自动布局）
- **代码编辑器**: @monaco-editor/react
- **LLM**: OpenAI 兼容 API（豆包/doubao），配置在 `config.json`
- **代码生成**: ts-morph（AST 操作）
- **数据处理**: xlsx（Excel 解析）

## 目录结构
```
src/
├── app/
│   ├── page.tsx              # 主页面（单页应用，所有 UI 状态）
│   ├── layout.tsx            # 根布局
│   ├── globals.css           # 全局样式（Tailwind）
│   └── api/                  # API Routes
│       ├── generate/         # LLM 生成工作流 JSON
│       ├── generate-code/    # JSON → TS 代码生成
│       ├── validate-logic/   # 逻辑校验
│       ├── execute/          # 执行生成的 TS 代码
│       ├── skills/           # 技能 CRUD
│       └── scripts/          # 脚本 CRUD
├── components/
│   ├── FlowChart.tsx         # XYFlow 流程图组件
│   ├── CodeEditor.tsx        # Monaco 代码编辑器
│   ├── DataPreviewPanel.tsx  # 数据预览面板
│   ├── ResultPanel.tsx       # 执行结果展示
│   └── LineNumberedTextarea.tsx
└── lib/
    ├── types.ts              # 核心类型定义（FlowNode/Edge, ProjectState 等）
    ├── workflow-schema.ts    # 工作流 JSON Schema + 标准模块定义
    ├── standard-modules.ts   # 标准模块代码模板
    ├── llm-client.ts         # LLM 客户端（单例+队列+429重试）
    ├── json-to-flow.ts       # JSON → 流程图转换
    ├── json-to-code.ts       # JSON → TS 代码生成
    ├── executor.ts           # 代码沙箱执行器
    ├── prompts.ts            # LLM prompt 模板
    ├── dagre-layout.ts       # 流程图自动布局
    ├── extract-json.ts       # 从 LLM 输出提取 JSON
    ├── config.ts             # 配置读取
    ├── api-config.ts         # 前端 API 地址
    └── logger.ts             # 日志工具
```

## 核心数据流
1. 用户输入描述 + 信号定义 → `POST /api/generate` → LLM → `WorkflowDefinition` JSON
2. JSON → `json-to-flow.ts` → 流程图（FlowChart）
3. JSON → `POST /api/generate-code` → `json-to-code.ts` → TS 代码
4. 代码 + 数据 → `POST /api/execute` → `executor.ts` → `ExecutionResult`

## 关键类型
- `WorkflowDefinition` (workflow-schema.ts) — 工作流根定义，含节点树
- `ModuleName` — 约 20 种标准模块（scanAll, detectTransition, checkValue 等）
- `ProjectState` (types.ts) — 整个应用状态
- `FlowNode` / `FlowEdge` — 流程图节点/边

## 开发命令
```bash
npm run dev    # 启动开发服务器 (port 3000)
npm run build  # 构建
npx tsc        # 类型检查
```

## 编码约定
- 路径别名：`@/*` → `./src/*`
- API 路由用 Next.js App Router 的 `route.ts` 约定
- 中文注释，英文代码
- 组件文件用 PascalCase，lib 文件用 kebab-case

---

## 作用域限制（强制）

**NEVER** 读取、Glob、Grep 当前 worktree 根目录以外的路径。
- 禁止访问：`E:/飞书下载文档/远程诊断/rds-skill-hub/`（其他项目）
- 禁止访问：`.claude/worktrees/` 下其他 worktree 目录
- 所有文件操作必须限定在当前工作目录（worktree）内
- 如需比较分支差异，使用 `git diff` 命令，而非直接读取其他分支文件
