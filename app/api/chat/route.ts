import { NextRequest, NextResponse } from 'next/server'
import { llmService } from '@/lib/api/llm-providers'
import type { LLMRequest, LLMMessage } from '@/lib/api/llm-providers'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      messages,
      provider,
      model,
      temperature = 0.7,
      maxTokens = 10096,
      stream = true,
      apiKeys = {}
    } = body as {
      messages: LLMMessage[]
      provider: string
      model: string
      temperature?: number
      maxTokens?: number
      stream?: boolean
      apiKeys?: Record<string, string>
    }

    // Validate required fields
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json(
        { error: 'Messages array is required and cannot be empty' },
        { status: 400 }
      )
    }

    if (!provider || !model) {
      return NextResponse.json(
        { error: 'Provider and model are required' },
        { status: 400 }
      )
    }

    // Check if provider is available
    const availableProviders = llmService.getAvailableProviders()
    const selectedProvider = availableProviders.find(p => p.id === provider)

    if (!selectedProvider) {
      return NextResponse.json(
        {
          error: `Provider ${provider} is not available. Check your API keys.`,
          availableProviders: availableProviders.map(p => p.id)
        },
        { status: 400 }
      )
    }

    // Check if model is supported by the provider
    if (!selectedProvider.models.includes(model)) {
      return NextResponse.json(
        {
          error: `Model ${model} is not supported by ${provider}`,
          availableModels: selectedProvider.models
        },
        { status: 400 }
      )
    }

    const llmRequest: LLMRequest = {
      messages,
      provider,
      model,
      temperature,
      maxTokens,
      stream,
      apiKeys
    }

    // Handle streaming response
    if (stream && selectedProvider.supportsStreaming) {
      const encoder = new TextEncoder();
      const llmStream = llmService.generateStreamingResponse(llmRequest);

      const readableStream = new ReadableStream({
        async start(controller) {
          for await (const chunk of llmStream) {
            if (chunk.content) {
              // Format according to Vercel AI SDK spec: '0:"[content]"'
              controller.enqueue(encoder.encode(`0:"${JSON.stringify(chunk.content).slice(1, -1)}"\n`));
              // Side-channel: detect commands blocks in streamed content and emit as special lines starting with 2:
              const match = chunk.content.match(/=== COMMANDS_START ===([\s\S]*?)=== COMMANDS_END ===/);
              if (match) {
                controller.enqueue(encoder.encode(`2:"${Buffer.from(match[1]).toString('base64')}"\n`));
              }
            }
          }
          controller.close();
        },
        cancel() {
          console.log("Stream cancelled by client.");
        }
      });

      return new Response(readableStream, {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      });
    }

    // Handle non-streaming response
    const response = await llmService.generateResponse(llmRequest)

    // Post-process assistant content to extract COMMANDS block for the client
    let commands: { request_files?: string[]; write_diffs?: { path: string; diff: string }[] } | null = null;
    try {
      const content = response.content || '';
      const match = content.match(/=== COMMANDS_START ===([\s\S]*?)=== COMMANDS_END ===/);
      if (match) {
        const block = match[1];
        // Naive parse: look for JSON-like arrays
        const reqMatch = block.match(/request_files:\s*\[(.*?)\]/s);
        const diffsMatch = block.match(/write_diffs:\s*\[([\s\S]*?)\]/);
        const request_files = reqMatch ? JSON.parse(`[${reqMatch[1]}]`.replace(/([a-zA-Z0-9_\-\/\.]+)(?=\s*[\],])/g, '"$1"')) : [];
        let write_diffs: { path: string; diff: string }[] = [];
        if (diffsMatch) {
          const items = diffsMatch[1]
            .split(/},/)
            .map(s => (s.endsWith('}') ? s : s + '}'))
            .map(s => s.trim())
            .filter(Boolean);
          write_diffs = items.map(raw => {
            const pathMatch = raw.match(/path:\s*"([^"]+)"/);
            const diffMatch = raw.match(/diff:\s*"([\s\S]*)"/);
            return { path: pathMatch?.[1] || '', diff: (diffMatch?.[1] || '').replace(/\\n/g, '\n') };
          });
        }
        commands = { request_files, write_diffs };
      }
    } catch {
      // Ignore parse errors
    }

    return NextResponse.json({
      success: true,
      data: response,
      commands,
      timestamp: new Date().toISOString()
    })

  } catch (error) {
    console.error('Chat API error:', error)

    // Handle specific error types
    if (error instanceof Error) {
      if (error.message.includes('API key')) {
        return NextResponse.json(
          { error: 'Invalid or missing API key for the selected provider' },
          { status: 401 }
        )
      }

      if (error.message.includes('rate limit')) {
        return NextResponse.json(
          { error: 'Rate limit exceeded. Please try again later.' },
          { status: 429 }
        )
      }

      if (error.message.includes('quota')) {
        return NextResponse.json(
          { error: 'API quota exceeded for this provider' },
          { status: 429 }
        )
      }
    }

    return NextResponse.json(
      {
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}

export async function GET() {
  try {
    const availableProviders = llmService.getAvailableProviders()

    return NextResponse.json({
      success: true,
      data: {
        providers: availableProviders,
        defaultProvider: process.env.DEFAULT_LLM_PROVIDER || 'openrouter',
        defaultModel: process.env.DEFAULT_MODEL || 'deepseek/deepseek-r1-0528:free',
        defaultTemperature: parseFloat(process.env.DEFAULT_TEMPERATURE || '0.7'),
        defaultMaxTokens: parseInt(process.env.DEFAULT_MAX_TOKENS || '80000'),
        features: {
          voiceEnabled: process.env.ENABLE_VOICE_FEATURES === 'true',
          imageGeneration: process.env.ENABLE_IMAGE_GENERATION === 'true',
          chatHistory: process.env.ENABLE_CHAT_HISTORY === 'true',
          codeExecution: process.env.ENABLE_CODE_EXECUTION === 'true',
        }
      }
    })
  } catch (error) {
    console.error('Error fetching providers:', error)
    return NextResponse.json(
      { error: 'Failed to fetch available providers' },
      { status: 500 }
    )
  }
}

// Handle preflight requests for CORS
export async function OPTIONS() {
  return new Response(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  })
}
