import {
  Tool,
  streamText,
  createTextStreamResponse,
  ModelMessage,
} from 'ai';
import OpenAI from 'openai';
import { evaluateCode, nonEmpty } from './codeInterpreter';

// Create an OpenAI API client (that's edge friendly!)
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || '',
});

export const dynamic = 'force-dynamic';

// You can also use edge runtime
// export const runtime = 'edge';

const tools: Tool[] = [
  {
    type: 'function',
    name: 'execute_python_code',
    description: 'Execute python code in Jupyter Notebook via code interpreter.',
    inputSchema: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: `Python code that will be directly executed via Jupyter Notebook.
The stdout, stderr and results will be returned as a JSON object.
Subsequent calls to the tool will keep the state of the interpreter.`,
        },
      },
      required: ['code'],
    },
    execute: async ({ code }) => {
      const evaluation = await evaluateCode('', code as string);
      return {
        stdout: evaluation.stdout,
        stderr: evaluation.stderr,
        ...(evaluation.error && {
          error: {
            traceback: evaluation.error.traceback,
            name: evaluation.error.name,
            value: evaluation.error.value,
          }
        }),
        results: evaluation.results.map(t => JSON.parse(JSON.stringify(t))),
      };
    },
  },
];

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body || !Array.isArray(body.messages)) {
    return new Response('Invalid request: messages must be an array', { status: 400 });
  }

  const { messages, sessionID } = body;

  // Validate message structure
  const validMessages = messages.every(
    (msg: unknown) =>
      typeof msg === 'object' &&
      msg !== null &&
      typeof (msg as any).role === 'string' &&
      (typeof (msg as any).content === 'string' || Array.isArray((msg as any).content)),
  );
  if (!validMessages) {
    return new Response('Invalid request: each message must have role (string) and content (string or array)', { status: 400 });
  }

  const model = 'gpt-4-turbo';

  // Convert messages to ModelMessage format
  const modelMessages: ModelMessage[] = messages.map((msg: any) => ({
    role: msg.role,
    content: msg.content,
  }));

  const result = streamText({
    model: openai.chat(model),
    messages: modelMessages,
    tools,
    toolChoice: 'auto',
    async onFinish({ text, toolCalls, toolResults, finishReason }) {
      console.log('completion', text);
    },
  });

  return createTextStreamResponse(result);
}
