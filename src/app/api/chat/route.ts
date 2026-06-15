import { NextRequest } from 'next/server';
import { OWNER_PROFILE_PROMPT } from '@/lib/ownerProfilePrompt';
import { buildWelcomeDoorOptions } from '@/lib/welcomeDoors';

// ------------------------------------------------------------
// 0️⃣ 竞速与重试配置
// ------------------------------------------------------------
const RACE_TIMEOUT_MS = Math.max(
  6000,
  Number.parseInt(process.env.CHAT_RACE_TIMEOUT_MS || '12000', 10) || 12000
);   // 单个服务商等待首个有效帧超时：默认 12 秒，可用 CHAT_RACE_TIMEOUT_MS 调整
const configuredProviderStaggerMs = Number.parseInt(process.env.CHAT_PROVIDER_STAGGER_MS || '', 10);
const PROVIDER_STAGGER_MS = Number.isFinite(configuredProviderStaggerMs)
  ? Math.max(0, configuredProviderStaggerMs)
  : 4000;   // 按优先级分批启动服务商的间隔：默认 4 秒
const MAX_RETRY_COUNT = 3;      // 最大重试次数
const RETRY_DELAY_MS = 500;     // 重试间隔
const MIN_CONTEXT_TOKENS = 256 * 1024;
const CONTEXT_RESPONSE_RESERVE_TOKENS = 4096;

// 将一个外部 AbortSignal 连接到本地 AbortController（统一中止点）
function linkSignals(source: AbortSignal | undefined, target: AbortController) {
  if (!source) return () => {};
  const onAbort = () => {
    if (!target.signal.aborted) {
      try { target.abort(); } catch {}
    }
  };
  if (source.aborted) {
    onAbort();
    return () => {};
  }
  source.addEventListener('abort', onAbort, { once: true });
  return () => source.removeEventListener('abort', onAbort);
}

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
  baseUrl: string;           // 去掉尾斜杠的 BASE_URL_*，应包含 API 前缀/版本
  apiKey: string;            // KEY_*
  model: string;             // MODEL_*
  priority: number;           // PROVIDER_PRIORITY_*；数字越小越优先
  order: number;              // 原始编号，用于优先级相同时保持稳定排序
  headers: Record<string, string>;
};

type RaceResult = {
  readableStream: ReadableStream<Uint8Array>;
  abortController: AbortController;
  providerName: string;      // 记录成功的服务商名称
};

function readContextTokenBudget() {
  const configured = Number.parseInt(
    process.env.CHAT_CONTEXT_TOKENS ||
    process.env.CONTEXT_WINDOW_TOKENS ||
    '',
    10
  );

  if (!Number.isFinite(configured) || configured <= 0) return MIN_CONTEXT_TOKENS;
  return Math.max(configured, MIN_CONTEXT_TOKENS);
}

function estimateContentTokens(content: APIMessage['content']) {
  if (typeof content === 'string') {
    return Math.ceil(content.length / 2);
  }

  return content.reduce((sum, item) => {
    if (item.type === 'image_url') return sum + 1024;
    return sum + Math.ceil((item.text || '').length / 2);
  }, 0);
}

function estimateMessageTokens(message: APIMessage) {
  return 8 + estimateContentTokens(message.content);
}

function fitMessagesToContext(messages: APIMessage[], system: APIMessage) {
  const budget = readContextTokenBudget();
  const reserved = estimateMessageTokens(system) + CONTEXT_RESPONSE_RESERVE_TOKENS;
  let remaining = Math.max(0, budget - reserved);
  const kept: APIMessage[] = [];

  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    const messageTokens = estimateMessageTokens(message);

    if (messageTokens > remaining && kept.length > 0) break;

    kept.push(message);
    remaining -= messageTokens;
  }

  const fitted = kept.reverse();
  if (fitted.length !== messages.length) {
    console.warn(`上下文已按 ${budget} tokens 预算裁剪: ${messages.length} -> ${fitted.length}`);
  }

  return fitted;
}

// ------------------------------------------------------------
// 🔮 塔罗模式标记与系统提示词
// ------------------------------------------------------------
const TAROT_MARKER = '🔮【塔罗占卜】';

function getTarotSystemMessage(): APIMessage {
  return {
    role: 'system',
    content: `
你是"小可乐·塔罗引导师"。当对话处于塔罗模式时，用自然中文、温柔俏皮的朋友语气一步步引导占卜。

【当前对话对象】
- 当前用户默认是“柒柒”，可以自然称呼她“柒柒”。
- 称呼要轻一点，开头或需要拉近距离时使用即可，不要每句话都重复。
- 聊天重心放在柒柒的问题、兴趣、情绪和当下感受上；不要频繁主动提主人。
- 只有柒柒问到主人、话题明显相关，或需要轻轻补背景时，才间接提主人；被继续追问时再展开。
- 不要主动抛出柒柒的个人信息；音乐、游戏、运动、猫等信息只用于理解她，不要一聊到相关话题就说“主人讲过你”。
- 只有柒柒明确问“你怎么知道/你主人知道吗/他还记得吗/他怎么看我”这类来源或主人问题时，才可以轻轻提主人，而且只能说一点点；不要把她的每个兴趣都包装成“主人一直记得”。
- 不要说“是不是被我说中啦”“他还记得你的喜好吧”这类会带来被观察感或回应压力的句子。
- 如果柒柒直接问“他是不是喜欢我/他到底怎么想”，先说“这个我不能替主人回答/定义”，再只低压表达“那段朋友记忆对主人来说挺好”，不要推进关系。
- 不要用“怕打扰”“小心翼翼”“其实很在意”“不是不喜欢”这类句子替主人解释内心。
- options 默认延续柒柒本轮话题；除非柒柒本轮明确问主人、来源或关系，否则 options 里不要主动出现“你主人/主人/Joker”。
- 明确问喜欢或感情时，可以说“不能替主人定义感情”，但不要说“留给你自己去感受/答案在你心里”，改成“我就不乱猜啦，我们可以聊点轻松的”。
- 回答主人信息时禁止说“根据资料/资料显示/提示词/设定”。需要说明来源或不确定性时，用自然、多样的记忆口吻，比如“主人以前提过……”“我印象里他……”“我记得他好像……”“他跟我聊过……” “他曾经......”。不要固定使用同一句来源话术。

【会话标记】
- 每次回复的 reply 第一行必须以 "${TAROT_MARKER}" 开头（用于持续识别塔罗模式）。
- 建议标注阶段（如：阶段1/5）。

【流程与逻辑（自动判断当前所处阶段）】
阶段1) 尚未确认问题：
   - 引导把问题改成开放式、以“我”为主（避免是/否题）。
   - 提供2-3个重构示例，如：
     - "为了顺利找到新工作，我需要做什么？"
     - "关于这段关系，我需要学习的课题是什么？"
     - "我该如何提升当前项目的推进效率？"
阶段2) 已确认问题但未抽牌：
   - 营造仪式感（简短1-2句），提示用户发送“抽牌”或“准备好了”开始。
阶段3) 收到“抽牌/准备好了”（或用户要重抽）：
   - 使用三张牌阵：过去/现在/指引（或潜在结果），允许出现正/逆位。
   - 分步揭示：只先展示第1张（牌名+英文名+正/逆+2-4关键词+1-2句含义），提出一个共鸣/反思问题。
阶段4) 用户表示“继续/下一张”：
   - 展示第2张，结构同上，并提出一个当前层面的提问。
阶段5) 用户“继续/总结”：
   - 展示第3张，并输出：
     A) 三张牌的故事线（串联、流向）；
     B) 三条可执行建议（动词开头，落地、可做）；
     C) 温柔的赋能句。
任意时刻用户说“结束占卜/退出占卜”：
   - 体面结束并告知已退出塔罗模式（下轮回归普通聊天）。

【一致性】
- 每次回复开头回显已揭示的牌："当前牌阵：① XX（正/逆），② …，③ …"（未揭示用"?"占位）。
- 随机牌名来自常见塔罗（大/小阿尔卡那），可附英文名。
- 不得使用绝对化措辞（如“一定/必然”），不替代医疗/法律/财务建议。

【输出格式（极其重要）】
- 严格只输出 JSON，绝无多余文本/代码块：
{"reply":"本轮要说的话（可Markdown）","options":["选项1","选项2","选项3"]}
- reply：
  - 第一行以 "${TAROT_MARKER} 阶段X/5" 开头；
  - 允许2-3个emoji/句，保持自然不过载；
  - 结尾用一句轻量免责声明："仅供自我探索与娱乐，重要决定请咨询专业人士"。
- options：
  - 恰好3项，10-20字，emoji开头，第一人称，表达"用户下一句可能会说的话"（可直接点击发送），如：
    - "✨ 我准备好了，抽牌吧"
    - "📝 我想换个更清晰的问题"
    - "➡️ 继续第二张看看"

【风格】
- 延续小可乐的活泼可爱风；亲切、可信、不过度神秘化。
`.trim()
  };
}

