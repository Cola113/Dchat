import { NextRequest, NextResponse } from 'next/server';
import {
  getAliyunOssConfig,
  getAliyunOssPrefix,
  putObjectToAliyunOss,
  sanitizeOssSegment,
} from '@/lib/aliyunOss';

export const runtime = 'nodejs';
export const maxDuration = 30;

const MAX_LOG_BODY_BYTES = 512 * 1024;
const ALLOWED_ROLES = new Set(['user', 'assistant', 'system', 'error']);

type LogContent =
  | string
  | Array<{
      type: string;
      text?: string;
      image_url?: { url?: string };
    }>;

type ConversationLogPayload = {
  conversationId?: unknown;
  messageId?: unknown;
  role?: unknown;
  content?: unknown;
  createdAt?: unknown;
  metadata?: unknown;
};

function normalizeContent(content: unknown): LogContent {
  if (typeof content === 'string') return content.slice(0, MAX_LOG_BODY_BYTES);

  if (Array.isArray(content)) {
    return content.map((item) => {
      if (!item || typeof item !== 'object') return { type: 'unknown' };

      const rawItem = item as { type?: unknown; text?: unknown; image_url?: unknown };
      const type = typeof rawItem.type === 'string' ? rawItem.type : 'unknown';

      if (type === 'text') {
        return {
          type: 'text',
          text: typeof rawItem.text === 'string' ? rawItem.text : '',
        };
      }

      if (type === 'image_url') {
        const imageUrl =
          rawItem.image_url &&
          typeof rawItem.image_url === 'object' &&
          'url' in rawItem.image_url &&
          typeof rawItem.image_url.url === 'string'
            ? rawItem.image_url.url
            : '';

        return {
          type: 'image_url',
          image_url: {
            url: imageUrl.startsWith('data:') ? '[data-url omitted]' : imageUrl,
          },
        };
      }

      return { type };
    });
  }

  return '';
}

export async function POST(request: NextRequest) {
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > MAX_LOG_BODY_BYTES) {
    return NextResponse.json({ error: '日志内容过大' }, { status: 413 });
  }

  const config = getAliyunOssConfig();
  if (!config) {
    return NextResponse.json(
      { error: '未配置阿里云 OSS 日志环境变量' },
      { status: 503 }
    );
  }

  let body: ConversationLogPayload;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '无效的 JSON 请求体' }, { status: 400 });
  }

  const conversationId =
    typeof body.conversationId === 'string' ? body.conversationId.trim() : '';
  const messageId = typeof body.messageId === 'string' ? body.messageId.trim() : '';
  const role = typeof body.role === 'string' ? body.role.trim() : '';

  if (!conversationId || !messageId || !ALLOWED_ROLES.has(role)) {
    return NextResponse.json({ error: '日志字段不完整' }, { status: 400 });
  }

  const createdAt =
    typeof body.createdAt === 'string' && !Number.isNaN(Date.parse(body.createdAt))
      ? body.createdAt
      : new Date().toISOString();

  const date = createdAt.slice(0, 10);
  const prefix = getAliyunOssPrefix('ALI_OSS_PREFIX', 'chat-logs');
  const safeConversationId = sanitizeOssSegment(conversationId, 'conversation');
  const safeMessageId = sanitizeOssSegment(messageId, 'message');
  const key = `${prefix}/${date}/${safeConversationId}/${Date.now()}-${role}-${safeMessageId}.json`;

  const payload = {
    conversationId,
    messageId,
    role,
    content: normalizeContent(body.content),
    createdAt,
    metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : undefined,
  };

  try {
    await putObjectToAliyunOss({
      config,
      key,
      body: Buffer.from(JSON.stringify(payload, null, 2), 'utf8'),
      contentType: 'application/json; charset=utf-8',
    });

    return NextResponse.json({ ok: true, key });
  } catch (error) {
    console.error('保存对话日志失败:', error);
    return NextResponse.json({ error: '保存对话日志失败' }, { status: 500 });
  }
}
