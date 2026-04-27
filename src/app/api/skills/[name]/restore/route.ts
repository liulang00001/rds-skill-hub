/**
 * API: 从历史版本复制为新版本（薄代理）
 * POST /api/skills/[name]/restore  body: { version: number }
 */
import { NextRequest, NextResponse } from 'next/server';
import { API_GENERATE_BASE, apiUrl } from '@/lib/api-config';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  try {
    const { name } = await params;
    const body = await request.json();
    const upstream = apiUrl(API_GENERATE_BASE, `/api/skills/${encodeURIComponent(name)}/restore`);
    const res = await fetch(upstream, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) });
  }
}
