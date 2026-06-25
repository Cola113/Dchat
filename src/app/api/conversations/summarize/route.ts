import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_SUMMARY_BODY_BYTES = 768 * 1024;
const MAX_PROVIDER_COUNT = 4;

type ContentPart =
  | { type: 'text'; text?: string }
  | { type: 'image_url'; image_url?: { url?: string } };

type APIMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentPart[];
};

type Provider = {
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  priority: number;
  order: number;
};

type ConversationSummaryPayload = {
  previousSummary?: unknown;
  messages?: unknown;
};

type SummaryMessage = {
  id?: unknown;
  role?: unknown;
  content?: unknown;
  createdAt?: unknown;
};

function normalizeBaseUrl(value: string, providerName: string) {
  const withoutTrailingSlash = value.replace(/\/+$/, '');

  try {
    const url = new URL(withoutTrailingSlash);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString().replace(/\/+$/, '');
  } catch {
    console.warn(`[${providerName}] invalid baseUrl, skipped`);
    return null;
  }
}

function getProviders(): Provider[] {
  const providers: Provider[] = [];

  for (let i = 1; i <= MAX_PROVIDER_COUNT; i++) {
    const providerName = `Provider-${i}`;
    const baseUrl = (process.env[`BASE_URL_${i}`] || '').trim();
    const apiKey = (process.env[`KEY_${i}`] || '').trim();
    const model = (process.env[`MODEL_${i}`] || '').trim();
    const configuredPriority = Number.parseInt(process.env[`PROVIDER_PRIORITY_${i}`] || '', 10);
    const priority = Number.isFinite(configuredPriority) ? configuredPriority : i;

    if (!baseUrl || !apiKey || !model) continue;

    const normalizedBaseUrl = normalizeBaseUrl(baseUrl, providerName);
    if (!normalizedBaseUrl) continue;

    providers.push({
      name: providerName,
      baseUrl: normalizedBaseUrl,
      apiKey,
      model,
      priority,
      order: i,
    });
  }

  return providers.sort((a, b) => a.priority - b.priority || a.order - b.order);
}

function textFromContent(content: unknown) {
  if (typeof content === 'string') return content;

  if (!Array.isArray(content)) return '';

  return content
    .map((item) => {
      if (!item || typeof item !== 'object') return '';
      const raw = item as { type?: unknown; text?: unknown; image_url?: unknown };
      if (raw.type === 'text') return typeof raw.text === 'string' ? raw.text : '';
      if (raw.type === 'image_url') return '[图片]';
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function normalizeMessages(messages: unknown) {
  if (!Array.isArray(messages)) return [];

  return messages
    .map((message): APIMessage | null => {
      if (!message || typeof message !== 'object') return null;
      const raw = message as SummaryMessage;
      const role = raw.role === 'assistant' ? 'assistant' : raw.role === 'user' ? 'user' : null;
      if (!role) return null;

      const content = textFromContent(raw.content).trim();
      if (!content) return null;

      const createdAt = typeof raw.createdAt === 'string' ? raw.createdAt : '';
      return {
        role,
        content: createdAt ? `[${createdAt}] ${content}` : content,
      };
    })
    .filter((message): message is APIMessage => message !== null);
}

function stringifyPreviousSummary(value: unknown) {
  if (!value || typeof value !== 'object') return '';

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '';
  }
}

function buildSummaryMessages(previousSummary: unknown, messages: APIMessage[]): APIMessage[] {
  return [
    {
      role: 'system',
      content: `你是一个对话压缩器。你的任务是把一段旧聊天压缩成给后续 AI 助手使用的内部上下文摘要。

要求：
1. 只总结已经发生的内容，不编造、不推测、不补全。
2. 保留用户明确表达过的事实、偏好、情绪、目标、待办、限制和正在推进的话题。
3. 保留 AI 已经承诺、建议或完成的事项，尤其是后续需要继续衔接的内容。
4. 保留用户对表达风格、边界、称呼、隐私、技术实现的要求。
5. 如果内容涉及关系、情绪或私人信息，用低压、克制、事实化的方式记录，不加重语气。
6. 删除寒暄、重复、无实质内容的闲聊、失败重试细节和临时格式噪音。
7. 不要写“根据聊天记录/根据摘要/用户曾经说过”这类对外会暴露记录来源的话术。
8. 输出必须是严格 JSON，不要 markdown，不要解释。

输出格式：
{
  "summary": "一段可直接放入 system 上下文的简洁摘要。",
  "userFacts": ["用户明确表达过的事实或偏好"],
  "activeThreads": ["仍需要继续跟进的话题或任务"],
  "decisions": ["已经确定的实现决定、边界或约定"],
  "assistantState": ["AI 已完成、承诺或需要记住的事项"],
  "safetyBoundaries": ["后续表达需要遵守的边界"],
  "discarded": ["被压缩丢弃的信息类型，简短说明"]
}`,
    },
    {
      role: 'user',
      content: `请压缩以下旧对话。只保留对后续继续聊天有用的信息。

已有历史摘要：
${stringifyPreviousSummary(previousSummary) || '无'}

本次需要压缩的旧消息：
${JSON.stringify(messages, null, 2)}`,
    },
  ];
}

function normalizeSummaryResult(value: unknown) {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const summary = typeof raw.summary === 'string' ? raw.summary.trim() : '';
  if (!summary) return null;

  const list = (key: string) =>
    Array.isArray(raw[key])
      ? raw[key].filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      : [];

  return {
    summary,
    userFacts: list('userFacts'),
    activeThreads: list('activeThreads'),
    decisions: list('decisions'),
    assistantState: list('assistantState'),
    safetyBoundaries: list('safetyBoundaries'),
    discarded: list('discarded'),
  };
}

function parseSummaryContent(content: string) {
  const trimmed = content
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  const candidates = [trimmed];
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      const normalized = normalizeSummaryResult(JSON.parse(candidate));
      if (normalized) return normalized;
    } catch {}
  }

  return null;
}

async function requestSummary(provider: Provider, messages: APIMessage[]) {
  const response = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify({
      model: provider.model,
      messages,
      temperature: 0.2,
      stream: false,
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`[${provider.name}] HTTP ${response.status} ${body.slice(0, 300)}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    throw new Error(`[${provider.name}] 摘要响应缺少 content`);
  }

  const parsed = parseSummaryContent(content);
  if (!parsed) {
    throw new Error(`[${provider.name}] 摘要响应格式无效`);
  }

  return parsed;
}

export async function POST(request: NextRequest) {
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > MAX_SUMMARY_BODY_BYTES) {
    return NextResponse.json({ error: '摘要内容过大' }, { status: 413 });
  }

  let body: ConversationSummaryPayload;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '无效的 JSON 请求体' }, { status: 400 });
  }

  const messages = normalizeMessages(body.messages);
  if (messages.length === 0) {
    return NextResponse.json({ error: '没有可压缩的消息' }, { status: 400 });
  }

  const providers = getProviders();
  if (providers.length === 0) {
    return NextResponse.json({ error: '未配置任何模型服务商' }, { status: 500 });
  }

  const summaryMessages = buildSummaryMessages(body.previousSummary, messages);
  const errors: string[] = [];

  for (const provider of providers) {
    try {
      const summary = await requestSummary(provider, summaryMessages);
      return NextResponse.json(summary);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(message);
      console.warn('上下文压缩失败:', message);
    }
  }

  return NextResponse.json(
    { error: `上下文压缩失败：${errors.join('；')}` },
    { status: 502 }
  );
}
