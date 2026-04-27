/**
 * API: 读取 Skill 的指定历史版本完整数据（薄代理）
 * GET /api/skills/[name]/versions/[version]
 */
import { NextRequest, NextResponse } from 'next/server';
import { API_GENERATE_BASE, apiUrl } from '@/lib/api-config';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ name: string; version: string }> }
) {
  try {
    const { name, version } = await params;
    const upstream = apiUrl(
      API_GENERATE_BASE,
      `/api/skills/${encodeURIComponent(name)}/versions/${encodeURIComponent(version)}`
    );
    const res = await fetch(upstream, { cache: 'no-store' });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) });
  }
}
