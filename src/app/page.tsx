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

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  const snowflakeSymbols = ['❄', '❅', '❆', '✻', '✼', '❉', '✺', '✹', '✸', '✷', '✶', '✵', '✴', '✳', '✲', '✱', '*', '·', '•'];

  return (
    <div className="snowflakes">
      {Array.from({ length: 300 }).map((_, i) => {
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
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatMessagesRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 🔥 优化：流式处理 + 实时提取 reply 字段
  const processStreamResponse = async (
    reader: ReadableStreamDefaultReader<Uint8Array>,
    onChunk: (displayContent: string) => void,
    onComplete: (fullContent: string) => void
  ) => {
    const decoder = new TextDecoder();
    let fullContent = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n');

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();
          
          if (data === '[DONE]') {
            break;
          }

          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.delta?.content || '';
            
            if (content) {
              fullContent += content;
              
              // 🔥 尝试实时提取 reply 字段（隐藏 JSON 结构）
              try {
                const partialMatch = fullContent.match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)"/);
                if (partialMatch) {
                  const displayContent = partialMatch[1]
                    .replace(/\\n/g, '\n')
                    .replace(/\\"/g, '"')
                    .replace(/\\\\/g, '\\');
                  
                  // 显示已解析的 reply 部分
                  onChunk(displayContent);
                } else {
                  // 如果还没解析到 reply，显示原始内容
                  onChunk(fullContent);
                }
              } catch {
                // 解析失败时显示原始内容
                onChunk(fullContent);
              }
            }
          } catch {
            // 跳过无法解析的行
          }
        }
      }
    }

    onComplete(fullContent);
  };

  // JSON 格式解析（保持原有逻辑）
  const parseJSONResponse = (content: string): { reply: string; options: string[] } => {
    try {
      const parsed = JSON.parse(content);
      
      if (parsed.reply && Array.isArray(parsed.options) && parsed.options.length === 3) {
        return {
          reply: parsed.reply,
          options: parsed.options
        };
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
          
          if (options.length === 3) {
            return { reply, options };
          }
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
        headers: {
          'Content-Type': 'application/json',
        },
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
        (displayContent) => {
          // 🎨 流式显示提取的 reply 内容
          setMessages(prev => prev.map(msg => 
            msg.id === initialMessageId 
              ? { ...msg, content: displayContent } 
              : msg
          ));
        },
        (finalContent) => {
          const { reply, options } = parseJSONResponse(finalContent);
          
          setMessages(prev => prev.map(msg => 
            msg.id === initialMessageId 
              ? { ...msg, content: reply } 
              : msg
          ));
          
          setSuggestedOptions(options);
          setOptionMessageId(initialMessageId);
        }
      );

    } catch (error) {
      console.error('获取初始选项失败:', error);
      setMessages(prev => prev.map(msg => 
        msg.id === initialMessageId 
          ? { ...msg, content: '抱歉，欢迎语加载失败了 😢 但你可以随便聊聊哦！' } 
          : msg
      ));
      setSuggestedOptions([
        '😄 讲个冷笑话',
        '🎄 分享圣诞故事',
        '🥘 推荐美食食谱'
      ]);
      setOptionMessageId(initialMessageId);
    } finally {
      setIsLoadingOptions(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchInitialOptions();
    }, 1000);
    
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
           
           resolve({
             name: file.name,
             type: file.type,
             data: result
           });
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
     if (fileInputRef.current) {
       fileInputRef.current.value = '';
     }
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
       headers: {
         'Content-Type': 'application/json',
       },
       body: JSON.stringify({
         messages: apiMessages
       }),
       signal: abortControllerRef.current.signal
     });

     if (!response.ok) {
       throw new Error('请求失败');
     }

     const reader = response.body?.getReader();
     if (!reader) {
       throw new Error('无法读取响应流');
     }

     let hasStarted = false;

     await processStreamResponse(
       reader,
       (displayContent) => {
         // 🎨 流式显示提取的 reply 内容
         if (!hasStarted) {
           if (!hasFiles) {
             const aiMessage: Message = {
               id: aiMessageId,
               role: 'ai',
               content: displayContent,
               timestamp: Date.now()
             };
             setMessages(prev => [...prev, aiMessage]);
           }
           hasStarted = true;
         }
         
         setMessages(prev => 
           prev.map(msg => 
             msg.id === aiMessageId 
               ? { ...msg, content: displayContent }
               : msg
           )
         );
       },
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
           
           setSuggestedOptions(options);
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

 const handleKeyPress = (e: React.KeyboardEvent) => {
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
     const shouldShowOptions = messageId === optionMessageId && suggestedOptions.length === 3;
     
     const hasComplexMarkdown = content.includes('```') || content.includes('#') || content.includes('- ') || content.includes('* ');
     
     return (
       <div>
         {hasComplexMarkdown ? (
           <ReactMarkdown 
             remarkPlugins={[remarkGfm, remarkMath]}
             rehypePlugins={[rehypeKatex]}
             components={{
               strong: ({node, ...props}) => (
                 <strong style={{fontWeight: '700', color: 'inherit'}} {...props} />
               ),
               em: ({node, ...props}) => (
                 <em style={{fontStyle: 'italic'}} {...props} />
               )
             }}
           >
             {content}
           </ReactMarkdown>
         ) : (
           <div style={{whiteSpace: 'pre-wrap'}}>
             {renderTextWithBold(content)}
           </div>
         )}
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
               {message.role === 'ai' ? (
                 renderMessageContent(message.content, message.id)
               ) : (
                 renderMessageContent(message.content)
               )}
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
         
         <div ref={messagesEndRef} />
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
                   >
                     ×
                   </button>
                 </div>
               ))}
             </div>
           )}
           
           <textarea
             className="input-box resize-none"
             placeholder="输入你的消息...🎄"
             value={inputValue}
             onChange={(e) => setInputValue(e.target.value)}
             onKeyPress={handleKeyPress}
             rows={1}
             style={{ maxHeight: '120px' }}
           />
         </div>

         <button 
           className="send-button"
           onClick={() => handleSend()}
           disabled={!inputValue.trim() && uploadedFiles.length === 0 && !isGenerating}
         >
           {isGenerating ? '⏸' : '发送'}
         </button>
       </div>
     </div>
   </main>
 );
}
