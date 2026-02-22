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
    this.genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!)
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

      // Handle parallel tool calls - Gemini can return multiple functionCall parts
      const functionCallParts = content.parts?.filter((p: any) => p.functionCall) ?? []
      
      if (functionCallParts.length === 0) {
        const textResponse = content.parts
          ?.filter((p: any) => p.text)
          .map((p: any) => p.text)
          .join('\n')
        return { response: textResponse || '', steps, totalSteps: step + 1 }
      }

      // Process all function calls sequentially
      const responseParts = []
      for (const part of functionCallParts) {
        const { name, args } = part.functionCall
        let toolResult: ToolResult
        
        try {
          toolResult = await executeTool(name, args)
        } catch (err) {
          // Handle tool execution errors gracefully
          toolResult = {
            success: false,
            output: `Tool execution failed: ${err instanceof Error ? err.message : String(err)}`,
            exitCode: 1,
          }
        }

        steps.push({ toolName: name, args, result: toolResult })
        onToolExecution?.(name, args, toolResult)
        
        responseParts.push({
          functionResponse: {
            name,
            response: {
              result: toolResult.output,
              exitCode: toolResult.exitCode,
              success: toolResult.success,
            },
          },
        })
      }
      
      history.push({
        role: 'user',  // Gemini SDK requires function responses to be sent as role: "user"
        parts: responseParts,
      })
    }

    return {
      response: 'Agent reached maximum execution steps. Partial work may be complete.',
      steps,
      totalSteps: maxSteps,
    }
  }
}
