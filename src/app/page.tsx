'use client';

import { useState, useRef, useEffect } from 'react';
import Image from 'next/image';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

type Message = {
  id: string;
  role: 'user' | 'ai';
  content: string | Array<{type: string; text?: string; image_url?: {url: string}}>;
  timestamp: number;
};

type WinterEmoji = { id: string; x: number; y: number; emoji: string; anim: number };

type UploadedFile = {
  name: string;
  type: string;
  data: string;
};

type ContentItem = {
  type: string;
  text?: string;
  image_url?: {url: string};
};

type APIMessage = {
  role: 'user' | 'assistant';
  content: string | ContentItem[];
};

const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

function Snowflakes() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  if (!mounted) return null;

  const snowflakeSymbols = ['❄', '❅', '❆', '✻', '✼', '❉', '✺', '✹', '✸', '✷', '✶', '✵', '✴', '✳', '✲', '✱', '*', '·', '•'];

  return (
    <div className="snowflakes">
      {Array.from({ length: 100 }).map((_, i) => {
        const symbol = snowflakeSymbols[i % snowflakeSymbols.length];
        const randomOpacity = (0.2 + Math.random() * 0.7).toFixed(2);
        return (
          <div
            key={i}
            className="snowflake"
            style={{
              '--snowflake-opacity': randomOpacity,
              opacity: randomOpacity
            } as React.CSSProperties}
          >
            {symbol}
          </div>
        );
      })}
    </div>
  );
}

