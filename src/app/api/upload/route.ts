export const runtime = 'nodejs';
export const maxDuration = 60;
export const preferredRegion = 'hkg1';

import { NextRequest, NextResponse } from 'next/server';
import { put } from '@vercel/blob';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: '没有文件' }, { status: 400 });
    }

    const { url } = await put(`uploads/${Date.now()}-${file.name}`, file, {
      access: 'public',
    });

    return NextResponse.json({ url });
  } catch (error) {
    console.error('上传错误:', error);
    return NextResponse.json(
      { error: '文件上传失败，请检查配置' },
      { status: 500 }
    );
  }
}
