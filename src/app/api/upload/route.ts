export const runtime = 'nodejs';
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import { put } from '@vercel/blob';  // ✅ 会自动使用 Vercel 注入的环境变量

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: '没有文件' }, { status: 400 });
    }

    // ✅ 无需传 token，自动使用环境变量
    const { url } = await put(
      `uploads/${Date.now()}-${file.name}`,
      file,
      { access: 'public' }
    );

    return NextResponse.json({ url });
  } catch (error) {
    console.error('上传错误:', error);
    return NextResponse.json(
      { error: '文件上传失败，请确保已启用 Vercel Blob' },
      { status: 500 }
    );
  }
}
