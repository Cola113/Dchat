import { NextRequest } from 'next/server';

// 定义 API 消息类型（包含 system）
type APIMessage = {
  role: 'user' | 'assistant' | 'system';  // 🔥 添加 'system'
  content: string | Array<{type: string; text?: string; image_url?: {url: string}}>;
};

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

    let systemMessage: { role: 'system'; content: string };

    if (isFirstLoad || (messages.length === 1 && messages[0].role === 'user')) {
      // 🔥 首次对话：生成话题选项（JSON 格式）
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
      // 🔥 后续对话：猜测用户想说什么（JSON 格式）
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
2. 猜测用户接下来可能想说的3句话（让用户懒得打字！）

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

    // 🔥 多服务商配置（支持不同模型）
    const apiConfigs = buildAPIConfigs();

    if (apiConfigs.length === 0) {
      return new Response(
        JSON.stringify({ error: '未配置任何 API 服务商' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 🔥 并发请求竞速（强制自动取消）
    const response = await raceAPIRequests(apiConfigs, [systemMessage, ...messages]);

    return new Response(response.body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Provider': response.provider,
        'X-Model': response.model,
      },
    });

  } catch (error) {
    console.error('请求处理错误:', error);
    
    return new Response(
      JSON.stringify({ 
        error: '服务器内部错误',
        message: error instanceof Error ? error.message : '未知错误'
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

// 🔥 构建 API 配置（支持不同模型）
function buildAPIConfigs(): Array<{
  baseUrl: string;
  key: string;
  model: string;
  provider: string;
}> {
  const configs = [];
  
  for (let i = 1; i <= 4; i++) {
    const baseUrl = process.env[`BASE_URL_${i}`];
    const key = process.env[`KEY_${i}`];
    const model = process.env[`MODEL_${i}`];
    
    if (baseUrl && key && model) {
      configs.push({
        baseUrl,
        key,
        model,
        provider: `服务商${i}`
      });
    }
  }
  
  return configs;
}

// ✅ 修改点1：使用 Promise.any 等待第一个成功的请求
async function raceAPIRequests(
  configs: Array<{baseUrl: string; key: string; model: string; provider: string}>,
  messages: APIMessage[]
): Promise<{body: ReadableStream; provider: string; model: string}> {
  
  // 为每个请求创建独立的 AbortController
  const abortControllers = configs.map(() => new AbortController());
  
  // 创建所有请求的 Promise 数组
  const requests = configs.map((config, index) => 
    makeAPIRequest(config, messages, abortControllers[index].signal)
      .then(response => ({ 
        response, 
        provider: config.provider, 
        model: config.model, 
        index
      }))
  );

  try {
    // ✅ 修改点2：Promise.any 会自动等待第一个成功的 Promise，忽略失败的
    const result = await Promise.any(requests);
    
    console.log(`🏆 最终胜出: ${result.provider} (模型: ${result.model})`);
    
    // ✅ 修改点3：只在成功后取消其他请求
    abortControllers.forEach((controller, index) => {
      if (index !== result.index) {
        console.log(`❌ 取消请求 ${configs[index].provider} (${configs[index].model})`);
        controller.abort();
      }
    });
    
    return {
      body: result.response.body!,
      provider: result.provider,
      model: result.model
    };
  } catch (error) {
    // ✅ 修改点4：所有请求都失败时的错误处理
    console.error('❌ 所有服务商请求都失败了');
    if (error instanceof AggregateError) {
      error.errors.forEach((err, index) => {
        console.error(`  - ${configs[index]?.provider}: ${err.message}`);
      });
    }
    throw new Error('所有服务商请求都失败了');
  }
}

// 🔥 发起单个 API 请求（必须支持取消）
async function makeAPIRequest(
  config: {baseUrl: string; key: string; model: string; provider: string},
  messages: APIMessage[],
  signal?: AbortSignal
): Promise<Response> {
  console.log(`🚀 开始请求 ${config.provider} (${config.model})`);
  
  try {
    const response = await fetch(`${config.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.key}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        response_format: { type: 'json_object' },
        temperature: 1.0,
        stream: true,
        presence_penalty: 0.7,
        frequency_penalty: 0.4,
        max_tokens: 128000,
      }),
      signal: signal  // 🚨 必须传递取消信号
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ ${config.provider} HTTP ${response.status}:`, errorText);
      throw new Error(`${config.provider} (${config.model}) API 错误: ${response.status} ${errorText}`);
    }

    console.log(`✅ ${config.provider} 响应成功`);
    return response;
  } catch (error) {
    // ✅ 修改点5：增强错误日志
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        console.log(`⏸️  ${config.provider} 请求被取消（正常行为）`);
      } else {
        console.error(`❌ ${config.provider} 请求失败:`, error.message);
      }
    }
    throw error;
  }
}

