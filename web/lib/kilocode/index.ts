/**
 * Kilocode - AI-Powered Code Generation Server
 *
 * A comprehensive AI coding assistant that integrates with binG's agent ecosystem.
 * Provides code generation, completion, analysis, refactoring, and review capabilities
 * through a REST API and agent tool integrations.
 *
 * Features:
 * - Multi-language code generation from natural language prompts
 * - Intelligent code completion and suggestions
 * - Code analysis and quality assessment
 * - Automated refactoring and optimization
 * - Code review with detailed feedback
 * - Streaming responses for real-time interaction
 * - Integration with binG's sandbox and filesystem systems
 * - Agent orchestration support
 *
 * Usage:
 * ```typescript
 * import { createKilocodeServer, createKilocodeClient, createKilocodeAgent } from '@bing/kilocode';
 *
 * // Start server
 * const server = await createKilocodeServer({ port: 3001 });
 *
 * // Create client
 * const client = createKilocodeClient({ host: 'localhost', port: 3001 });
 *
 * // Generate code
 * const result = await client.generate({
 *   prompt: 'Create a React component for a todo list',
 *   language: 'typescript'
 * });
 *
 * // Integrate with agent
 * const agent = createKilocodeAgent('my-agent', config);
 * const toolResult = await agent.generateCode(request);
 * ```
 */

export { KilocodeServer, createKilocodeServer } from './kilocode-server';
export { KilocodeHTTPClient, createKilocodeClient, defaultKilocodeConfig } from './client';
export { KilocodeAgent, createKilocodeAgent, executeKilocodeTool, kilocodeMCPTools } from './agent-integration';
export { EnhancedKilocodeAgent, createEnhancedKilocodeAgent } from './enhanced-agent';
export { KiloGatewayClient, createKiloGatewayClient, defaultKiloGatewayConfig } from './kilo-gateway';
export {
  KilocodeVercelSDK,
  KilocodeOpenAISDK,
  KilocodeLangChain,
  createKilocodeVercelSDK,
  createKilocodeOpenAISDK,
  createKilocodeLangChain,
  createKiloOpenAICompatible
} from './sdk-integrations';

export type {
  KilocodeConfig,
  CodeGenerationRequest,
  CodeCompletionRequest,
  CodeAnalysisRequest,
  CodeRefactorRequest,
  CodeReviewRequest,
  KilocodeResponse,
  StreamingResponse,
  CodeSuggestion,
  CodeAnalysisResult,
  RefactorResult,
  CodeReviewResult,
  KilocodeClient,
  KilocodeAgentIntegration,
  ServerStats
} from './types';

export type {
  KiloGatewayConfig,
  ChatMessage,
  ToolCall,
  Tool,
  ChatCompletionRequest,
  ChatCompletionResponse,
  StreamingChoice,
  ChatCompletionStreamResponse
} from './kilo-gateway';

// Re-export for convenience
export default KilocodeServer;