export default function Home() {
  const initialMessageId = useRef(uid()).current;
  const [optionMessageId, setOptionMessageId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: initialMessageId,
      role: 'ai',
      content: '你好!我是可乐的AI助手~ 🎄',
      timestamp: Date.now()
    }
  ]);
  const [inputValue, setInputValue] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [winterEmojis, setWinterEmojis] = useState<WinterEmoji[]>([]);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [suggestedOptions, setSuggestedOptions] = useState<string[]>([]);
  const [isLoadingOptions, setIsLoadingOptions] = useState(false);
  const chatMessagesRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // 文本域自适应高度（到上限）
  const autoResize = () => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const max = 120; // 与 CSS 中 max-height 保持一致
    el.style.height = Math.min(el.scrollHeight, max) + 'px';
  };

  // 流式处理：仅输出 reply 文本，options 逐条增量输出
  const processStreamResponse = async (
    reader: ReadableStreamDefaultReader<Uint8Array>,
    onReplyChunk: (displayContent: string) => void,
    onComplete: (fullContent: string) => void,
    onOptionItem?: (optionText: string) => void
  ) => {
    const decoder = new TextDecoder();
    let fullContent = ''; // 模型在 JSON 中写入的完整文本（含 reply 与 options）
    let buf = '';         // 扫描缓冲区

    // 找未转义的引号
    const findUnescapedQuote = (s: string, from: number) => {
      for (let i = from; i < s.length; i++) {
        if (s[i] !== '"') continue;
        let bs = 0, j = i - 1;
        while (j >= 0 && s[j] === '\\') { bs++; j--; }
        if (bs % 2 === 0) return i;
      }
      return -1;
    };

    // 尽力解码 JSON 字符串（对未完整的转义宽容）
    const decodeJsonStringPartial = (raw: string) => {
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
            break; // 不完整的 \uXXXX，留待后续块
          }
        }
        out += ch; // 未识别的转义，透传
      }
      return out;
    };

    // 扫描状态
    let replyStart = -1;   // reply 字符串起始（引号内）
    let replyEnd = -1;     // reply 字符串结束引号位置
    let optionsStart = -1; // options 数组 '[' 后的位置
    let optCursor = -1;    // 选项扫描游标（逐项推进）

    const scan = () => {
      // 1) 找 reply 起点
      if (replyStart === -1) {
        const m = /"reply"\s*:\s*"/.exec(buf);
        if (m) replyStart = m.index + m[0].length;
      }

      // 2) 增量输出 reply
      if (replyStart !== -1 && replyEnd === -1) {
        const end = findUnescapedQuote(buf, replyStart);
        replyEnd = end; // -1 表示尚未闭合
        const upto = end === -1 ? buf.length : end;
        const raw = buf.slice(replyStart, upto);
        onReplyChunk(decodeJsonStringPartial(raw));
      }

      // 3) 找 options 开始（在 reply 完成之后）
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
  };

  // JSON 兜底解析（最终收尾用）
  const parseJSONResponse = (content: string): { reply: string; options: string[] } => {
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
        } catch {}
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
  };

  const buildAPIMessages = (
    allMessages: Message[],
    newUserContent: string | ContentItem[]
  ): APIMessage[] => {
    const apiMessages: APIMessage[] = allMessages.map((msg) => {
      if (msg.role === 'user' && Array.isArray(msg.content)) {
        const textPart = msg.content.find(item => item.type === 'text');
        const imageCount = msg.content.filter(item => item.type === 'image_url').length;

        return {
          role: 'user',
          content: `${textPart?.text || '请分析这些图片'}\n[之前上传了 ${imageCount} 张图片]`
        };
      }

      return {
        role: msg.role === 'ai' ? 'assistant' : 'user',
        content: msg.content
      };
    });

    apiMessages.push({
      role: 'user',
      content: newUserContent
    });

    return apiMessages;
  };

  const fetchInitialOptions = async () => {
    setIsLoadingOptions(true);
    try {
      setMessages(prev => prev.map(msg =>
        msg.id === initialMessageId
          ? { ...msg, content: '✨ 正在准备超级有趣的话题...' }
          : msg
      ));

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{
            role: 'user',
            content: '初次访问，请生成3个跨度极大的话题选项'
          }],
          isFirstLoad: true
        }),
      });

      if (!response.ok) throw new Error('获取选项失败');

      const reader = response.body?.getReader();
      if (!reader) throw new Error('无法读取响应');

      await processStreamResponse(
        reader,
        // 仅显示 reply 文本（不显示 JSON）
        (displayReply) => {
          setMessages(prev => prev.map(msg =>
            msg.id === initialMessageId
              ? { ...msg, content: displayReply }
              : msg
          ));
        },
        // 收尾：修正最终 reply 和 options（如有缺漏）
        (finalContent) => {
          const { reply, options } = parseJSONResponse(finalContent);
          setMessages(prev => prev.map(msg =>
            msg.id === initialMessageId
              ? { ...msg, content: reply }
              : msg
          ));
          // 若流式已逐条推入，这里只做兜底合并
          setSuggestedOptions(prev => prev.length ? prev : options);
          if (!optionMessageId) setOptionMessageId(initialMessageId);
        },
        // 新增：options 逐条出现
        (opt) => {
          setOptionMessageId(initialMessageId);
          setSuggestedOptions(prev => (prev.includes(opt) ? prev : [...prev, opt]));
        }
      );
    } catch (error) {
      console.error('获取初始选项失败:', error);
      setMessages(prev => prev.map(msg =>
        msg.id === initialMessageId
          ? { ...msg, content: '抱歉，欢迎语加载失败了 😢 但你可以随便聊聊哦！' }
          : msg
      ));
      setSuggestedOptions(['😄 讲个冷笑话', '🎄 分享圣诞故事', '🥘 推荐美食食谱']);
      setOptionMessageId(initialMessageId);
    } finally {
      setIsLoadingOptions(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => { fetchInitialOptions(); }, 1000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scrollToBottom = () => {
    if (chatMessagesRef.current) {
      chatMessagesRef.current.scrollTop = chatMessagesRef.current.scrollHeight;
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, suggestedOptions]);

  useEffect(() => {
    autoResize();
  }, []); // 初始化时计算一次高度

  const handleEmojiClick = (e: React.MouseEvent) => {
    const winterEmojiList = [
      '❄️', '⛄', '☃️', '🌨️', '🏔️', '🧊', '❄',
      '🎄', '🎅', '🤶', '🎁', '🎀', '🔔', '🕯️', '⭐', '🌟', '✨', '🦌', '🛷', '🧦', '🎊', '🎉',
      '🍪', '🥛', '☕', '🍵', '🫖', '🍫', '🥧', '🧁',
      '🧤', '🧣', '🎩', '👢',
      '🐧', '🦭', '🐻‍❄️',
      '💫', '🌠', '💎', '🪄'
    ];

    const randomEmoji = winterEmojiList[Math.floor(Math.random() * winterEmojiList.length)];
    const randomAnim = Math.floor(Math.random() * 5) + 1;

    const newEmoji: WinterEmoji = {
      id: uid(),
      x: e.clientX,
      y: e.clientY,
      emoji: randomEmoji,
      anim: randomAnim,
    };

    setWinterEmojis((prev) => [...prev, newEmoji]);
    setTimeout(() => {
      setWinterEmojis((prev) => prev.filter((item) => item.id !== newEmoji.id));
    }, 2500);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    try {
      const imageFiles = Array.from(files).filter(file => {
        if (!file.type.startsWith('image/')) {
          alert(`"${file.name}"不是图片文件，已跳过`);
          return false;
        }
        return true;
      });

      if (imageFiles.length === 0) {
        alert('请选择图片文件！');
        return;
      }

      const filePromises = imageFiles.map(async (file) => {
        return new Promise<UploadedFile>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const result = reader.result as string;
            resolve({ name: file.name, type: file.type, data: result });
          };
          reader.onerror = () => reject(new Error('文件读取失败'));
          reader.readAsDataURL(file);
        });
      });

      const uploaded = await Promise.all(filePromises);
      setUploadedFiles(prev => [...prev, ...uploaded]);
    } catch (error) {
      console.error('文件读取错误:', error);
      alert('文件读取失败，请重试');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const removeFile = (index: number) => {
    setUploadedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsGenerating(false);
    }
  };

  const handleSend = async (messageText?: string) => {
    const textToSend = messageText || inputValue.trim();
    if (!textToSend && uploadedFiles.length === 0) return;

    if (isGenerating) {
      handleStop();
      return;
    }

    setSuggestedOptions([]);
    setOptionMessageId(null);

    let userContent: string | ContentItem[];

    if (uploadedFiles.length > 0) {
      userContent = [
        { type: 'text', text: textToSend || '请分析这些图片' },
        ...uploadedFiles.map(file => ({
          type: 'image_url',
          image_url: { url: file.data }
        }))
      ];
    } else {
      userContent = textToSend;
    }

    const userMessage: Message = {
      id: uid(),
      role: 'user',
      content: userContent,
      timestamp: Date.now()
    };

    setMessages(prev => [...prev, userMessage]);
    setInputValue('');
    autoResize();
    const currentFiles = [...uploadedFiles];
    setUploadedFiles([]);
    setIsGenerating(true);

    const aiMessageId = uid();
    const hasFiles = currentFiles.length > 0;

    if (hasFiles) {
      const loadingMessage: Message = {
        id: aiMessageId,
        role: 'ai',
        content: '🔍 正在分析图片，请稍候...',
        timestamp: Date.now()
      };
      setMessages(prev => [...prev, loadingMessage]);
    }

    try {
      const apiMessages = buildAPIMessages(messages, userContent);
      abortControllerRef.current = new AbortController();

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: apiMessages }),
        signal: abortControllerRef.current.signal
      });

      if (!response.ok) throw new Error('请求失败');

      const reader = response.body?.getReader();
      if (!reader) throw new Error('无法读取响应流');

      let hasStarted = false;

      await processStreamResponse(
        reader,
        // reply 渲染：仅文本
        (displayReply) => {
          if (!hasStarted) {
            if (!hasFiles) {
              const aiMessage: Message = {
                id: aiMessageId,
                role: 'ai',
                content: displayReply,
                timestamp: Date.now()
              };
              setMessages(prev => [...prev, aiMessage]);
            }
            hasStarted = true;
          }
          setMessages(prev =>
            prev.map(msg =>
              msg.id === aiMessageId
                ? { ...msg, content: displayReply }
                : msg
            )
          );
        },
        // 收尾：修正最终 reply 与 options
        (finalContent) => {
          if (!finalContent) {
            setMessages(prev =>
              prev.map(msg =>
                msg.id === aiMessageId
                  ? { ...msg, content: '抱歉，我无法生成回复。' }
                  : msg
              )
            );
          } else {
            const { reply, options } = parseJSONResponse(finalContent);

            setMessages(prev =>
              prev.map(msg =>
                msg.id === aiMessageId
                  ? { ...msg, content: reply }
                  : msg
              )
            );

            setSuggestedOptions(prev => prev.length ? prev : options);
            setOptionMessageId(aiMessageId);

            if (hasFiles) {
              setMessages(prev => prev.map(msg => {
                if (msg.id === userMessage.id) {
                  return {
                    ...msg,
                    content: `${textToSend || '请分析这些图片'}\n[已上传 ${currentFiles.length} 张图片]`
                  };
                }
                return msg;
              }));
            }
          }
        },
        // options 增量
        (opt) => {
          setOptionMessageId(aiMessageId);
          setSuggestedOptions(prev => (prev.includes(opt) ? prev : [...prev, opt]));
        }
      );

    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') {
        console.log('生成已停止');
      } else {
        console.error('请求错误:', error);
        setMessages(prev =>
          prev.map(msg =>
            msg.id === aiMessageId
              ? { ...msg, content: '抱歉，连接服务器失败，请稍后再试。' }
              : msg
          )
        );
      }
    } finally {
      setIsGenerating(false);
      abortControllerRef.current = null;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleOptionClick = (option: string) => {
    handleSend(option);
  };

  const renderTextWithBold = (text: string) => {
    const parts = text.split(/(\*\*.*?\*\*)/g);
    return parts.map((part, index) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        const boldText = part.slice(2, -2);
        return <strong key={index} style={{fontWeight: '700'}}>{boldText}</strong>;
      }
      return <span key={index}>{part}</span>;
    });
  };

  const renderMessageContent = (content: string | ContentItem[], messageId?: string) => {
    if (typeof content === 'string') {
      // 条件改为：只要有选项（>0）就显示容器，允许逐条出现
      const shouldShowOptions = messageId === optionMessageId && suggestedOptions.length > 0;

      return (
        <div>
          <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkMath]}
            rehypePlugins={[rehypeKatex]}
            components={{
              strong: ({node, ...props}) => (
                <strong style={{fontWeight: '700', color: 'inherit'}} {...props} />
              ),
              em: ({node, ...props}) => (
                <em style={{fontStyle: 'italic'}} {...props} />
              ),
              // 让 Markdown 图片自适应
              img: ({node, ...props}) => (
                <img {...props} style={{maxWidth: '100%', height: 'auto', borderRadius: 8}} />
              ),
            }}
          >
            {content}
          </ReactMarkdown>

          {shouldShowOptions && (
            <div className="message-options">
              <div className="options-label">💡点击选择✨</div>
              <div className="options-buttons">
                {suggestedOptions.map((option, index) => (
                  <button
                    key={index}
                    className="option-button-in-message"
                    onClick={() => handleOptionClick(option)}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      );
    }

    return (
      <div>
        {content.map((item, index) => {
          if (item.type === 'text') {
            return <div key={index}>{item.text}</div>;
          }
          if (item.type === 'image_url' && item.image_url) {
            return (
              <div key={index} className="uploaded-image-container">
                <Image
                  src={item.image_url.url}
                  alt="上传的图片"
                  width={200}
                  height={150}
                  className="uploaded-image"
                />
              </div>
            );
          }
          return null;
        })}
      </div>
    );
  };

  return (
    <main
      className="relative min-h-[100dvh] overflow-hidden"
      onClick={handleEmojiClick}
    >
      <div className="absolute inset-0 -z-30 bg-gradient-to-b from-sky-400 via-green-200/60 via-30% via-red-200/50 via-60% to-white" />
      <div className="pointer-events-none absolute -top-40 left-1/4 -z-10 h-[500px] w-[500px] rounded-full bg-blue-400/20 blur-3xl" />
      <div className="pointer-events-none absolute top-1/3 right-1/4 -z-10 h-[400px] w-[400px] rounded-full bg-green-300/15 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-20 left-1/2 -translate-x-1/2 -z-10 h-[400px] w-[400px] rounded-full bg-pink-200/10 blur-3xl" />

      <Snowflakes />

      {winterEmojis.map((item) => (
        <div
          key={item.id}
          className={`winter-emoji winter-emoji-anim-${item.anim}`}
          style={{ left: item.x - 16, top: item.y - 16 }}
        >
          {item.emoji}
        </div>
      ))}

      <div className="chat-container">
        <div className="header">
          <div style={{ display: 'inline-block' }}>
            <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-red-600 via-green-600 to-red-600 shimmer" style={{ letterSpacing: '-0.02em' }}>
              可乐的小站
            </h1>
          </div>
          <p className="mt-1 text-red-700/90 text-sm glow">
            <span className="emoji-bounce">🎄</span>顶<span className="emoji-bounce">🎅</span>级<span className="emoji-bounce">⛄</span>牛<span className="emoji-bounce">🎁</span>马<span className="emoji-bounce">🔔</span>
          </p>
        </div>

        <div
          ref={chatMessagesRef}
          className="chat-messages"
        >
          {messages.map((message) => (
            <div key={message.id} className={`message ${message.role}`}>
              <div className="avatar">
                {message.role === 'ai' ? (
                  <Image
                    src="/robot-santa.png"
                    alt="AI助手"
                    width={40}
                    height={40}
                    className="avatar-img"
                  />
                ) : (
                  '🐮'
                )}
              </div>
              <div className="bubble">
                {message.role === 'ai'
                  ? renderMessageContent(message.content, message.id)
                  : renderMessageContent(message.content)
                }
              </div>
            </div>
          ))}

          {isGenerating && (
            <div className="message ai">
              <div className="avatar">
                <Image
                  src="/robot-santa.png"
                  alt="AI助手"
                  width={40}
                  height={40}
                  className="avatar-img"
                />
              </div>
              <div className="bubble">
                <div className="typing">
                  <span></span>
                  <span></span>
                  <span></span>
                </div>
              </div>
            </div>
          )}

          {isLoadingOptions && messages.length === 1 && (
            <div className="message ai">
              <div className="avatar">
                <Image
                  src="/robot-santa.png"
                  alt="AI助手"
                  width={40}
                  height={40}
                  className="avatar-img"
                />
              </div>
              <div className="bubble">
                <div className="typing">
                  <span></span>
                  <span></span>
                  <span></span>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="input-area">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handleFileUpload}
            style={{ display: 'none' }}
          />

          <button
            className="upload-button"
            onClick={() => fileInputRef.current?.click()}
            title="上传图片"
            aria-label="上传图片"
          >
            🖼️
          </button>

          <div className="input-wrapper">
            {uploadedFiles.length > 0 && (
              <div className="uploaded-files">
                {uploadedFiles.map((file, index) => (
                  <div key={index} className="file-preview">
                    <Image
                      src={file.data}
                      alt={file.name}
                      width={80}
                      height={80}
                    />
                    <button
                      className="remove-file"
                      onClick={() => removeFile(index)}
                      aria-label="删除图片"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}

            <textarea
              ref={inputRef}
              className="input-box resize-none"
              placeholder="输入你的消息...🎄"
              value={inputValue}
              onChange={(e) => { setInputValue(e.target.value); autoResize(); }}
              onKeyDown={handleKeyDown}
              rows={1}
            />
          </div>

          <button
            className="send-button"
            onClick={() => handleSend()}
            disabled={!inputValue.trim() && uploadedFiles.length === 0 && !isGenerating}
            aria-label={isGenerating ? '暂停生成' : '发送消息'}
            title={isGenerating ? '暂停生成' : '发送'}
          >
            {isGenerating ? '⏸' : '发送'}
          </button>
        </div>
      </div>
    </main>
  );
}
