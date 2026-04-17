/**
 * API: 读取单个 Skill（薄代理）
 * GET /api/skills/[name] - 从后端 api-services 读取完整 skill 数据
 */
import { NextRequest, NextResponse } from 'next/server';
import { API_GENERATE_BASE, apiUrl } from '@/lib/api-config';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  try {
    const { name } = await params;
    const upstream = apiUrl(API_GENERATE_BASE, `/api/skills/${encodeURIComponent(name)}`);
    const res = await fetch(upstream, { cache: 'no-store' });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) });
  }
}
