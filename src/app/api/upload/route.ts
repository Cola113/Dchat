export const runtime = 'nodejs';
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import {
  createAliyunOssReadUrl,
  getAliyunOssConfig,
  getAliyunOssPrefix,
  putObjectToAliyunOss,
  sanitizeOssSegment,
} from '@/lib/aliyunOss';

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const DEFAULT_READ_URL_TTL_SECONDS = 24 * 60 * 60;
const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

function getReadUrlTtlSeconds() {
  const raw = Number(process.env.ALI_OSS_UPLOAD_URL_TTL_SECONDS);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_READ_URL_TTL_SECONDS;
  return Math.min(Math.floor(raw), 7 * 24 * 60 * 60);
}

export async function POST(request: NextRequest) {
  const config = getAliyunOssConfig();
  if (!config) {
    return NextResponse.json(
      { error: '未配置阿里云 OSS 上传环境变量' },
      { status: 503 }
    );
  }

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

    const prefix = getAliyunOssPrefix('ALI_OSS_UPLOAD_PREFIX', 'uploads');
    const date = new Date().toISOString().slice(0, 10);
    const safeFileName = sanitizeOssSegment(file.name, 'image', 100);
    const key = `${prefix}/${date}/${Date.now()}-${crypto.randomUUID()}-${safeFileName}`;

    await putObjectToAliyunOss({
      config,
      key,
      body: file,
      contentType: file.type,
    });

    const url = createAliyunOssReadUrl({
      config,
      key,
      expiresInSeconds: getReadUrlTtlSeconds(),
    });

    return NextResponse.json({ url, key });
  } catch (error) {
    console.error('上传到阿里云 OSS 失败:', error);
    return NextResponse.json(
      { error: '文件上传失败，请检查阿里云 OSS 配置' },
      { status: 500 }
    );
  }
}
