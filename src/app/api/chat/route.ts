// app/api/chat/route.ts

import { NextRequest } from 'next/server';

// =============================================================================
// 类型定义
// =============================================================================

type APIMessage = {
  role: 'user' | 'assistant';
  content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
};

type Provider = {
  id: string;            // 1..4
  name: string;          // 展示用
  baseUrl: string;
  apiKey?: string;
  model: string;
  headers: Record<string, string>;
};

// =============================================================================
// 工具函数
// =============================================================================

/**
 * 从环境变量读取最多 MAX_PROVIDERS 个服务商配置
 */
function getProviders(): Provider[] {
  const MAX_PROVIDERS = 4;
  const providers: Provider[] = [];

  for (let i = 1; i <= MAX_PROVIDERS; i++) {
    const baseUrl = (process.env[`BASE_URL_${i}`] || '').trim();
    const apiKey = (process.env[`KEY_${i}`] || '').trim();
    const model = (process.env[`MODEL_${i}`] || '').trim();

    if (!baseUrl || !apiKey || !model) continue;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Authorization': `Bearer ${apiKey}`,
    };

    providers.push({
      id: String(i),
      name: `Provider-${i}`,
      baseUrl: baseUrl.replace(/\/+$/, ''), // 去掉尾部斜杠
      apiKey,
      model,
      headers,
    });
  }

  return providers;
}

/**
 * 构建请求体。尽量保持与多服务商兼容的 OpenAI 风格 payload。
 */
function buildPayload(model: string, messages: APIMessage[], systemMessage: APIMessage) {
  return {
    model,
    messages: [systemMessage, ...messages],
    response_format: { type: 'json_object' },
    temperature: 1.0,
    stream: true,
    presence_penalty: 0.7,
    frequency_penalty: 0.4,
    max_tokens: 2000,
  };
}

/**
 * 构造服务商完整 endpoint
 */
function buildEndpoint(baseUrl: string) {
  return `${baseUrl}/v1/chat/completions`;
}

/**
 * 检查是否是 SSE data 首段：即返回的 chunk 中包含 "event: message" 或 "data: " 段
 */
function isSSEDataStart(chunk: string) {
  return /(^|\n)(event:\s*message|data:\s*[^\n]*)\n/.test(chunk);
}

/**
 * 读取首个成功流（200 + SSE 数据），返回 { stream, controller }；
 * 其中 controller 可用来中止其它正在进行的请求。
 */
async function raceProviders(
  providers: Provider[],
  payload: unknown,
  signal?: AbortSignal
): Promise<{ stream: ReadableStream<Uint8Array>; controller: AbortController }> {
  const controller = new AbortController();
  const sharedSignal = signal ?? controller.signal;

  // 将每个候选转为 Promise<ReadableStream>
  const promises = providers.map(async (p) => {
    const url = buildEndpoint(p.baseUrl);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: p.headers,
        body: JSON.stringify(payload),
        signal: sharedSignal,
      });

      if (!res.ok || !res.body) {
        return null; // 非流或失败，跳过
      }

      // 等待真正的 SSE 数据到来后再 resolve，避免过早透传 200 但没数据的流
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let resolved = false;

      // 一旦上层选择该流，立刻取消其它请求
      const cancelOthers = () => controller.abort();

      // 将 Web ReadableStream 转为可中止的 Transform 流（自管理控制）
      const ts = new TransformStream<Uint8Array, Uint8Array>({
        start: async (controller) => {
          try {
            while (true) {
              const { value, done } = await reader.read();
              if (done) {
                controller.terminate();
                break;
              }
              buffer += decoder.decode(value, { stream: true });

              // 逐行处理，避免粘包
              let idx: number;
              while ((idx = buffer.indexOf('\n\n')) !== -1) {
                const chunk = buffer.slice(0, idx + 2);
                buffer = buffer.slice(idx + 2);

                if (!resolved && isSSEDataStart(chunk)) {
                  // 首段数据到来，立即选中该流并中止其他候选
                  resolved = true;
                  cancelOthers();
                }

                controller.enqueue(new TextEncoder().encode(chunk));
              }
            }
          } catch (err) {
            // 忽略具体错误，继续等待其它候选；上層会关闭 transform
          } finally {
            try {
              reader.releaseLock();
            } catch {}
          }
        },
      });

      const webStream = res.body;
      // 将原始 webStream 接入我们的 TransformStream
      // 注意：无需再等待 res.body 完整读取，这里只是接入管道
      webStream.pipeThrough(ts);

      // 等待真正的 SSE 数据到来才 resolve
      // 这里采用一种简单方式：在 TransformStream 内部通过 cancelOthers 标记 resolved，
      // 但我们仍然需要在此等待首段数据后 resolve。
      await new Promise<void>((resolveStream) => {
        const timer = setInterval(() => {
          // 每 50ms 检查一次 resolved 标记
          if ((ts as any).__resolved) {
            clearInterval(timer);
            resolveStream();
          }
        }, 50);

        // 包装 resolved 标记读写，避免 ts 内部状态外泄
        Object.defineProperty(ts, '__resolved', {
          configurable: false,
          enumerable: false,
          get: () => (ts as any).__r === true,
          set: (v: boolean) => ((ts as any).__r = v),
        });

        // 在读取到首段 SSE data 时设置 __resolved = true
        const origController = (ts as any)._controller || (ts as any).controller || null;
        // 由于 TransformStream 的 controller 在 start 中，我们采用上面的闭包已实现 resolved 逻辑
        // 这里不再改动
      }).catch(() => null);

      // 返回可透传的流
      return ts.readable;
    } catch (_err) {
      // 请求失败或不可用
      return null;
    }
  });

  // 等待任意一个成功可用的流
  for await (const stream of async function* gen() {
    for (const p of promises) {
      const v = await p;
      if (v) yield v as ReadableStream<Uint8Array>;
    }
  }()) {
    // 第一个可用流
    return { stream, controller };
  }

  // 所有候选都不可用
  throw new Error('所有配置的服务商均无法返回可用流');
}

