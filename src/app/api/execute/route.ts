/**
 * API: 执行分析代码
 */
import { NextRequest, NextResponse } from 'next/server';
import { executeCode } from '@/lib/executor';
import { ExecutionResult } from '@/lib/types';

/** 将执行结果输出到 console，由 FaaS 平台收集 */
function logDebugInfo(code: string, result: ExecutionResult) {
  const ts = new Date().toISOString();
  console.log(`[execute] === DEBUG ${ts} ===`);
  console.log(`[execute] 状态: ${result.success ? '成功' : '失败'} | 耗时: ${result.duration}ms | 摘要: ${result.summary}`);

  if (result.findings.length > 0) {
    for (const f of result.findings) {
      const icon = f.type === 'success' ? '[OK]' : f.type === 'warning' ? '[WARN]' : f.type === 'error' ? '[ERR]' : '[INFO]';
      console.log(`[execute] ${icon} ${f.message}`);
    }
  }

  if (result.report && result.report.length > 0) {
    console.log(`[execute] 报告: ${result.report.join('\n')}`);
  }

  console.log(`[execute] Code (${code.length} chars), Logs (${result.logs.length} entries)`);
}

export async function POST(request: NextRequest) {
  try {
    const { code, data } = await request.json();

    if (!code || !data) {
      return NextResponse.json({ success: false, error: '缺少代码或数据' });
    }

    console.log(`[execute] Running code (${code.length} chars) on ${data.rows.length} rows...`);
    const result = executeCode(code, data);
    console.log(`[execute] Done in ${result.duration}ms, ${result.findings.length} findings`);

    logDebugInfo(code, result);

    return NextResponse.json({ success: true, result });
  } catch (error) {
    console.error('[execute] Error:', error);
    return NextResponse.json({
      success: false,
      error: `执行失败: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}
