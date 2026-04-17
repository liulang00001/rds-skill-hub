/**
 * API: 管理保存的 Skill（完整工作流快照）
 *
 * 当前实现为**薄代理**：把前端请求转发给后端 api-services 的 MySQL 存储。
 *   GET    - 列出所有已保存的 skill
 *   POST   - 保存/更新 skill（upsert）
 *   DELETE - 删除 skill
 */
import { NextRequest, NextResponse } from 'next/server';
import { API_GENERATE_BASE, apiUrl } from '@/lib/api-config';

const UPSTREAM = apiUrl(API_GENERATE_BASE, '/api/skills');

export async function GET() {
  try {
    const res = await fetch(UPSTREAM, { cache: 'no-store' });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const res = await fetch(UPSTREAM, {
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

export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const res = await fetch(UPSTREAM, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) });
  }
}
