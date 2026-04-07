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
  const { messages, sessionID } = await req.json();

  const model = 'gpt-4-turbo';

  // Convert messages to ModelMessage format
  const modelMessages: ModelMessage[] = messages.map((msg: unknown) => ({
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
