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
  providerName: string;      // 新增：记录成功的服务商名称
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
    temperature: 1.3,
    stream: true,                               // 打开 SSE 流
    response_format: { type: "json_object" },   // ✅ 强制 JSON 输出模式
    presence_penalty: 0.7,
    frequency_penalty: 0.4,
    max_tokens: 32000,
  };
}

// ------------------------------------------------------------
// 4️⃣ 单个服务商的流式请求
// ------------------------------------------------------------
async function requestStream(
  provider: Provider,
  messages: APIMessage[],
  system: APIMessage,
  signal?: AbortSignal
): Promise<RaceResult> {
  const abortController = new AbortController();
  const combinedSignal = signal ?? abortController.signal;

  const payload = buildPayload(provider.model, messages, system);
  const endpoint = `${provider.baseUrl}/v1/chat/completions`;
  
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: provider.headers,
      body: JSON.stringify(payload),
      signal: combinedSignal,
    });

    if (!res.ok || !res.body) {
      const body = await res.text().catch(() => '（无可读错误信息）');
      throw new Error(`[${provider.name}] HTTP ${res.status} – ${body}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: false });
    let buffer = '';

    const outStream = new ReadableStream<Uint8Array>({
      start(controller) {
        const pump = async () => {
          try {
            while (true) {
              const { value, done } = await reader.read();
              if (done) {
                if (buffer.trim()) {
                  controller.enqueue(new TextEncoder().encode(buffer + '\n\n'));
                }
                controller.close();
                return;
              }

              buffer += decoder.decode(value, { stream: true });
              let idx: number;
              while ((idx = buffer.indexOf('\n\n')) !== -1) {
                const chunk = buffer.slice(0, idx + 2);
                buffer = buffer.slice(idx + 2);
                controller.enqueue(new TextEncoder().encode(chunk));
              }
            }
          } catch (err) {
            console.error(`[${provider.name}] 流读取错误:`, err);
            controller.close();
          }
        };

        pump();
      },
      cancel() {
        try {
          reader.releaseLock();
        } catch {}
      },
    });

    return { 
      readableStream: outStream, 
      abortController,
      providerName: provider.name 
    };
  } catch (err) {
    console.error(`[${provider.name}] 请求失败:`, err instanceof Error ? err.message : err);
    throw err;
  }
}

// ------------------------------------------------------------
// 5️⃣ 多服务商抢答（✅ 完美实现：立即取消其他请求）
// ------------------------------------------------------------
async function raceProviders(
  providers: Provider[],
  messages: APIMessage[],
  system: APIMessage,
  signal?: AbortSignal
): Promise<RaceResult> {
  console.log(`🏁 开始竞速，共 ${providers.length} 个服务商:`, providers.map(p => p.name).join(', '));

  // ✅ 定义结果类型
  type RaceOutcome = 
    | { ok: true; result: RaceResult; provider: Provider }
    | { ok: false; provider: Provider };

  // ✅ 保存每个服务商的 Promise
  const raceEntries = providers.map((provider) => ({
    provider,
    promise: requestStream(provider, messages, system, signal)
      .then((result): RaceOutcome => ({ ok: true, result, provider }))
      .catch((err): RaceOutcome => {
        console.warn(`[${provider.name}] 竞速失败:`, err instanceof Error ? err.message : err);
        return { ok: false, provider };
      })
  }));

  // ✅ 真正的竞速：找到第一个成功的立即返回
  const pending = raceEntries.map(entry => entry.promise);

  while (pending.length > 0) {
    const fastest = await Promise.race(pending);

    if (fastest.ok) {
      // ✅ 找到第一个成功的，立即返回
      console.log(`✅ [${fastest.result.providerName}] 竞速获胜！`);

      // ✅ 🔥 立即取消所有其他正在进行的请求
      for (const entry of raceEntries) {
        if (entry.provider.name !== fastest.provider.name) {
          entry.promise.then((result) => {
            if (result.ok) {
              try {
                console.log(`🛑 取消服务商 [${entry.provider.name}] 的请求`);
                result.result.abortController.abort();
              } catch (err) {
                console.warn(`[${entry.provider.name}] 取消时出错:`, err);
              }
            }
          }).catch(() => {
            // 已经失败的请求，忽略
          });
        }
      }

      return fastest.result;
    }

    // ✅ 修复：正确地从 pending 数组中移除已完成的 Promise
    const failedIndex = pending.findIndex(p => 
      raceEntries.some(entry => entry.promise === p)
    );
    if (failedIndex > -1) {
      pending.splice(failedIndex, 1);
    } else {
      pending.shift();
    }
  }

  // 所有服务商都失败了
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
    // ① 系统提示词（✅ 强化 JSON 格式要求）
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

⚠️ 【极其重要的输出格式要求】⚠️
你必须严格按照以下 JSON 格式输出，绝对不能有任何其他文本：

{"reply":"你的两句有趣问候语，使用丰富的emoji和口语风格","options":["🧁 话题1（8-15字，emoji开头）","🎮 话题2（8-15字，emoji开头）","🪐 话题3（8-15字，emoji开头）"]}

🚫 禁止事项：
- 禁止在 JSON 前后添加任何解释文字
- 禁止使用 markdown 代码块包裹 JSON
- 禁止输出 "好的，这是回复：" 等前缀
- 第一个字符必须是 {，最后一个字符必须是 }

✅ 正确示例：
{"reply":"哎呀呀！欢迎来到我的魔法聊天屋～🎄✨ 我可是世界上最会聊天又萌萌哒的助手呢！😄💖","options":["🧁 给我编一首甜甜圈口味的小诗吧","🎮 玩一次猜数字小游戏好不好","🪐 如果地球是颗糖果会怎么样捏"]}

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

⚠️ 【极其重要的输出格式要求】⚠️
你必须严格按照以下 JSON 格式输出，绝对不能有任何其他文本：

{"reply":"你的简短回复（1-3句话，带emoji和语气词）","options":["用户可能想说的话1（10-20字，第一人称）","用户可能想说的话2（10-20字，完全不同角度）","用户可能想说的话3（10-20字，轻松或有趣的方向）"]}

🚫 禁止事项：
- 禁止在 JSON 前后添加任何解释文字
- 禁止使用 markdown 代码块包裹 JSON
- 禁止输出 "好的，这是回复：" 等前缀
- 第一个字符必须是 {，最后一个字符必须是 }

【关键规则】
1. 选项是"用户可能说的话"，不是"AI建议的话题"
2. 用第一人称（我/我想/能不能）写选项
3. 选项要像用户会打的字一样自然
4. 绝对不能出现"选项1""选项2"等字样
5. options 数组必须包含恰好3个选项

✅ 正确示例：
用户说："最近好累啊"
返回：
{"reply":"哎呀呀！抱抱你！😢💕 工作太辛苦了吗？","options":["😮‍💨 工作压力太大了，都没时间休息","😊 其实也还好，就是想抱怨一下哈哈","✨ 别说这个啦，聊点开心的！"]}

记住：必须返回有效的 JSON 格式，options 必须是3个字符串的数组！`,
      };
    }

    // -------------------------------------------------
    // ② 🔥🔥🔥 关键修改：在最后一条用户消息后插入强力约束指令
    // -------------------------------------------------
    const augmentedMessages: APIMessage[] = [...messages];

    // 找到最后一条用户消息的索引
    const lastUserMessageIndex = augmentedMessages
      .map((msg, index) => (msg.role === 'user' ? index : -1))
      .filter(index => index !== -1)
      .pop();

    // 在最后一条用户消息后插入绝对强力的格式约束
    if (lastUserMessageIndex !== undefined && lastUserMessageIndex >= 0) {
      const formatConstraint: APIMessage = {
        role: 'user',
        content: `[🚨 绝对重要提醒 🚨]

你必须严格按照以下JSON格式回复，这是强制要求：

{"reply":"你的回复内容（1-3句话）","options":["选项1","选项2","选项3"]}

【严格规范】：
1. reply字段：简短有趣回复，包含emoji和语气词
2. options字段：必须是包含 exactly 3 个字符串的数组，不多不少
3. 每个选项长度10-20字，用第一人称（我/我想/能不能）
4. 第一个字符必须是 {，最后一个字符必须是 }
5. 绝对不要添加任何解释文字、markdown代码块或其他内容
6. 必须是有效的JSON格式，可以直接被 JSON.parse() 解析

🚫 错误示例：
❌ 好的，这是回复：{"reply":"...","options":[...]}
❌ \`\`\`json\n{"reply":"...","options":[...]}\n\`\`\`
❌ {"reply":"...","options":["选项1","选项2"]}  // 只有2个选项
❌ {"reply":"..."}  // 缺少options字段

✅ 正确示例：
{"reply":"哎呀呀！这个问题好有趣呢～😄✨","options":["我想深入了解一下这个话题","换个角度聊聊别的吧","给我讲个相关的小故事呗"]}

立即开始按格式回复，不要有任何其他输出！`,
      };

      // 在最后一条用户消息后插入约束指令
      augmentedMessages.splice(lastUserMessageIndex + 1, 0, formatConstraint);
    } else {
      // 如果没有找到用户消息（理论上不应该发生），就添加到末尾
      const formatConstraint: APIMessage = {
        role: 'user',
        content: `[🚨 格式约束 🚨] 必须严格按照JSON格式回复：{"reply":"...","options":["...","...","..."]}，options必须包含3个选项`,
      };
      augmentedMessages.push(formatConstraint);
    }

    // -------------------------------------------------
    // ③ 读取服务商配置
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

    console.log(`📋 已加载 ${providers.length} 个服务商配置:`, 
      providers.map(p => `${p.name}(${p.model})`).join(', ')
    );

    // -------------------------------------------------
    // ④ 多服务商抢答（使用增强后的消息数组）
    // -------------------------------------------------
    const { readableStream, providerName } = await raceProviders(
      providers, 
      augmentedMessages,      // ✅ 使用增强版消息数组
      systemMessage, 
      req.signal
    );

    // -------------------------------------------------
    // ⑤ 前端透传
    // -------------------------------------------------
    console.log(`🚀 开始流式传输 (${providerName})`);

    return new Response(readableStream, {
      headers: {
        'Content-Type':        'text/event-stream',
        'Cache-Control':       'no-cache',
        'Connection':          'keep-alive',
        'X-Accel-Buffering':   'no',
        'X-Provider-Used':     providerName,
      },
    });
  } catch (err: unknown) {
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
