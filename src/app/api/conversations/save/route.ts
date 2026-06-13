import { NextRequest, NextResponse } from 'next/server';
import { createHmac } from 'crypto';

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

type OssConfig = {
  region: string;
  bucket: string;
  accessKeyId: string;
  accessKeySecret: string;
  endpointHost: string;
  prefix: string;
  securityToken?: string;
};

function getOssConfig(): OssConfig | null {
  const region = process.env.ALI_OSS_REGION?.trim();
  const bucket = process.env.ALI_OSS_BUCKET?.trim();
  const accessKeyId = process.env.ALI_OSS_ACCESS_KEY_ID?.trim();
  const accessKeySecret = process.env.ALI_OSS_ACCESS_KEY_SECRET?.trim();
  const endpointHost = (
    process.env.ALI_OSS_ENDPOINT?.trim() || `${bucket}.${region}.aliyuncs.com`
  ).replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const prefix = (process.env.ALI_OSS_PREFIX || 'chat-logs').trim().replace(/^\/+|\/+$/g, '');
  const securityToken = process.env.ALI_OSS_SECURITY_TOKEN?.trim();

  if (!region || !bucket || !accessKeyId || !accessKeySecret) return null;

  return {
    region,
    bucket,
    accessKeyId,
    accessKeySecret,
    endpointHost,
    prefix: prefix || 'chat-logs',
    securityToken: securityToken || undefined,
  };
}

function sanitizeSegment(value: string, fallback: string) {
  const sanitized = value
    .normalize('NFKD')
    .replace(/[\\/:*?"<>|\u0000-\u001F]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120);

  return sanitized || fallback;
}

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

function encodeOssKey(key: string) {
  return key.split('/').map(encodeURIComponent).join('/');
}

function signOssRequest({
  config,
  key,
  date,
  contentType,
}: {
  config: OssConfig;
  key: string;
  date: string;
  contentType: string;
}) {
  const canonicalizedOssHeaders = config.securityToken
    ? `x-oss-security-token:${config.securityToken}\n`
    : '';
  const canonicalizedResource = `/${config.bucket}/${key}`;
  const stringToSign = [
    'PUT',
    '',
    contentType,
    date,
    `${canonicalizedOssHeaders}${canonicalizedResource}`,
  ].join('\n');

  return createHmac('sha1', config.accessKeySecret)
    .update(stringToSign)
    .digest('base64');
}

async function putJsonToOss(config: OssConfig, key: string, payload: unknown) {
  const body = Buffer.from(JSON.stringify(payload, null, 2), 'utf8');
  const date = new Date().toUTCString();
  const contentType = 'application/json; charset=utf-8';
  const signature = signOssRequest({ config, key, date, contentType });
  const headers: Record<string, string> = {
    Authorization: `OSS ${config.accessKeyId}:${signature}`,
    Date: date,
    'Content-Type': contentType,
    'Content-Length': String(body.length),
  };

  if (config.securityToken) {
    headers['x-oss-security-token'] = config.securityToken;
  }

  const response = await fetch(`https://${config.endpointHost}/${encodeOssKey(key)}`, {
    method: 'PUT',
    headers,
    body,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`OSS PutObject failed: ${response.status} ${errorText}`);
  }
}

export async function POST(request: NextRequest) {
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > MAX_LOG_BODY_BYTES) {
    return NextResponse.json({ error: '日志内容过大' }, { status: 413 });
  }

  const config = getOssConfig();
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
  const safeConversationId = sanitizeSegment(conversationId, 'conversation');
  const safeMessageId = sanitizeSegment(messageId, 'message');
  const key = `${config.prefix}/${date}/${safeConversationId}/${Date.now()}-${role}-${safeMessageId}.json`;

  const payload = {
    conversationId,
    messageId,
    role,
    content: normalizeContent(body.content),
    createdAt,
    metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : undefined,
  };

  try {
    await putJsonToOss(config, key, payload);

    return NextResponse.json({ ok: true, key });
  } catch (error) {
    console.error('保存对话日志失败:', error);
    return NextResponse.json({ error: '保存对话日志失败' }, { status: 500 });
  }
}