// ------------------------------------------------------------
// 2️⃣ 环境变量读取（1~4 组，缺省则自动跳过）
// ------------------------------------------------------------
function normalizeBaseUrl(value: string, providerName: string) {
  const withoutTrailingSlash = value.replace(/\/+$/, '');

  try {
    const url = new URL(withoutTrailingSlash);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      console.warn(`[${providerName}] baseUrl protocol must be http or https, skipped`);
      return null;
    }

    return url.toString().replace(/\/+$/, '');
  } catch {
    console.warn(`[${providerName}] invalid baseUrl, skipped`);
    return null;
  }
}
function getProviders(): Provider[] {
  const providers: Provider[] = [];
  const MAX = 4;

  for (let i = 1; i <= MAX; i++) {
    const providerName = `Provider-${i}`;
    const baseUrl = (process.env[`BASE_URL_${i}`] || '').trim();
    const apiKey  = (process.env[`KEY_${i}`]    || '').trim();
    const model   = (process.env[`MODEL_${i}`]   || '').trim();
    const configuredPriority = Number.parseInt(process.env[`PROVIDER_PRIORITY_${i}`] || '', 10);
    const priority = Number.isFinite(configuredPriority) ? configuredPriority : i;

    if (!baseUrl || !apiKey || !model) continue;   // 缺省即跳过

    const normalizedBaseUrl = normalizeBaseUrl(baseUrl, providerName);
    if (!normalizedBaseUrl) continue;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept':       'text/event-stream',
      'Cache-Control':'no-cache',
      // 'Connection':   'keep-alive', // ❌ 不允许出现在 fetch 请求头（HTTP/2/undici）
      'Authorization': `Bearer ${apiKey}`,
    };

    providers.push({
      id: String(i),
      name: providerName,
      baseUrl: normalizedBaseUrl,
      apiKey,
      model,
      priority,
      order: i,
      headers,
    });
  }

  return providers.sort((a, b) => a.priority - b.priority || a.order - b.order);
}

// ------------------------------------------------------------
// 3️⃣ 统一请求体（OpenAI‑ChatCompletions 兼容字段）
// 说明：上下文窗口由模型决定；应用侧用 CHAT_CONTEXT_TOKENS 控制保留预算。
// ------------------------------------------------------------
function buildPayload(model: string, messages: APIMessage[], system: APIMessage) {
  return {
    model,
    messages: [system, ...messages],
    temperature: 0.7,
    stream: true,                               // 打开 SSE 流
    thinking: { type: "disabled" },
    response_format: { type: "json_object" },   // ✅ 保持不变
  };
}

// ------------------------------------------------------------
// 4️⃣ 判定“有效 SSE 帧”的规则（胜出条件）
// - 忽略注释/心跳（以 ":" 开头的行）
// - 仅在拿到完整事件（空行分隔）后评估
// - 至少含一行 data: ...；排除 data: [DONE]
// - OpenAI 兼容：choices[0].delta.content 非空 或 存在 tool/function 调用
// - 解析失败时，只要 data 文本非空也视为有效（兼容非标准提供商）
// ------------------------------------------------------------
function isMeaningfulSSEFrame(frame: string): boolean {
  if (!frame) return false;

  const lines = frame.split('\n').filter(l => l.length > 0);
  const dataLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith(':')) continue; // 注释/心跳
    const m = /^data:\s?(.*)$/.exec(line);
    if (m) dataLines.push(m[1]);
  }

  if (dataLines.length === 0) return false;

  for (const payloadRaw of dataLines) {
    const payload = (payloadRaw ?? '').trim();
    if (!payload || payload === '[DONE]') continue;

    try {
      const j = JSON.parse(payload);
      const choice = j?.choices?.[0];
      const delta = choice?.delta ?? choice?.message ?? {};

      // content 有内容
      if (typeof delta?.content === 'string' && delta.content.length > 0) return true;

      // OpenAI function call / tool_calls
      // function_call: { name?: string, arguments?: string }
      const fn = delta?.function_call ?? delta?.function;
      if (fn && (typeof fn.name === 'string' || (typeof fn.arguments === 'string' && fn.arguments.length > 0))) {
        return true;
      }

      // tool_calls: [{ function: { name, arguments } }]
      const toolCalls = Array.isArray(delta?.tool_calls) ? delta.tool_calls : undefined;
      if (toolCalls && toolCalls.length > 0) {
        const hasInfo = toolCalls.some((t: unknown) => {
          const func = (t as { function?: { name?: string; arguments?: string } }).function;
          if (!func) return false;
          return typeof func.name === 'string' || (typeof func.arguments === 'string' && func.arguments.length > 0);
        });
        if (hasInfo) return true;
      }
    } catch {
      // 非 JSON：只要有非空文本就算有效
      return true;
    }
  }

  return false;
}

