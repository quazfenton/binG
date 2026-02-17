import { GoogleGenerativeAI } from '@google/generative-ai'
import type { ToolResult } from '../types'
import type {
  LLMProvider,
  LLMAgentOptions,
  LLMAgentResult,
  LLMAgentStep,
} from './llm-provider'

export class GeminiProvider implements LLMProvider {
  readonly name = 'gemini'
  private genAI: GoogleGenerativeAI

  constructor() {
    this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
  }

  async runAgentLoop(options: LLMAgentOptions): Promise<LLMAgentResult> {
    const {
      userMessage,
      conversationHistory,
      tools,
      systemPrompt,
      maxSteps = 15,
      executeTool,
      onToolExecution,
    } = options

    const model = this.genAI.getGenerativeModel({
      model: process.env.GEMINI_MODEL ?? 'gemini-2.5-flash',
      systemInstruction: systemPrompt,
      tools: [{ functionDeclarations: tools as any }],
    })

    const history: any[] = conversationHistory ? [...conversationHistory] : []
    history.push({ role: 'user', parts: [{ text: userMessage }] })

    const steps: LLMAgentStep[] = []

    for (let step = 0; step < maxSteps; step++) {
      const result = await model.generateContent({ contents: history })
      const candidate = result.response.candidates?.[0]
      const content = candidate?.content

      if (!content) break

      history.push({ role: 'model', parts: content.parts })

      const functionCallPart = content.parts?.find((p: any) => p.functionCall)
      if (!functionCallPart?.functionCall) {
        const textResponse = content.parts
          ?.filter((p: any) => p.text)
          .map((p: any) => p.text)
          .join('\n')
        return { response: textResponse || '', steps, totalSteps: step + 1 }
      }

      const { name, args } = functionCallPart.functionCall
      const toolResult = await executeTool(name, args)

      steps.push({ toolName: name, args, result: toolResult })
      onToolExecution?.(name, args, toolResult)

      history.push({
        role: 'function',
        parts: [
          {
            functionResponse: {
              name,
              response: {
                result: toolResult.output,
                exitCode: toolResult.exitCode,
                success: toolResult.success,
              },
            },
          },
        ],
      })
    }

    return {
      response: 'Agent reached maximum execution steps. Partial work may be complete.',
      steps,
      totalSteps: maxSteps,
    }
  }
}
