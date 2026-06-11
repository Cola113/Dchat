// SSE 流解析器 - 从 page.tsx 抽离

// 找未转义的引号
function findUnescapedQuote(s: string, from: number): number {
  for (let i = from; i < s.length; i++) {
    if (s[i] !== '"') continue;
    let bs = 0, j = i - 1;
    while (j >= 0 && s[j] === '\\') { bs++; j--; }
    if (bs % 2 === 0) return i;
  }
  return -1;
}

// 尽力解码 JSON 字符串（对未完整的转义宽容）
function decodeJsonStringPartial(raw: string): string {
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch !== '\\') { out += ch; continue; }
    const n = raw[i + 1];
    if (n === undefined) break;
    if (n === '"' || n === '\\' || n === '/') { out += n; i++; continue; }
    if (n === 'n') { out += '\n'; i++; continue; }
    if (n === 'r') { out += '\r'; i++; continue; }
    if (n === 't') { out += '\t'; i++; continue; }
    if (n === 'b') { out += '\b'; i++; continue; }
    if (n === 'f') { out += '\f'; i++; continue; }
    if (n === 'u') {
      const hex = raw.slice(i + 2, i + 6);
      if (/^[0-9a-fA-F]{4}$/.test(hex)) {
        out += String.fromCharCode(parseInt(hex, 16));
        i += 5;
        continue;
      } else {
        break;
      }
    }
    out += ch;
  }
  return out;
}

// JSON 兜底解析
export function parseJSONResponse(content: string): { reply: string; options: string[] } {
  try {
    const parsed = JSON.parse(content);
    if (parsed.reply && Array.isArray(parsed.options) && parsed.options.length === 3) {
      return { reply: parsed.reply, options: parsed.options };
    }
  } catch {
    const replyMatch = content.match(/"reply"\s*:\s*"([^"]+)"/);
    const optionsMatch = content.match(/"options"\s*:\s*\[([\s\S]*?)\]/);
    if (replyMatch && optionsMatch) {
      try {
        const reply = replyMatch[1];
        const optionsStr = optionsMatch[1];
        const options = optionsStr
          .split(',')
          .map(opt => opt.trim().replace(/^"|"$/g, ''))
          .filter(opt => opt.length > 0)
          .slice(0, 3);
        if (options.length === 3) return { reply, options };
      } catch { /* ignore */ }
    }
  }
  console.warn('JSON 解析失败，使用兜底选项');
  return {
    reply: content,
    options: [
      '🤔 你继续说吧，我听着呢',
      '🎨 换个话题聊聊',
      '✨ 懒得打字，给我几个选择呗'
    ]
  };
}

export type StreamCallbacks = {
  onReplyChunk: (displayContent: string) => void;
  onComplete: (fullContent: string) => void;
  onOptionItem?: (optionText: string) => void;
};

export async function processStreamResponse(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  callbacks: StreamCallbacks
) {
  const { onReplyChunk, onComplete, onOptionItem } = callbacks;
  const decoder = new TextDecoder();
  let fullContent = '';
  let buf = '';

  // 扫描状态
  let replyStart = -1;
  let replyEnd = -1;
  let optionsStart = -1;
  let optCursor = -1;

  const scan = () => {
    // 1) 找 reply 起点
    if (replyStart === -1) {
      const m = /"reply"\s*:\s*"/.exec(buf);
      if (m) replyStart = m.index + m[0].length;
    }

    // 2) 增量输出 reply
    if (replyStart !== -1 && replyEnd === -1) {
      const end = findUnescapedQuote(buf, replyStart);
      replyEnd = end;
      const upto = end === -1 ? buf.length : end;
      const raw = buf.slice(replyStart, upto);
      onReplyChunk(decodeJsonStringPartial(raw));
    }

    // 3) 找 options 开始
    if (replyEnd !== -1 && optionsStart === -1) {
      const m = /"options"\s*:\s*\[/.exec(buf.slice(replyEnd + 1));
      if (m) {
        optionsStart = replyEnd + 1 + m.index + m[0].length;
        optCursor = optionsStart;
      }
    }

    // 4) 逐条输出 options
    if (optCursor !== -1 && onOptionItem) {
      while (true) {
        while (optCursor < buf.length && /[\s,]/.test(buf[optCursor])) optCursor++;
        if (optCursor >= buf.length) break;
        if (buf[optCursor] === ']') { optCursor++; break; }
        if (buf[optCursor] !== '"') break;

        const q1 = optCursor;
        const q2 = findUnescapedQuote(buf, q1 + 1);
        if (q2 === -1) break;

        const rawOpt = buf.slice(q1 + 1, q2);
        const textOpt = decodeJsonStringPartial(rawOpt);
        onOptionItem(textOpt);
        optCursor = q2 + 1;
      }
    }
  };

  // 读取 SSE 流
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    const lines = chunk.split('\n');

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') continue;

      try {
        const parsed = JSON.parse(data);
        const content = parsed.choices?.[0]?.delta?.content || '';
        if (!content) continue;

        fullContent += content;
        buf += content;
        scan();
      } catch {
        // 非 JSON 帧忽略
      }
    }
  }

  onComplete(fullContent);
}