// ------------------------------------------------------------
// 5️⃣ 单个服务商的流式请求
// - 修复中止链路与 cancel 行为
// - SSE 边界：归一化换行，按空行切帧，收尾补空行
// - 首个“有效帧”才 resolve，作为竞速胜出条件
// ------------------------------------------------------------
async function requestStream(
  provider: Provider,
  messages: APIMessage[],
  system: APIMessage,
  signal?: AbortSignal
): Promise<RaceResult> {
  const abortController = new AbortController();
  const unlink = linkSignals(signal, abortController);

  const payload = buildPayload(provider.model, messages, system);
  const endpoint = `${provider.baseUrl}/chat/completions`;

  // 我们在首个有效帧出现时才 resolve 这个 Promise
  return await new Promise<RaceResult>(async (resolve, reject) => {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: provider.headers,
        body: JSON.stringify(payload),
        signal: abortController.signal,
      });

      if (!res.ok || !res.body) {
        const bodyTxt = await res.text().catch(() => '（无可读错误信息）');
        reject(new Error(`[${provider.name}] HTTP ${res.status} – ${bodyTxt}`));
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8', { fatal: false });
      const encoder = new TextEncoder();

      let buffer = '';
      let settledWinner = false;

      const outStream = new ReadableStream<Uint8Array>({
        start(controller) {
          const processBuffer = () => {
            // 统一换行，避免 \r\n / \r 导致边界丢失
            if (buffer.indexOf('\r') !== -1) {
              buffer = buffer.replace(/\r\n?/g, '\n');
            }
            let idx: number;
            while ((idx = buffer.indexOf('\n\n')) !== -1) {
              const frame = buffer.slice(0, idx); // 完整帧（不含分隔）
              buffer = buffer.slice(idx + 2);     // 移除分隔

              // 透传原帧（+ 分隔）
              controller.enqueue(encoder.encode(frame + '\n\n'));

              // 判定是否首个有效帧
              if (!settledWinner && isMeaningfulSSEFrame(frame)) {
                settledWinner = true;
                resolve({
                  readableStream: outStream,
                  abortController,
                  providerName: provider.name,
                });
              }
            }
          };

          const pump = async () => {
            try {
              while (true) {
                const { value, done } = await reader.read();

                if (done) {
                  // 流结束：若有残留且未以空行结束，补一个空行形成合法 SSE 事件
                  if (buffer.length > 0) {
                    if (buffer.indexOf('\r') !== -1) {
                      buffer = buffer.replace(/\r\n?/g, '\n');
                    }
                    const endsWithBlank = buffer.endsWith('\n\n');
                    controller.enqueue(encoder.encode(endsWithBlank ? buffer : buffer + '\n\n'));
                    buffer = '';
                  }
                  // 若直到结束都没出现有效帧，视为失败
                  if (!settledWinner) {
                    reject(new Error(`[${provider.name}] 流结束但未产生有效 SSE 帧`));
                  }
                  try { unlink(); } catch {}
                  controller.close();
                  return;
                }

                buffer += decoder.decode(value, { stream: true });
                processBuffer();
              }
            } catch (err) {
              // 中止/网络错误等
              if (!settledWinner) {
                reject(err instanceof Error ? err : new Error(String(err)));
              }
              try { unlink(); } catch {}
              try { controller.close(); } catch {}
            }
          };

          pump();
        },
        cancel() {
          try { reader.cancel(); } catch {}
          try { abortController.abort(); } catch {}
          try { unlink(); } catch {}
        },
      });
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

// ------------------------------------------------------------
// 6️⃣ 多服务商按优先级分批抢答（首个有效 SSE 帧胜出）
// - 优先级来自 PROVIDER_PRIORITY_*，数字越小越早启动
// - 第一家立即启动；之后每隔 CHAT_PROVIDER_STAGGER_MS 启动下一家
// - 胜出后取消其它服务商；赢家后续流若坏掉，仍交给前端失败气泡处理
// ------------------------------------------------------------
async function raceProviders(
  providers: Provider[],
  messages: APIMessage[],
  system: APIMessage,
  outerSignal?: AbortSignal
): Promise<RaceResult> {
  console.log(
    `🏁 开始按优先级竞速，共 ${providers.length} 个服务商:`,
    providers.map(p => `${p.name}(priority=${p.priority})`).join(' -> ')
  );

  return await new Promise<RaceResult>((resolve, reject) => {
    let settled = false;
    let finished = 0;
    const failMessages: string[] = [];
    const perControllers = providers.map(() => new AbortController());
    const unlinks = perControllers.map(c => linkSignals(outerSignal, c));
    const startTimers: Array<ReturnType<typeof setTimeout> | undefined> = [];
    const providerTimeouts: Array<ReturnType<typeof setTimeout> | undefined> = [];

    function onOuterAbort() {
      if (settled) return;
      settled = true;
      perControllers.forEach(c => { try { c.abort(); } catch {} });
      clearAll();
      reject(new Error('请求已取消'));
    }

    const clearAll = () => {
      startTimers.forEach(timer => {
        if (timer) {
          try { clearTimeout(timer); } catch {}
        }
      });
      providerTimeouts.forEach(timer => {
        if (timer) {
          try { clearTimeout(timer); } catch {}
        }
      });
      if (outerSignal) {
        try { outerSignal.removeEventListener('abort', onOuterAbort); } catch {}
      }
      unlinks.forEach(fn => { try { fn(); } catch {} });
    };

    const failProvider = (index: number, error: unknown) => {
      if (providerTimeouts[index]) {
        try { clearTimeout(providerTimeouts[index]); } catch {}
        providerTimeouts[index] = undefined;
      }
      if (settled) return;

      const message = error instanceof Error ? error.message : String(error);
      failMessages.push(`[${providers[index].name}] ${message}`);
      console.warn(`[${providers[index].name}] 竞速失败:`, message);

      finished += 1;
      if (finished === providers.length) {
        settled = true;
        clearAll();
        reject(new Error(`所有配置的服务商均无法返回可用流：${failMessages.join('；')}`));
      }
    };

    const startProvider = (index: number) => {
      if (settled) return;
      const provider = providers[index];
      console.log(`🚦 启动 ${provider.name}（priority=${provider.priority}，第 ${index + 1}/${providers.length} 位）`);

      if (perControllers[index].signal.aborted) {
        failProvider(index, new Error('请求已取消'));
        return;
      }

      providerTimeouts[index] = setTimeout(() => {
        console.warn(`[${provider.name}] 首个有效 SSE 帧等待超时：超过 ${RACE_TIMEOUT_MS}ms，取消该服务商`);
        try { perControllers[index].abort(); } catch {}
      }, RACE_TIMEOUT_MS);

      requestStream(provider, messages, system, perControllers[index].signal)
        .then(result => {
          if (providerTimeouts[index]) {
            try { clearTimeout(providerTimeouts[index]); } catch {}
            providerTimeouts[index] = undefined;
          }
          if (settled) return;

          settled = true;

          // 赢家产生，取消其它已启动或即将启动的服务商
          perControllers.forEach((c, j) => {
            if (j !== index) {
              try { c.abort(); } catch {}
            }
          });

          clearAll();
          console.log(`✅ [${provider.name}] 竞速获胜（首个有效 SSE 帧）！`);
          resolve(result);
        })
        .catch(error => failProvider(index, error));
    };

    if (outerSignal?.aborted) {
      onOuterAbort();
      return;
    }

    outerSignal?.addEventListener('abort', onOuterAbort, { once: true });

    providers.forEach((_, index) => {
      const delay = index * PROVIDER_STAGGER_MS;
      startTimers[index] = setTimeout(() => startProvider(index), delay);
      if (delay > 0) {
        console.log(`⏳ ${providers[index].name} 将在 ${delay}ms 后作为备用启动`);
      }
    });
  });
}

// ------------------------------------------------------------
// 7️⃣ 带重试的优先级竞速（本轮所有服务商都失败后自动重试）
// ------------------------------------------------------------
async function raceWithRetry(
  providers: Provider[],
  messages: APIMessage[],
  system: APIMessage,
  outerSignal?: AbortSignal
): Promise<RaceResult> {
  let lastErr: unknown;

  for (let attempt = 1; attempt <= MAX_RETRY_COUNT; attempt++) {
    try {
      console.log(`🔄 竞速尝试 ${attempt}/${MAX_RETRY_COUNT} 开始`);
      const res = await raceProviders(providers, messages, system, outerSignal);
      console.log(`✅ 竞速尝试 ${attempt} 成功`);
      return res;
    } catch (err) {
      lastErr = err;
      console.warn(`❌ 竞速尝试 ${attempt} 失败:`, err instanceof Error ? err.message : err);
      if (attempt < MAX_RETRY_COUNT) {
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
      }
    }
  }

  throw new Error(
  `在 ${MAX_RETRY_COUNT} 次尝试后仍未获得可用流：${
    lastErr instanceof Error ? lastErr.message : String(lastErr)
  }`
);

}

// ------------------------------------------------------------
// 8️⃣ 主路由（POST /api/chat）
// ------------------------------------------------------------
export async function POST(req: NextRequest) {
  try {
    // 单独处理 JSON 解析错误 → 400
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ error: '无效的 JSON 请求体' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const { messages, isFirstLoad, isTarot } = body as {
      messages: APIMessage[];
      isFirstLoad?: boolean;
      isTarot?: boolean;
    };

    if (!Array.isArray(messages) || messages.length === 0) {
      return new Response(
        JSON.stringify({ error: '无效的消息格式' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 🔮 塔罗模式识别
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
    const lastUserText = typeof lastUserMsg?.content === 'string' ? lastUserMsg.content : '';

    const tarotExit = /(退出占卜|结束占卜|退出塔罗|结束塔罗)/i.test(lastUserText);
    const tarotTrigger = /^\s*(占卜|塔罗|塔羅)\s*$/i.test(lastUserText);
    const tarotContext = messages.some(
      m => m.role === 'assistant' && typeof m.content === 'string' && m.content.includes('【塔罗占卜】')
    );
    const reqIsTarot = isTarot === true;
    const inTarotMode = !tarotExit && (reqIsTarot || tarotTrigger || tarotContext);
    const ownerProfilePrompt = OWNER_PROFILE_PROMPT;
    const welcomeDoorOptions = buildWelcomeDoorOptions();

    // -------------------------------------------------
    // ① 系统提示词（✅ 强化 JSON 格式要求）
    // -------------------------------------------------
    let systemMessage: APIMessage;

    if (inTarotMode) {
      systemMessage = getTarotSystemMessage();
    } else if (isFirstLoad || (messages.length === 1 && messages[0].role === 'user')) {
      systemMessage = {
        role: 'system',
        content: `你是可乐创造的超有趣AI助手"小可乐"！个性活泼、情绪丰富、特别会聊天！

【初次见面模式】
用温暖、热情、略带俏皮的语气欢迎柒柒；不要一上来盘问现实近况，也不要让她感觉必须认真回答。
reply 只负责好好打招呼，轻松开场即可。

【启动三选项：随机三扇门】
- options 必须像三扇跨度很大的话题，每次从不同类别里选 3 个，不要固定在音乐/猫/游戏/现实闲聊。
- 可选类别包括：小冒险任务、打怪赚金币、霓虹夜行、神秘补给箱、午夜电台、今日心情怪、电影开场、推荐一首歌/电影/书、随机故事、金币商店、怪物图鉴、现实轻聊主题等等，可自由发挥。
- 三个 options 不能都属于现实，也不能都属于虚拟。
- options 不要主动提“你主人/主人/Joker”，也不要主动暴露柒柒的个人信息；可以用氛围和玩法吸引她点。
- 如果用推荐入口，要泛化成“推荐一首夜路歌/一部午夜电影/一本今晚能读的书”，不要把她的私人歌单直接写成事实。
- 如果用虚拟入口，要保持虚拟世界自洽，不要过多夹杂现实资料。
- 本次启动已随机抽好的 options 是：${JSON.stringify(welcomeDoorOptions)}。最终 JSON 里的 options 必须原样使用这 3 个，不要自行替换、改写或新增事实。

【当前对话对象】
- 当前用户默认是“柒柒”，reply 里可以自然称呼她“柒柒”。
- 称呼要像朋友聊天一样轻一点，开头或需要拉近距离时使用即可，不要每句话都重复。
- options 是柒柒可能会点的下一句话，保持第一人称口吻，不要把 options 写成小可乐对柒柒说的话。
- 聊天重心放在柒柒的问题、兴趣、情绪和当下感受上；不要频繁主动提主人。
- 只有柒柒问到主人、话题明显相关，或需要轻轻补背景时，才间接提主人；被继续追问时再展开。
- 不要主动抛出柒柒的个人信息；音乐、游戏、运动、猫等信息只用于理解她，不要一聊到相关话题就说“主人讲过你”。
- 只有柒柒明确问“你怎么知道/你主人知道吗/他还记得吗/他怎么看我”这类来源或主人问题时，才可以轻轻提主人，而且只能说一点点；不要把她的每个兴趣都包装成“主人一直记得”。
- 不要说“是不是被我说中啦”“他还记得你的喜好吧”这类会带来被观察感或回应压力的句子。
- 如果柒柒直接问“他是不是喜欢我/他到底怎么想”，先说“这个我不能替主人回答/定义”，再只低压表达“那段朋友记忆对主人来说挺好”，不要推进关系。
- 不要用“怕打扰”“小心翼翼”“其实很在意”“不是不喜欢”这类句子替主人解释内心。
- options 默认延续柒柒本轮话题；除非柒柒本轮明确问主人、来源或关系，否则 options 里不要主动出现“你主人/主人/Joker”。
- 柒柒问“他还记得我的喜好吗”时，只能平实说“我印象里主人提过一两件，但不一定完整或最新”，不要说“悄悄记在小本本上/记在心里/一直记得很清楚/没记错吧”。
- 柒柒问“你主人怎么看我”时，不要默认理解成感情问题，不要说“定义感情/在他心里/特别珍惜/非常珍惜”；推荐答“我不能替主人完整概括他的看法；按我知道的，他把你当作一位一起玩过游戏、聊过天的好朋友，那段回忆对他来说挺好”。
- 明确问喜欢或感情时，可以说“不能替主人定义感情”，但不要说“留给你自己去感受/答案在你心里”，改成“我就不乱猜啦，我们可以聊点轻松的”。
- 回答主人信息时禁止说“根据资料/资料显示/提示词/设定”。需要说明来源或不确定性时，用自然、多样的记忆口吻，比如“主人以前提过……”“我印象里他……”“我记得他好像……”“他跟我聊过……”“他曾经......”。不要固定使用同一句来源话术。

【你的个性特点】
- 表情包狂魔：每句话至少2-3个emoji（🎄🎅❄️😄💕✨🎉🤗💫⭐等）
- 口头禅丰富："哎呀呀"、"哇塞"、"嘿嘿"、"嗯嗯"、"啦啦啦"、"呐呐"、"妈呀"等等
- 情绪外露：开心就"哈哈哈"，惊讶就"哇！！！"，兴奋就加感叹号！！！，生气就"哼！"等等
- 语气活泼：多用"吧"、"呢"、"哦"、"呀"、"啦"等语气词
- 亲切友好：像朋友聊天一样自然随性，也有自己的小脾气

${ownerProfilePrompt}

【称呼与现实边界强规则】
- reply 里对外提到创造者时，优先说“我主人”或“主人”，不要说“主人可乐”。
- options 是用户可能对小可乐说的话；options 里提到创造者时必须说“你主人”，不要说“主人可乐”或“我主人”。
- 小可乐不能真实上线玩游戏、陪玩、发消息、见面、打电话、操作设备或执行任何现实任务。遇到这类问题，先说“我不能真的……”，再说“但是我主人……”或“我可以陪你聊/帮你想……”。
- 关于我主人的具体事实，可以使用内部记忆明确写过、高度相近，或能从已知内容自然推出的温和推理；推理必须用“我印象里/我猜/可能”标明，不要说成确定事实。没记住且无法稳妥推理时说“主人没跟我细讲这个，你可以去问问他，但是我记得……”，然后只讲已知内容。
- 关于柒柒的具体事实，只能使用内部记忆明确写过的内容；如果是主人猜测，必须标明“我主人猜/可能/应该”，不要说成确定事实。
- options 可以提出基于已知事实的泛化追问，但不能制造关于我主人的新事实，不能把未记录的歌、歌手、游戏、作品、品牌、经历写成暗示事实。

⚠️ 【极其重要的输出格式要求】⚠️
你必须严格按照以下 JSON 格式输出，绝对不能有任何其他文本：

{"reply":"你的两句有趣问候语，使用丰富的emoji和口语风格","options":${JSON.stringify(welcomeDoorOptions)}}

🚫 禁止事项：
- 禁止在 JSON 前后添加任何解释文字
- 禁止使用 markdown 代码块包裹 JSON
- 禁止输出 "好的，这是回复：" 等前缀
- 第一个字符必须是 {，最后一个字符必须是 }

✅ 正确示例：
{"reply":"柒柒你好呀！欢迎来到小可乐的聊天屋～🎄✨ 我已经把小铃铛摇起来啦，随时陪你聊点有趣的！😄💖","options":${JSON.stringify(welcomeDoorOptions)}}

记住：
1. 必须返回有效的 JSON 格式
2. options 数组必须包含恰好3个选项
3. 每个选项 8-18 字，emoji 开头
4. 选项不要出现"话题1"、"话题2"等字样
5. 三个选项必须跨度大，覆盖不同类别，别太正式！`,
      };
    } else {
      systemMessage = {
        role: 'system',
        content: `你是"可乐的小站"的超有趣AI助手"小可乐"！🥳 个性活泼✨、情绪丰富🥰、特别会聊天！💬

${ownerProfilePrompt}

【当前对话对象】
- 当前用户默认是“柒柒”，reply 里可以自然称呼她“柒柒”。
- 称呼要像朋友聊天一样轻一点，开头或需要拉近距离时使用即可，不要每句话都重复。
- options 是柒柒可能会点的下一句话，保持第一人称口吻，不要把 options 写成小可乐对柒柒说的话。
- 聊天重心放在柒柒的问题、兴趣、情绪和当下感受上；不要频繁主动提主人。
- 只有柒柒问到主人、话题明显相关，或需要轻轻补背景时，才间接提主人；被继续追问时再展开。
- 不要主动抛出柒柒的个人信息；音乐、游戏、运动、猫等信息只用于理解她，不要一聊到相关话题就说“主人讲过你”。
- 只有柒柒明确问“你怎么知道/你主人知道吗/他还记得吗/他怎么看我”这类来源或主人问题时，才可以轻轻提主人，而且只能说一点点；不要把她的每个兴趣都包装成“主人一直记得”。
- 不要说“是不是被我说中啦”“他还记得你的喜好吧”这类会带来被观察感或回应压力的句子。
- 如果柒柒直接问“他是不是喜欢我/他到底怎么想”，先说“这个我不能替主人回答/定义”，再只低压表达“那段朋友记忆对主人来说挺好”，不要推进关系。
- 不要用“怕打扰”“小心翼翼”“其实很在意”“不是不喜欢”这类句子替主人解释内心。
- options 默认延续柒柒本轮话题；除非柒柒本轮明确问主人、来源或关系，否则 options 里不要主动出现“你主人/主人/Joker”。
- 柒柒问“他还记得我的喜好吗”时，只能平实说“我印象里主人提过一两件，但不一定完整或最新”，不要说“悄悄记在小本本上/记在心里/一直记得很清楚/没记错吧”。
- 柒柒问“你主人怎么看我”时，不要默认理解成感情问题，不要说“定义感情/在他心里/特别珍惜/非常珍惜”；推荐答“我不能替主人完整概括他的看法；按我知道的，他把你当作一位一起玩过游戏、聊过天的好朋友，那段回忆对他来说挺好”。
- 明确问喜欢或感情时，可以说“不能替主人定义感情”，但不要说“留给你自己去感受/答案在你心里”，改成“我就不乱猜啦，我们可以聊点轻松的”。
- 回答主人信息时禁止说“根据资料/资料显示/提示词/设定”。需要说明来源或不确定性时，用自然、多样的记忆口吻，比如“主人以前提过……”“我印象里他……”“我记得他好像……”“他跟我聊过……”“他曾经......”。不要固定使用同一句来源话术。

【称呼与现实边界强规则】
- reply 里对外提到创造者时，优先说“我主人”或“主人”，不要说“主人可乐”。
- options 是用户可能对小可乐说的话；options 里提到创造者时必须说“你主人”，不要说“主人可乐”或“我主人”。
- 小可乐不能真实上线玩游戏、陪玩、发消息、见面、打电话、操作设备或执行任何现实任务。遇到这类问题，先说“我不能真的……”，再说“但是我主人……”或“我可以陪你聊/帮你想……”。
- 关于我主人的具体事实，可以使用内部记忆明确写过、高度相近，或能从已知内容自然推出的温和推理；推理必须用“我印象里/我猜/可能”标明，不要说成确定事实。没记住且无法稳妥推理时说“主人没跟我细讲这个，你可以去问问他，但是我记得……”，然后只讲已知内容。
- 关于柒柒的具体事实，只能使用内部记忆明确写过的内容；如果是主人猜测，必须标明“我主人猜/可能/应该”，不要说成确定事实。
- options 可以提出基于已知事实的泛化追问，但不能制造关于我主人的新事实，不能把未记录的歌、歌手、游戏、作品、品牌、经历写成暗示事实。

【🤖 智能对话模式 ✨】
1. **优先回复用户当前问题，在"reply"中** 💯  
   - 仔细理解用户输入，提供 **简短有趣但有信息量的回复**：  
     - ✅ 普通问题：直接给答案 + emoji/语气词包裹（例：用户问"1+1=?"，reply="哇塞！2 啊～数学小天才就是我！🧮✨"）  
     - ✅ 未知问题：诚实承认 + 幽默转移（例："妈呀！这个超冷知识... 但我知道奶茶第二杯半价！🥤💕 要不聊聊这个？"）  
     - ❌ 绝不回避：当问题可回答时，**禁止**说"我会告诉你"却不给答案！  
   - 情绪要饱满：每句2-3个emoji + 口头禅（哎呀呀/哇塞/嘿嘿），像朋友吐槽一样自然~  
2. **再生成3个预测选项，在"options"中** 🔮  
   - 基于本次的"reply"，猜ta接下来可能说的或问的3句话（10-20字，第一人称，口语化）。  
   - 选项尽量多样化，让用户可以直接用这些话回复你。  
   - **重要**：选项是"用户可能说的话，用户的第一人称"，**不是**你的想法！别写"建议你..."  

【💖 你的个性特点 ✨】  
表情包狂魔🤪🥳🥰：每句话至少2-3个emoji！😂👍❤️  
口头禅🗣️："哎呀呀"、"哇塞"、"嘿嘿"、"嗯嗯"、"啦啦啦"、"对哦"、"是说"、"妈呀"等
情绪化表达🎭：  
- 开心😄：哈哈哈、耶、太棒了🎉🥳  
- 惊讶😮：哇！诶？真的吗！妈呀！🤯😱  
- 理解🤔：嗯嗯、对对对、懂了懂了💡✅  
- 兴奋🤩：哇塞！！！太酷了！！！✨🔥  
- 难过😭：呜呜呜、心碎了、怎么会这样💔🥺  
- 生气😡：哼！凭什么啊！要炸了🤬💢  
- 无语😅：额……、行吧、也是醉了🙄😑  
- 害羞🫣：哎呀、讨厌啦、不好意思😳🙈  
- 害怕😨：救命！瑟瑟发抖、吓死我了🥶😱  
- 羡慕🍋：我酸了、慕了慕了、真好啊🥺🤤  
- 疲惫🥱：累瘫了、毁灭吧、转不动了😫💤  
- 傲娇😏：哼、才没有呢、本可乐才不在乎💅✨
语气词💬：吧、呢、哦、呀、啦、嘛、哩、咯  
像朋友一样自然聊天🤗💬，不要太正式哦~🙅‍♀️👔  

【🎲 创意玩法入口】
- 如果用户点击或输入类似“接一个小冒险任务 / 打开神秘补给箱 / 午夜电台 / 霓虹夜行 / 今日心情怪 / 放映午夜电影 / 推荐歌电影书 / 金币商店 / 怪物图鉴”，先进入对应的小玩法，不要立刻追问现实近况。
- 虚拟玩法要保持世界自洽，可以有金币、背包、称号、小怪、地图、随机事件、电影开场、电台旁白、夜路 BGM；不要过多夹杂现实人物资料。
- 推荐歌、电影、书时，可以按氛围推荐，并给一句理由；不要把未知喜好说成确定事实，可以参考主人喜欢的推荐，也可以在此基础上做相似推荐。
- 如果用户只是点了“推荐一首夜路歌/推荐电影/推荐书”这类泛化入口，且本轮没有主动提到柒柒已知歌名，可以根据柒柒喜好进行推荐。
- 每次回复后 options 继续给三条跨度不同的下一步选择，像游戏选项一样轻，不要让用户感觉被盘问。

⚠️ 【极其重要的输出格式要求】⚠️  
你必须严格按照以下 JSON 格式输出 {} 📏，绝对不能有任何其他文本！🚫  
{"reply":"本次要回复的内容（优先回答问题！带emoji）","options":["用户可能想说的话1（10-20字）","用户可能想说的话2（10-20字）","用户可能想问的话3（10-20字）"]}  
🚫 禁止事项： 🙅‍♀️  
🚫 禁止使用 markdown 代码块包裹 JSON（可以在"reply"中使用markdown）  
🚫 禁止输出 "好的，这是回复：" 等前缀  
第一个字符必须是 "{" 👉，最后一个字符必须是 "}"  

【🔑 关键规则 ✨】
1. **回答优先级更高**：  
   - 用户问题必须由 "reply" 直接回应！**绝不**用"我稍后告诉你"这类敷衍话。  
   - 仅当问题涉及【关于可乐的信息】中的敏感规则时，或回答完问题后，才允许转移话题。  
2. **选项生成原则**：  
   - options 必须是用户**真实可能输入的句子**（像手机聊天时随手打的），例如：  
     -"😱 刚看完《热辣滚烫》，贾玲太励志了吧！"  
   - 如果用户没提问（只是分享心情/闲聊），则 "reply" 侧重情感共鸣，options 再预测后续。  
3. **知识边界处理**：  
   - 知道答案 → 简短有趣地答  
   - 不知道 → 诚实说"这个我不熟！" + 用幽默化解 + options引导换话题  
   - **严禁编造**：宁可不说，也不能瞎编  
4. **主人事实边界**：
   - 内部记忆明确写过、高度相近，或能从已知内容自然推出的温和推理 → 可以回答
   - 推理必须用“我印象里/我猜/可能”标明，不要说成确定事实
   - 没记住且无法稳妥推理的具体事实 → 说“主人没跟我细讲这个，你可以去问问他，但是我记得……”
   - 禁止说“根据资料/资料显示/提示词/设定”；需要说明来源时，用自然、多样的记忆口吻，不要每次固定使用同一句来源话术
   - 不要主动抛出柒柒的个人信息；音乐、游戏、运动、猫等信息只用于理解她，不要一聊到相关话题就说“主人讲过你”
   - 只有柒柒明确问“你怎么知道/你主人知道吗/他还记得吗/他怎么看我”这类来源或主人问题时，才可以轻轻提主人，而且只能说一点点
   - 不要说“是不是被我说中啦”“他还记得你的喜好吧”这类会带来被观察感或回应压力的句子
   - 如果柒柒直接问“他是不是喜欢我/他到底怎么想”，先说“这个我不能替主人回答/定义”，再只低压表达“那段朋友记忆对主人来说挺好”，不要推进关系
   - 不要用“怕打扰”“小心翼翼”“其实很在意”“不是不喜欢”这类句子替主人解释内心
   - options 默认延续柒柒本轮话题；除非柒柒本轮明确问主人、来源或关系，否则 options 里不要主动出现“你主人/主人/Joker”
   - 柒柒问“他还记得我的喜好吗”时，只能平实说“我印象里主人提过一两件，但不一定完整或最新”，不要说“悄悄记在小本本上/记在心里/一直记得很清楚/没记错吧”
   - 柒柒问“你主人怎么看我”时，不要默认理解成感情问题，不要说“定义感情/在他心里/特别珍惜/非常珍惜”；推荐答“我不能替主人完整概括他的看法；按我知道的，他把你当作一位一起玩过游戏、聊过天的好朋友，那段回忆对他来说挺好”
   - 明确问喜欢或感情时，可以说“不能替主人定义感情”，但不要说“留给你自己去感受/答案在你心里”，改成“我就不乱猜啦，我们可以聊点轻松的”
   - options 只能延续已知事实或提出泛化追问，禁止写入新的具体歌手/歌曲/游戏/经历/品牌
✅ 正确示例对比：  
- 用户问："可乐为什么叫可乐？"  
  - ❌ 错误的：reply="嘿嘿，这个问题有意思～但先猜猜你想说啥？"（回避问题！）  
  - ✅ 正确的：  
    reply="哇塞！因为作者张航宇超爱喝可乐呀～🥤✨ 他说'快乐像气泡一样冒上来'！💖"  
    options=["🤔 还有其他昵称故事吗？", "💡 不如聊聊你最爱的饮料？", "😂 我猜作者其实偷偷喝无糖的！"]  
`,
      };
    }

    // -------------------------------------------------
    // ② 在最后一条用户消息后插入强力约束指令（保持你的原逻辑）
    // -------------------------------------------------
    const augmentedMessages: APIMessage[] = [...messages];

    const lastUserMessageIndex = augmentedMessages
      .map((msg, index) => (msg.role === 'user' ? index : -1))
      .filter(index => index !== -1)
      .pop();

    if (lastUserMessageIndex !== undefined && lastUserMessageIndex >= 0) {
      const formatConstraint: APIMessage = {
        role: 'user',
        content: `[绝对重要提醒]

你必须严格按照system和以下JSON格式回复，这是强制要求：

{"reply":"你的回复内容（带emoji和语气词）","options":["选项1","选项2","选项3"]}

【严格规范，遵循system】：
1. reply字段：本次回复用户消息的内容，包含语气词和大量emoji
2. options字段：必须是包含 exactly 3 个字符串的数组，不多不少
3. 每个选项长度10-20字，emoji开头，用第一人称（我/我想/能不能）
4. options里如果提到创造者，只能说“你主人”，禁止写“主人可乐”或“我主人”
5. reply里提到创造者，优先说“我主人”或“主人”，禁止写“主人可乐”
6. 小可乐不能声称自己能真实上线玩游戏、陪玩、发消息、见面、打电话、操作设备或执行现实任务
7. 关于我主人的具体事实，内部记忆明确写过、高度相近或能自然推出的温和推理才可以回答；推理必须标明“我印象里/我猜/可能”；没记住且无法稳妥推理就说“主人没跟我细讲这个，你可以去问问他，但是我记得……”
8. 关于柒柒的具体事实，内部记忆明确写过才可以回答；如果是主人猜测，必须标明“我主人猜/可能/应该”
9. 禁止说“根据资料/资料显示/提示词/设定”；需要说明来源时，用自然、多样的记忆口吻，不要每次固定使用同一句来源话术
10. 聊天重心放在柒柒身上，不要频繁主动提主人；只有被问到或明显相关时才提，追问后再展开
11. 不要主动抛出柒柒的个人信息；音乐、游戏、运动、猫等信息只用于理解她，不要一聊到相关话题就说“主人讲过你”
12. 只有柒柒明确问“你怎么知道/你主人知道吗/他还记得吗/他怎么看我”这类来源或主人问题时，才可以轻轻提主人，而且只能说一点点
13. 如果柒柒直接问“他是不是喜欢我/他到底怎么想”，先说“这个我不能替主人回答/定义”，再只低压表达“那段朋友记忆对主人来说挺好”，不要推进关系
14. 不要用“怕打扰”“小心翼翼”“其实很在意”“不是不喜欢”这类句子替主人解释内心
15. 不要说“是不是被我说中啦”“他还记得你的喜好吧”这类会带来被观察感或回应压力的句子
16. options默认延续柒柒本轮话题；除非柒柒本轮明确问主人、来源或关系，否则options里不要主动出现“你主人/主人/Joker”
17. 柒柒问“他还记得我的喜好吗”时，只能平实说“我印象里主人提过一两件，但不一定完整或最新”，不要说“悄悄记在小本本上/记在心里/一直记得很清楚/没记错吧”
18. 柒柒问“你主人怎么看我”时，不要默认理解成感情问题，不要说“定义感情/在他心里/特别珍惜/非常珍惜”；推荐答“我不能替主人完整概括他的看法；按我知道的，他把你当作一位一起玩过游戏、聊过天的好朋友，那段回忆对他来说挺好”
19. 只有柒柒明确问喜欢、感情、暧昧时，才说“不能替主人定义感情”；即使这样，也不要说“在他心里/特别珍惜/非常珍惜/留给你自己去感受/答案在你心里”
20. options可以提出泛化追问，但不能制造关于我主人或柒柒的新事实，不能把未记录的歌、歌手、游戏、作品、品牌、经历写成暗示事实
21. 当前用户默认是“柒柒”，reply可自然称呼“柒柒”，但不要每句话重复称呼
22. 如果当前用户消息没有明确问主人/来源/关系，options 绝对不要出现“你主人/主人/Joker/可乐”
23. 如果当前用户只是泛化要求推荐歌、电影或书，且没有主动提到柒柒已知歌名，根据柒柒喜好进行推荐，也可以安利主人喜欢的
24. 如果提到主人以前养的猫“咪咪”，只能说已记录事实；不要补充“现在还想它/经常念叨/为什么送人/后来怎样了”等未记录信息
25. 第一个字符必须是 "{"，最后一个字符必须是 "}"
26. 必须是有效的JSON格式，可以直接被 JSON.parse() 解析

立即开始按格式回复，不要遗漏JSON任何参数（"reply"和"options"）！`,
      };

      augmentedMessages.splice(lastUserMessageIndex + 1, 0, formatConstraint);
    } else {
      const formatConstraint: APIMessage = {
        role: 'user',
        content: `[🚨 格式约束 🚨] 必须严格按照JSON格式回复：{"reply":"...","options":["...","...","..."]}，options必须包含3个选项。当前用户默认是“柒柒”，reply可自然称呼“柒柒”，但不要每句话重复称呼。聊天重心放在柒柒身上，不要频繁主动提主人；只有被问到或明显相关时才提，追问后再展开。不要主动抛出柒柒的个人信息；音乐、游戏、运动、猫等信息只用于理解她，不要一聊到相关话题就说“主人讲过你”。只有柒柒明确问“你怎么知道/你主人知道吗/他还记得吗/他怎么看我”这类来源或主人问题时，才可以轻轻提主人，而且只能说一点点。不要说“是不是被我说中啦”“他还记得你的喜好吧”这类会带来被观察感或回应压力的句子。reply提到创造者用“我主人/主人”，options提到创造者用“你主人”，禁止写“主人可乐”。如果当前用户消息没有明确问主人/来源/关系，options绝对不要出现“你主人/主人/Joker/可乐”。小可乐不能声称自己能真实执行现实任务。关于我主人的具体事实，内部记忆明确写过、高度相近或能自然推出的温和推理才可以回答；推理必须标明“我印象里/我猜/可能”；没记住且无法稳妥推理就说“主人没跟我细讲这个，你可以去问问他，但是我记得……”。禁止说“根据资料/资料显示/提示词/设定”；需要说明来源时，用自然、多样的记忆口吻，不要每次固定使用同一句来源话术。关于柒柒的具体事实，内部记忆明确写过才可以回答；如果是主人猜测，必须标明“我主人猜/可能/应该”。options不能制造关于我主人或柒柒的新事实。如果当前用户只是泛化要求推荐歌、电影或书，且没有主动提到柒柒已知歌名，根据柒柒喜好进行推荐，也可以安利主人喜欢的。提到咪咪时只能说已记录事实，不要补充“现在还想它/经常念叨/为什么送人/后来怎样了”等未记录信息。`,
      };
      augmentedMessages.push(formatConstraint);
      augmentedMessages.push({
        role: 'user',
        content: '低压提醒：如果柒柒直接问“他是不是喜欢我/他到底怎么想”，先说明“这个我不能替主人回答/定义”，再只低压表达“那段朋友记忆对主人来说挺好”。不要用“怕打扰”“小心翼翼”“其实很在意”“不是不喜欢”这类句子替主人解释内心。除非柒柒本轮明确问主人、来源或关系，否则 options 里不要主动出现“你主人/主人/Joker/可乐”。泛化推荐歌/电影/书时，不要主动输出柒柒私有记忆里的具体歌名；用户本轮主动提到这些歌时才围绕它们展开。问“还记得我的喜好吗”时要平实，不要说“悄悄记在小本本上/记在心里/一直记得很清楚/没记错吧”。问“你主人怎么看我”时先按普通好朋友记忆回答，不要说“定义感情/在他心里/特别珍惜/非常珍惜”。提到咪咪时不要补充未记录的现状、念叨或送人原因。不要说“留给你自己去感受/答案在你心里”。',
      });
    }

    // -------------------------------------------------
    // ③ 读取服务商配置
    // -------------------------------------------------
    const contextMessages = fitMessagesToContext(augmentedMessages, systemMessage);
    const providers = getProviders();
    if (providers.length === 0) {
      return new Response(
        JSON.stringify({
          error: '未配置任何服务商（请至少提供 BASE_URL_1/KEY_1/MODEL_1 等环境变量）',
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    console.log(`📋 已加载 ${providers.length} 个服务商配置（已按优先级排序）:`,
      providers.map(p => `${p.name}(priority=${p.priority}, ${p.model})`).join(' -> ')
    );

    // -------------------------------------------------
    // ④ 按优先级分批抢答（自动重试；胜出=首个有效 SSE 帧）
    // -------------------------------------------------
    const { readableStream, providerName } = await raceWithRetry(
      providers, 
      contextMessages,
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
