'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import 'katex/dist/katex.min.css';

import { Snowflakes } from './components/Snowflakes';
import { ChatMessage } from './components/ChatMessage';
import { ChatInput } from './components/ChatInput';
import { ToastContainer, useToast } from './components/Toast';
import { processStreamResponse, parseJSONResponse } from './components/streamParser';
import { uid, isTarotTriggerText } from './components/types';
import type { Message, WinterEmoji, UploadedFile, ContentItem, APIMessage } from './components/types';

// 冬季 emoji 列表（常量提取）
const WINTER_EMOJI_LIST = [
  '❄️', '⛄', '☃️', '🌨️', '🏔️', '🧊', '❄',
  '🎄', '🎅', '🤶', '🎁', '🎀', '🔔', '🕯️', '⭐', '🌟', '✨', '🦌', '🛷', '🧦', '🎊', '🎉',
  '🍪', '🥛', '☕', '🍵', '🫖', '🍫', '🥧', '🧁',
  '🧤', '🧣', '🎩', '👢',
  '🐧', '🦭', '🐻‍❄️',
  '💫', '🌠', '💎', '🪄'
];

export default function Home() {
  const initialMessageId = useRef(uid()).current;
  const [optionMessageId, setOptionMessageId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([
    { id: initialMessageId, role: 'ai', content: '你好!我是可乐的AI助手~ 🎄', timestamp: Date.now() }
  ]);
  const [inputValue, setInputValue] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [winterEmojis, setWinterEmojis] = useState<WinterEmoji[]>([]);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [suggestedOptions, setSuggestedOptions] = useState<string[]>([]);
  const [isLoadingOptions, setIsLoadingOptions] = useState(false);

  const chatMessagesRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const { toasts, showToast } = useToast();

  // 构建 API 消息体
  const buildAPIMessages = useCallback((
    allMessages: Message[],
    newUserContent: string | ContentItem[]
  ): APIMessage[] => {
    const apiMessages: APIMessage[] = allMessages.map((msg) => {
      if (msg.role === 'user' && Array.isArray(msg.content)) {
        const textPart = msg.content.find(item => item.type === 'text');
        const imageCount = msg.content.filter(item => item.type === 'image_url').length;
        return {
          role: 'user' as const,
          content: `${textPart?.text || '请分析这些图片'}\n[之前上传了 ${imageCount} 张图片]`
        };
      }
      return {
        role: (msg.role === 'ai' ? 'assistant' : 'user') as 'user' | 'assistant',
        content: msg.content
      };
    });
    apiMessages.push({ role: 'user', content: newUserContent });
    return apiMessages;
  }, []);

  // 获取初始选项
  const fetchInitialOptions = useCallback(async () => {
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
          messages: [{ role: 'user', content: '初次访问，请生成3个跨度极大的话题选项' }],
          isFirstLoad: true
        }),
      });

      if (!response.ok) throw new Error('获取选项失败');
      const reader = response.body?.getReader();
      if (!reader) throw new Error('无法读取响应');

      await processStreamResponse(reader, {
        onReplyChunk: (displayReply) => {
          setMessages(prev => prev.map(msg =>
            msg.id === initialMessageId ? { ...msg, content: displayReply } : msg
          ));
        },
        onComplete: (finalContent) => {
          const { reply, options } = parseJSONResponse(finalContent);
          setMessages(prev => prev.map(msg =>
            msg.id === initialMessageId ? { ...msg, content: reply } : msg
          ));
          setSuggestedOptions(prev => prev.length ? prev : options);
          if (!optionMessageId) setOptionMessageId(initialMessageId);
        },
        onOptionItem: (opt) => {
          setOptionMessageId(initialMessageId);
          setSuggestedOptions(prev => (prev.includes(opt) ? prev : [...prev, opt]));
        }
      });
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
  }, [initialMessageId, optionMessageId]);

  useEffect(() => {
    const timer = setTimeout(() => { fetchInitialOptions(); }, 1000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 自动滚动到底部
  const scrollToBottom = useCallback(() => {
    if (chatMessagesRef.current) {
      chatMessagesRef.current.scrollTop = chatMessagesRef.current.scrollHeight;
    }
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages, suggestedOptions, scrollToBottom]);

  // 点击产生 emoji 特效
  const handleEmojiClick = useCallback((e: React.MouseEvent) => {
    const randomEmoji = WINTER_EMOJI_LIST[Math.floor(Math.random() * WINTER_EMOJI_LIST.length)];
    const randomAnim = Math.floor(Math.random() * 5) + 1;
    const newEmoji: WinterEmoji = {
      id: uid(), x: e.clientX, y: e.clientY, emoji: randomEmoji, anim: randomAnim,
    };
    setWinterEmojis(prev => [...prev, newEmoji]);
    setTimeout(() => {
      setWinterEmojis(prev => prev.filter(item => item.id !== newEmoji.id));
    }, 2500);
  }, []);

  // 文件上传处理（使用 Toast 替代 alert）
  const handleFileUpload = useCallback(async (files: FileList) => {
    if (!files || files.length === 0) return;

    try {
      const imageFiles = Array.from(files).filter(file => {
        if (!file.type.startsWith('image/')) {
          showToast(`"${file.name}"不是图片文件，已跳过`, 'warning');
          return false;
        }
        // 文件大小校验：10MB
        if (file.size > 10 * 1024 * 1024) {
          showToast(`"${file.name}"超过10MB，已跳过`, 'warning');
          return false;
        }
        return true;
      });

      if (imageFiles.length === 0) {
        showToast('请选择图片文件！', 'warning');
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
    } catch {
      showToast('文件读取失败，请重试', 'error');
    }
  }, [showToast]);

  const removeFile = useCallback((index: number) => {
    setUploadedFiles(prev => prev.filter((_, i) => i !== index));
  }, []);

  const handleStop = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsGenerating(false);
    }
  }, []);

  // 发送消息
  const handleSend = useCallback(async (messageText?: string) => {
    const textToSend = messageText || inputValue.trim();
    if (!textToSend && uploadedFiles.length === 0) return;

    if (isGenerating) { handleStop(); return; }

    setSuggestedOptions([]);
    setOptionMessageId(null);

    let userContent: string | ContentItem[];
    if (uploadedFiles.length > 0) {
      userContent = [
        { type: 'text', text: textToSend || '请分析这些图片' },
        ...uploadedFiles.map(file => ({ type: 'image_url', image_url: { url: file.data } }))
      ];
    } else {
      userContent = textToSend;
    }

    const userMessage: Message = { id: uid(), role: 'user', content: userContent, timestamp: Date.now() };
    setMessages(prev => [...prev, userMessage]);
    setInputValue('');
    const currentFiles = [...uploadedFiles];
    setUploadedFiles([]);
    setIsGenerating(true);

    const aiMessageId = uid();
    const hasFiles = currentFiles.length > 0;

    if (hasFiles) {
      const loadingMessage: Message = { id: aiMessageId, role: 'ai', content: '🔍 正在分析图片，请稍候...', timestamp: Date.now() };
      setMessages(prev => [...prev, loadingMessage]);
    }

    try {
      const apiMessages = buildAPIMessages(messages, userContent);
      abortControllerRef.current = new AbortController();
      const isTarotTrigger = typeof userContent === 'string' && isTarotTriggerText(userContent);

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: apiMessages, isTarot: isTarotTrigger }),
        signal: abortControllerRef.current.signal
      });

      if (!response.ok) throw new Error('请求失败');
      const reader = response.body?.getReader();
      if (!reader) throw new Error('无法读取响应流');

      let hasStarted = false;

      await processStreamResponse(reader, {
        onReplyChunk: (displayReply) => {
          if (!hasStarted) {
            if (!hasFiles) {
              const aiMessage: Message = { id: aiMessageId, role: 'ai', content: displayReply, timestamp: Date.now() };
              setMessages(prev => [...prev, aiMessage]);
            }
            hasStarted = true;
          }
          setMessages(prev => prev.map(msg => msg.id === aiMessageId ? { ...msg, content: displayReply } : msg));
        },
        onComplete: (finalContent) => {
          if (!finalContent) {
            setMessages(prev => prev.map(msg =>
              msg.id === aiMessageId ? { ...msg, content: '抱歉，我无法生成回复。' } : msg
            ));
          } else {
            const { reply, options } = parseJSONResponse(finalContent);
            setMessages(prev => prev.map(msg =>
              msg.id === aiMessageId ? { ...msg, content: reply } : msg
            ));
            setSuggestedOptions(prev => prev.length ? prev : options);
            setOptionMessageId(aiMessageId);

            if (hasFiles) {
              setMessages(prev => prev.map(msg => {
                if (msg.id === userMessage.id) {
                  return { ...msg, content: `${textToSend || '请分析这些图片'}\n[已上传 ${currentFiles.length} 张图片]` };
                }
                return msg;
              }));
            }
          }
        },
        onOptionItem: (opt) => {
          setOptionMessageId(aiMessageId);
          setSuggestedOptions(prev => (prev.includes(opt) ? prev : [...prev, opt]));
        }
      });
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') {
        console.log('生成已停止');
      } else {
        console.error('请求错误:', error);
        setMessages(prev => prev.map(msg =>
          msg.id === aiMessageId ? { ...msg, content: '抱歉，连接服务器失败，请稍后再试。' } : msg
        ));
      }
    } finally {
      setIsGenerating(false);
      abortControllerRef.current = null;
    }
  }, [inputValue, uploadedFiles, isGenerating, messages, handleStop, buildAPIMessages]);

  const handleOptionClick = useCallback((option: string) => {
    handleSend(option);
  }, [handleSend]);

  const handleInputChange = useCallback((value: string) => {
    setInputValue(value);
  }, []);

  return (
    <main className="relative min-h-[100dvh] overflow-hidden" onClick={handleEmojiClick}>
      <ToastContainer toasts={toasts} />

      <div className="absolute inset-0 -z-30 bg-gradient-to-b from-sky-400 via-green-200/60 via-30% via-red-200/50 via-60% to-white" />
      <div className="pointer-events-none absolute -top-40 left-1/4 -z-10 h-[500px] w-[500px] rounded-full bg-blue-400/20 blur-3xl" />
      <div className="pointer-events-none absolute top-1/3 right-1/4 -z-10 h-[400px] w-[400px] rounded-full bg-green-300/15 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-20 left-1/2 -translate-x-1/2 -z-10 h-[400px] w-[400px] rounded-full bg-pink-200/10 blur-3xl" />

      <Snowflakes />

      {winterEmojis.map((item) => (
        <div key={item.id} className={`winter-emoji winter-emoji-anim-${item.anim}`} style={{ left: item.x - 16, top: item.y - 16 }}>
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

        <div ref={chatMessagesRef} className="chat-messages">
          {messages.map((message) => (
            <ChatMessage
              key={message.id}
              id={message.id}
              role={message.role}
              content={message.content}
              isOptionMessage={message.id === optionMessageId}
              suggestedOptions={suggestedOptions}
              onOptionClick={handleOptionClick}
            />
          ))}

          {isGenerating && (
            <div className="message ai">
              <div className="avatar">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/robot-santa.png" alt="AI助手" width={40} height={40} className="avatar-img" />
              </div>
              <div className="bubble">
                <div className="typing"><span></span><span></span><span></span></div>
              </div>
            </div>
          )}

          {isLoadingOptions && messages.length === 1 && (
            <div className="message ai">
              <div className="avatar">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/robot-santa.png" alt="AI助手" width={40} height={40} className="avatar-img" />
              </div>
              <div className="bubble">
                <div className="typing"><span></span><span></span><span></span></div>
              </div>
            </div>
          )}
        </div>

        <ChatInput
          inputValue={inputValue}
          uploadedFiles={uploadedFiles}
          isGenerating={isGenerating}
          onInputChange={handleInputChange}
          onSend={handleSend}
          onFileUpload={handleFileUpload}
          onRemoveFile={removeFile}
        />
      </div>
    </main>
  );
}
