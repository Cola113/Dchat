export const runtime = 'nodejs';
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import { put } from '@vercel/blob';  // ✅ 会自动使用 Vercel 注入的环境变量

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

function sanitizeFileName(name: string) {
  const safeName = name
    .normalize('NFKD')
    .replace(/[\\/:*?"<>|\u0000-\u001F]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 100);

  return safeName || 'image';
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: '没有文件' }, { status: 400 });
    }

    if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
      return NextResponse.json(
        { error: '仅支持 JPG、PNG、WebP 或 GIF 图片' },
        { status: 415 }
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: '图片不能超过 10MB' },
        { status: 413 }
      );
    }

    const safeFileName = sanitizeFileName(file.name);

    // ✅ 无需传 token，自动使用环境变量
    const { url } = await put(
      `uploads/${Date.now()}-${crypto.randomUUID()}-${safeFileName}`,
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
