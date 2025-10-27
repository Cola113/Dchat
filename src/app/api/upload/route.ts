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

    // 检查文件类型
    if (!file.type.startsWith('image/')) {
      return NextResponse.json({ error: '只能上传图片文件' }, { status: 400 });
    }

    // 检查文件大小 (10MB限制)
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
      return NextResponse.json({ error: '文件大小不能超过10MB' }, { status: 400 });
    }

    const blob = await put(`uploads/${Date.now()}-${file.name}`, file, {
      access: 'public',
      addRandomSuffix: true,
      // 如果使用私有空间，需要添加token
      // token: process.env.BLOB_READ_WRITE_TOKEN
    });

    return NextResponse.json({ url: blob.url });
  } catch (error: any) {
    console.error('上传错误:', error);
    return NextResponse.json({ 
      error: error?.message || '上传失败' 
    }, { 
      status: 500 
    });
  }
}