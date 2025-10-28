// src/app/api/chat/route.ts
import { NextRequest } from 'next/server';

// ------------------------------------------------------------
// 1️⃣ 类型定义（已加入 'system' 角色）
// ------------------------------------------------------------
type ContentPart =
  | { type: 'text'; text?: string }
  | { type: 'image_url'; image_url?: { url: string } };

type APIMessage = {
  /** 支持 system、user、assistant 三种角色 */
  role: 'system' | 'user' | 'assistant';
  /** 文本或复合内容块（与 OpenAI‑ChatCompletions 完全兼容） */
  content: string | ContentPart[];
};

type Provider = {
  id: string;                // "1" .. "4"
  name: string;              // "Provider-1" .. "Provider-4"
  baseUrl: string;           // 去掉尾斜杠的 BASE_URL_*
  apiKey: string;            // KEY_*
  model: string;             // MODEL_*
  headers: Record<string, string>;
};

type RaceResult = {
  readableStream: ReadableStream<Uint8Array>;
  abortController: AbortController;
};

// ------------------------------------------------------------
// 2️⃣ 环境变量读取（1~4 组，缺省则自动跳过）
// ------------------------------------------------------------
function getProviders(): Provider[] {
  const providers: Provider[] = [];
  const MAX = 4;

  for (let i = 1; i <= MAX; i++) {
    const baseUrl = (process.env[`BASE_URL_${i}`] || '').trim();
    const apiKey  = (process.env[`KEY_${i}`]    || '').trim();
    const model   = (process.env[`MODEL_${i}`]   || '').trim();

    if (!baseUrl || !apiKey || !model) continue;   // 缺省即跳过

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept':       'text/event-stream',
      'Cache-Control':'no-cache',
      'Connection':   'keep-alive',
      'Authorization': `Bearer ${apiKey}`,
    };

    providers.push({
      id: String(i),
      name: `Provider-${i}`,
      baseUrl: baseUrl.replace(/\/+$/, ''), // 去掉尾斜杠
      apiKey,
      model,
      headers,
    });
  }

  return providers;
}

// ------------------------------------------------------------
// 3️⃣ 统一请求体（OpenAI‑ChatCompletions 兼容字段）
// ------------------------------------------------------------
function buildPayload(model: string, messages: APIMessage[], system: APIMessage) {
  return {
    model,
    messages: [system, ...messages],
    response_format: { type: 'json_object' }, // 强制 JSON 输出
    temperature: 1.0,
    stream: true,                               // 打开 SSE 流
    presence_penalty: 0.7,
    frequency_penalty: 0.4,
    max_tokens: 2000,
  };
}

// ------------------------------------------------------------
// 4️⃣ 单个服务商的流式请求（返回可阅读的 Uint8Array 流）
// ------------------------------------------------------------
async function requestStream(
  provider: Provider,
  payload: unknown,
  signal?: AbortSignal
): Promise<RaceResult> {
  const abortController = new AbortController();
  const combinedSignal = signal ?? abortController.signal;

  const endpoint = `${provider.baseUrl}/v1/chat/completions`;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: provider.headers,
    body: JSON.stringify(payload),
    signal: combinedSignal,
  });

  // 只要出现 200 且返回真正的 SSE 流才继续
  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => '（无可读错误信息）');
    throw new Error(`HTTP ${res.status} – ${body}`);
  }

  // 把 Web‑Stream → ReadableStream<Uint8Array>，保持 SSE 完整事件
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const outStream = new ReadableStream<Uint8Array>({
    start(controller) {
      const pump = async () => {
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) {
              controller.close();
              return;
            }

            // 文本解码后按 "\n\n" 切分 SSE 事件
            buffer += decoder.decode(value, { stream: true });
            let idx: number;
            while ((idx = buffer.indexOf('\n\n')) !== -1) {
              const chunk = buffer.slice(0, idx + 2);
              buffer = buffer.slice(idx + 2);
              controller.enqueue(new TextEncoder().encode(chunk));
            }
          }
        } catch (_err) {
          // 读取异常直接关闭流
          controller.close();
        }
      };

      // 立即开始推流
      pump();
    },
    cancel() {
      try {
        reader.releaseLock();
      } catch {}
    },
  });

  return { readableStream: outStream, abortController };
}

// ------------------------------------------------------------
// 5️⃣ 多服务商抢答：谁先返回真实 SSE 流就把谁透传
// ------------------------------------------------------------
async function raceProviders(
  providers: Provider[],
  payload: unknown,
  signal?: AbortSignal
): Promise<RaceResult> {
  const pending = providers.map(async (p) => {
    try {
      return await requestStream(p, payload, signal);
    } catch (_err) {
      // 单个供应商失败不抛错，继续等其它候选者
      return null;
    }
  });

  // 只要有一个成功就立刻返回
  for await (const result of async function* gen() {
    for (const p of pending) {
      const v = await p;
      if (v) yield v as RaceResult;
    }
  }()) {
    // 第一个成功的提供商：中止其余请求（已经在 requestStream 里自行 abort）
    return result;
  }

  // 全部失败时抛出一个聚合错误
  throw new Error('所有配置的服务商均无法返回可用流，请检查网络、密钥或模型名称是否匹配。');
}

// ------------------------------------------------------------
// 6️⃣ 主路由（POST /api/chat）
// ------------------------------------------------------------
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { messages, isFirstLoad } = body as {
      messages: APIMessage[];
      isFirstLoad?: boolean;
    };

    if (!Array.isArray(messages) || messages.length === 0) {
      return new Response(
        JSON.stringify({ error: '无效的消息格式' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // -------------------------------------------------
    // ① 系统提示词（你原有逻辑，仅把 role 改为 'system'）
    // -------------------------------------------------
    let systemMessage: APIMessage;

    if (isFirstLoad || (messages.length === 1 && messages[0].role === 'user')) {
      systemMessage = {
        role: 'system',
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
5. 要像真人朋友一样聊天，别太正式！`,
      };
    } else {
      systemMessage = {
        role: 'system',
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

记住：必须返回有效的 JSON 格式，options 必须是3个字符串的数组！`,
      };
    }

    // -------------------------------------------------
    // ② 读取服务商配置（1~4 组，空缺自动跳过）
    // -------------------------------------------------
    const providers = getProviders();
    if (providers.length === 0) {
      return new Response(
        JSON.stringify({
          error: '未配置任何服务商（请至少提供 BASE_URL_1/KEY_1/MODEL_1 等环境变量）',
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // -------------------------------------------------
    // ③ 构造请求体（这里统一使用第一个模型的名称，若要每家自行指定，可把 buildPayload 搬到 requestStream 里）
    // -------------------------------------------------
    const payload = buildPayload(providers[0].model, messages, systemMessage);

    // -------------------------------------------------
    // ④ 多服务商抢答，谁先返回真正的 SSE 流就立刻转发
    // -------------------------------------------------
    const { readableStream } = await raceProviders(providers, payload, req.signal);

    // -------------------------------------------------
    // ⑤ 前端透传（添加防止 Nginx 缓冲的 X‑Accel‑Buffering 头）
    // -------------------------------------------------
    return new Response(readableStream, {
      headers: {
        'Content-Type':        'text/event-stream',
        'Cache-Control':       'no-cache',
        'Connection':          'keep-alive',
        'X-Accel-Buffering':   'no',
      },
    });
  } catch (err: unknown) {
    // 只在必须时输出错误日志（防止泄漏密钥等敏感信息）
    console.error('路由内部错误:', err);

    return new Response(
      JSON.stringify({
        error: '服务器内部错误',
        message: err instanceof Error ? err.message : '未知错误',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
