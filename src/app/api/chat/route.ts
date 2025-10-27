// app/api/chat/route.ts
import { NextRequest } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { messages } = body;

    if (!messages || !Array.isArray(messages)) {
      return new Response(
        JSON.stringify({ error: '无效的消息格式' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 🔥 直接使用前端传来的消息，不做任何修改
    const response = await fetch('https://ai.hybgzs.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.YUNWU_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gemini-2.5-flash-lite-preview-09-2025',
        messages: messages,  // 🔥 已经是 {role: 'user'|'assistant', content: string} 格式
        temperature: 1.2,
        stream: true,
        presence_penalty: 0.6,
        frequency_penalty: 0.3,
        max_tokens: 128000,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('API 错误:', response.status, errorText);
      
      return new Response(
        JSON.stringify({ 
          error: '服务器返回错误',
          details: errorText,
          status: response.status 
        }),
        { status: response.status, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(response.body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
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