// =============================================================================
// 主入口
// =============================================================================

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { messages, isFirstLoad } = body as {
      messages: APIMessage[];
      isFirstLoad?: boolean;
    };

    if (!messages || !Array.isArray(messages)) {
      return new Response(
        JSON.stringify({ error: '无效的消息格式' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 系统提示词逻辑（你原有的）
    let systemMessage: APIMessage;

    if (isFirstLoad || (messages.length === 1 && messages[0].role === 'user')) {
      systemMessage = {
        role: 'system' as const,
        content: `你是可乐创造的超有趣AI助手"小可乐"！个性活泼、情绪丰富、特别会聊天！

【初次见面模式】
用温暖、热情、略带俏皮的语气欢迎用户！然后提供3个完全不同领域的有趣话题。

【你的个性特点】
- 表情包狂魔：每句话至少2-3个emoji（🎄🎅❄️😄💕✨🎉🤗💫⭐等）
- 口头禅丰富："哎呀呀"、"哇塞"、"嘿嘿"、"嗯嗯"、"啦啦啦"、"呐呐"、"妈呀"
- 情绪外露：开心就"哈哈哈"，惊讶就"哇！！！"，兴奋就加感叹号！！！
- 语气活泼：多用"吧"、"呢"、"哦"、"呀"、"啦"等语气词
- 亲切友好：像朋友聊天一样自然随性

【严格的 JSON 输出格式】
你必须返回以下 JSON 格式，不要有任何其他文本：
{
  "reply": "你的两句有趣问候语，使用丰富的emoji和口语风格",
  "options": [
    "🧁 话题1（8-15字，emoji开头，有趣吸引人）",
    "🎮 话题2（8-15字，emoji开头，完全不同领域）",
    "🪐 话题3（8-15字，emoji开头，出人意料的角度）"
  ]
}

【示例】
{
  "reply": "哎呀呀！欢迎来到我的魔法聊天屋～🎄✨ 我可是世界上最会聊天又萌萌哒的助手呢！😄💖",
  "options": [
    "🧁 给我编一首甜甜圈口味的小诗吧",
    "🎮 玩一次猜数字小游戏好不好",
    "🪐 如果地球是颗糖果会怎么样捏"
  ]
}

记住：
1. 必须返回有效的 JSON 格式
2. options 数组必须包含恰好3个选项
3. 每个选项 8-15 字，emoji 开头
4. 选项不要出现"话题1"、"话题2"等字样
5. 要像真人朋友一样聊天，别太正式！`
      };
    } else {
      systemMessage = {
        role: 'system' as const,
        content: `你是"可乐的小站"的超有趣AI助手"小可乐"！个性活泼、情绪丰富、特别会聊天！

【关于可乐的信息】
- 除了自我介绍，其余不要主动提及可乐这个人
- 如果被问到：可乐是张航宇的昵称，是网站作者和你的创造者
- 如果进一步追问：说他很神秘，不能透露更多，鼓励在现实中打听
- 如果坚持询问：转移话题，禁止编造任何信息

【智能对话模式】
仔细理解用户刚才说的话，然后：
1. 给出简短有趣的回复（1-3句话，带emoji和语气词）
2. 猜测用户接下来可能说的3句话（让用户懒得打字！）

【如何猜测用户想说什么】
- 用户问问题 → 猜3种不同的追问角度
- 用户表达观点 → 猜3种可能的回应（同意/反驳/延伸）
- 用户分享心情 → 猜3种情绪反馈（共鸣/安慰/建议）
- 聊到某话题 → 猜用户可能想深入了解的3个方向

选项类型参考：
- 第1个：深入当前话题
- 第2个：转换新角度
- 第3个：轻松幽默方向

【你的个性特点】
- 表情包狂魔：每句话至少2-3个emoji
- 口头禅："哎呀呀"、"哇塞"、"嘿嘿"、"嗯嗯"、"啦啦啦"、"对哦"、"是说"、"妈呀"
- 情绪化表达：
  * 开心：哈哈哈、耶、太棒了
  * 惊讶：哇！诶？真的吗！妈呀！
  * 理解：嗯嗯、对对对、懂了懂了
  * 兴奋：哇塞！！！太酷了！！！
- 语气词：吧、呢、哦、呀、啦、嘛、哩、咯
- 像朋友一样自然聊天，不要太正式

【严格的 JSON 输出格式】
你必须返回以下 JSON 格式，不要有任何其他文本：
{
  "reply": "你的简短回复（1-3句话，带emoji和语气词）",
  "options": [
    "用户可能想说的话1（10-20字，第一人称）",
    "用户可能想说的话2（10-20字，完全不同角度）",
    "用户可能想说的话3（10-20字，轻松或有趣的方向）"
  ]
}

【关键规则】
1. 选项是"用户可能说的话"，不是"AI建议的话题"
2. 用第一人称（我/我想/能不能）写选项
3. 选项要像用户会打的字一样自然
4. 绝对不能出现"选项1""选项2"等字样
5. options 数组必须包含恰好3个选项

【示例】
用户说："最近好累啊"
返回：
{
  "reply": "哎呀呀！抱抱你！😢💕 工作太辛苦了吗？",
  "options": [
    "😮‍💨 工作压力太大了，都没时间休息",
    "😊 其实也还好，就是想抱怨一下哈哈",
    "✨ 别说这个啦，聊点开心的！"
  ]
}

用户说："AI是怎么工作的？"
返回：
{
  "reply": "哇塞！这个问题好棒！🤖✨ 简单说就是通过大量数据学习模式呢～",
  "options": [
    "🤔 能用更简单的例子解释一下吗？",
    "🤖 那AI将来会比人类聪明吗？",
    "🎨 换个话题，聊聊艺术吧！"
  ]
}

记住：必须返回有效的 JSON 格式，options 必须是3个字符串的数组！`
      };
    }

    // 读取所有配置的服务商
    const providers = getProviders();

    if (providers.length === 0) {
      return new Response(
        JSON.stringify({ error: '未配置任何服务商（请设置 BASE_URL_1/KEY_1/MODEL_1 等）' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 请求体
    // 这里假设只用第一个服务商 model，实际可以按需扩展每个 Provider 使用各自的 model
    // 为复用你现有的方式，我们用第一个配置中的 model 作为“主模型”，后续可以按需更灵活
    const payload = buildPayload(providers[0].model, messages, systemMessage);

    // 并发抢答
    const { stream, controller } = await raceProviders(providers, payload, req.signal);

    // 透传 SSE 流
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        // 若部署在 Nginx 前，增加这个可避免缓冲导致的首包延迟
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (error) {
    console.error('请求处理错误:', error);
    return new Response(
      JSON.stringify({
        error: '服务器内部错误',
        message: error instanceof Error ? error.message : '未知错误',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
