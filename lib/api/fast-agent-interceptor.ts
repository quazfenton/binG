/**
 * Fast-Agent Request Interceptor
 * Intercepts and routes requests to fast-agent before falling back to original system
 */

import { fastAgentService, type FastAgentRequest, type FastAgentResponse } from './fast-agent-service';
import { loadingStateManager } from './loading-states';
import { parameterOptimizer, type OptimizationContext } from './parameter-optimizer';
import type { LLMMessage } from './llm-providers';

export interface InterceptorRequest {
  messages: LLMMessage[];
  provider: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  apiKeys?: Record<string, string>;
  requestId?: string;
}

export interface InterceptorResponse {
  handled: boolean;
  response?: FastAgentResponse;
  shouldFallback: boolean;
  error?: string;
}

class FastAgentInterceptor {
  /**
   * Intercept and potentially handle request with fast-agent using optimization
   */
  async intercept(request: InterceptorRequest): Promise<InterceptorResponse> {
    try {
      // Analyze request context for optimization
      const context = this.analyzeRequestContext(request);
      
      // Get optimized parameters
      const optimizedParams = parameterOptimizer.optimizeParameters(context);
      
      // Convert to fast-agent format with optimization
      const fastAgentRequest: FastAgentRequest = {
        messages: request.messages.map(msg => ({
          role: msg.role as 'user' | 'assistant' | 'system',
          content: msg.content
        })),
        provider: request.provider,
        model: request.model,
        temperature: optimizedParams.temperature,
        maxTokens: optimizedParams.maxTokens,
        requestId: request.requestId,
        qualityMode: optimizedParams.qualityMode,
        taskComplexity: context.complexity,
        enableReflection: optimizedParams.enableReflection,
        stepByStep: optimizedParams.stepByStep,
        multiModal: context.isMultiModal
      };

      // Check if fast-agent should handle this request
      if (!fastAgentService.shouldHandle(fastAgentRequest)) {
        return {
          handled: false,
          shouldFallback: true
        };
      }

      // Perform health check
      const isHealthy = await fastAgentService.healthCheck();
      if (!isHealthy) {
        console.warn('[FastAgent] Service unhealthy, falling back to original system');
        return {
          handled: false,
          shouldFallback: true,
          error: 'Fast-agent service unavailable'
        };
      }

      // Process with fast-agent
      const response = await fastAgentService.processRequest(fastAgentRequest);

      if (response.fallbackToOriginal) {
        return {
          handled: false,
          shouldFallback: true,
          error: response.error
        };
      }

      return {
        handled: true,
        response,
        shouldFallback: false
      };

    } catch (error) {
      console.error('[FastAgent] Interceptor error:', error);
      
      // Always fallback on interceptor errors
      return {
        handled: false,
        shouldFallback: true,
        error: error instanceof Error ? error.message : 'Unknown interceptor error'
      };
    }
  }

  /**
   * Analyze request context for parameter optimization
   */
  private analyzeRequestContext(request: InterceptorRequest): OptimizationContext {
    const lastMessage = request.messages[request.messages.length - 1];
    const content = lastMessage?.content || '';
    
    // Detect task type
    let taskType = 'general';
    if (/\b(code|function|class|programming)\b/i.test(content)) taskType = 'code';
    else if (/\b(file|save|load|data|csv|json)\b/i.test(content)) taskType = 'file';
    else if (/\b(analyze|research|evaluate|study)\b/i.test(content)) taskType = 'analysis';
    else if (/\b(write|create|story|article)\b/i.test(content)) taskType = 'creative';
    else if (/\b(workflow|chain|orchestrate|pipeline)\b/i.test(content)) taskType = 'workflow';

    // Detect complexity
    const wordCount = content.split(/\s+/).length;
    const hasMultipleSteps = /\b(step|then|next|after|phase)\b/gi.test(content);
    const hasComplexTerms = /\b(comprehensive|detailed|thorough|complex)\b/i.test(content);
    
    let complexity: 'simple' | 'moderate' | 'complex' = 'simple';
    if (wordCount > 100 || hasComplexTerms) complexity = 'complex';
    else if (wordCount > 30 || hasMultipleSteps) complexity = 'moderate';

    return {
      taskType,
      complexity,
      contentLength: content.length,
      hasCode: /\b(code|function|class|script)\b/i.test(content),
      hasFiles: /\b(file|save|load|directory)\b/i.test(content),
      hasMultiStep: hasMultipleSteps,
      isMultiModal: /\b(image|video|audio|chart|graph)\b/i.test(content)
    };
  }

  /**
   * Convert fast-agent response to format expected by chat API
   */
  formatResponse(fastAgentResponse: FastAgentResponse, requestId?: string) {
    const response = {
      success: true,
      data: {
        content: fastAgentResponse.content || '',
        usage: {
          promptTokens: 0,
          completionTokens: fastAgentResponse.content?.length || 0,
          totalTokens: fastAgentResponse.content?.length || 0
        },
        model: 'fast-agent',
        provider: 'fast-agent'
      },
      timestamp: new Date().toISOString(),
      source: 'fast-agent'
    };

    // Add tool calls if present
    if (fastAgentResponse.toolCalls?.length) {
      (response.data as any).toolCalls = fastAgentResponse.toolCalls;
    }

    // Add file operations if present
    if (fastAgentResponse.files?.length) {
      (response.data as any).files = fastAgentResponse.files;
    }

    // Add chained agents if present
    if (fastAgentResponse.chainedAgents?.length) {
      (response.data as any).chainedAgents = fastAgentResponse.chainedAgents;
    }

    return response;
  }

  /**
   * Create enhanced streaming response for fast-agent content with multimodal support
   */
  createStreamingResponse(fastAgentResponse: FastAgentResponse, requestId?: string): ReadableStream {
    const encoder = new TextEncoder();
    const content = fastAgentResponse.content || '';
    
    return new ReadableStream({
      start(controller) {
        try {
          const streamId = requestId || `fast-agent-${Date.now()}`;
          
          // Send init event with enhanced metadata
          const initEvent = `event: init\ndata: ${JSON.stringify({
            requestId: streamId,
            startTime: Date.now(),
            provider: 'fast-agent',
            model: 'fast-agent',
            source: 'fast-agent',
            estimatedDuration: fastAgentResponse.estimatedDuration,
            hasSteps: !!fastAgentResponse.processingSteps?.length,
            hasMultiModal: !!fastAgentResponse.multiModalContent?.length,
            qualityMode: 'enhanced'
          })}\n\n`;
          controller.enqueue(encoder.encode(initEvent));

          // Handle step-by-step processing
          if (fastAgentResponse.processingSteps?.length) {
            this.streamProcessingSteps(controller, encoder, fastAgentResponse.processingSteps, streamId);
          }

          // Start loading state if enabled
          if (loadingStateManager.isEnabled()) {
            const loadingState = loadingStateManager.startPhase('processing', {
              hasCode: content.includes('```'),
              hasFiles: !!fastAgentResponse.files?.length,
              isComplex: content.length > 1000,
              multiModal: !!fastAgentResponse.multiModalContent?.length
            });
            
            const loadingEvent = `event: loading\ndata: ${JSON.stringify(loadingState)}\n\n`;
            controller.enqueue(encoder.encode(loadingEvent));
          }

          // Stream main content in intelligent chunks
          this.streamContentIntelligently(controller, encoder, content, streamId);

          // Handle multimodal content
          if (fastAgentResponse.multiModalContent?.length) {
            setTimeout(() => {
              this.streamMultiModalContent(controller, encoder, fastAgentResponse.multiModalContent!, streamId);
            }, 1000);
          }

          // Handle tool calls
          if (fastAgentResponse.toolCalls?.length) {
            setTimeout(() => {
              const toolEvent = `event: tools\ndata: ${JSON.stringify({
                requestId: streamId,
                toolCalls: fastAgentResponse.toolCalls
              })}\n\n`;
              controller.enqueue(encoder.encode(toolEvent));
            }, 500);
          }

          // Handle files
          if (fastAgentResponse.files?.length) {
            setTimeout(() => {
              const filesEvent = `event: files\ndata: ${JSON.stringify({
                requestId: streamId,
                files: fastAgentResponse.files
              })}\n\n`;
              controller.enqueue(encoder.encode(filesEvent));
            }, 800);
          }

          // Handle reflection results
          if (fastAgentResponse.reflectionResults?.length) {
            setTimeout(() => {
              const reflectionEvent = `event: reflection\ndata: ${JSON.stringify({
                requestId: streamId,
                reflections: fastAgentResponse.reflectionResults,
                qualityScore: fastAgentResponse.qualityScore
              })}\n\n`;
              controller.enqueue(encoder.encode(reflectionEvent));
            }, 1200);
          }

          // Final completion
          setTimeout(() => {
            // End loading state
            if (loadingStateManager.isEnabled()) {
              loadingStateManager.endPhase();
            }

            // Send completion event
            const doneEvent = `event: done\ndata: ${JSON.stringify({
              requestId: streamId,
              success: true,
              totalTokens: content.length,
              qualityScore: fastAgentResponse.qualityScore,
              iterationCount: fastAgentResponse.iterationCount,
              source: 'fast-agent'
            })}\n\n`;
            controller.enqueue(encoder.encode(doneEvent));
            
            controller.close();
          }, Math.max(2000, content.length * 20)); // Adaptive timing

        } catch (error) {
          const errorEvent = `event: error\ndata: ${JSON.stringify({
            requestId,
            message: error instanceof Error ? error.message : 'Streaming error',
            source: 'fast-agent'
          })}\n\n`;
          controller.enqueue(encoder.encode(errorEvent));
          controller.close();
        }
      }
    });
  }

  /**
   * Stream content with intelligent chunking based on content type
   */
  private streamContentIntelligently(
    controller: ReadableStreamDefaultController,
    encoder: TextEncoder,
    content: string,
    requestId: string
  ): void {
    // Detect content type for appropriate chunking
    const hasCode = content.includes('```');
    const hasLists = /^\s*[-*+]\s/m.test(content);
    const hasSections = /^#{1,6}\s/m.test(content);
    
    let chunkSize = 30; // Default
    let delay = 80; // Default delay between chunks
    
    // Adjust chunking based on content type
    if (hasCode) {
      chunkSize = 50; // Larger chunks for code
      delay = 60;
    } else if (hasLists || hasSections) {
      chunkSize = 40; // Medium chunks for structured content
      delay = 70;
    }

    let offset = 0;
    const sendChunk = () => {
      if (offset < content.length) {
        // Find natural break points
        let endOffset = Math.min(offset + chunkSize, content.length);
        
        // Try to break at word boundaries
        if (endOffset < content.length) {
          const nextSpace = content.indexOf(' ', endOffset);
          const nextNewline = content.indexOf('\n', endOffset);
          
          if (nextSpace !== -1 && nextSpace - endOffset < 20) {
            endOffset = nextSpace;
          } else if (nextNewline !== -1 && nextNewline - endOffset < 30) {
            endOffset = nextNewline + 1;
          }
        }

        const chunk = content.slice(offset, endOffset);
        const progress = Math.round((endOffset / content.length) * 100);
        
        // Update loading state progress
        if (loadingStateManager.isEnabled()) {
          loadingStateManager.updateProgress(progress);
        }
        
        const tokenEvent = `data: ${JSON.stringify({
          type: "token",
          content: chunk,
          requestId,
          timestamp: Date.now(),
          offset,
          progress,
          source: 'fast-agent'
        })}\n\n`;
        controller.enqueue(encoder.encode(tokenEvent));
        
        offset = endOffset;
        setTimeout(sendChunk, delay);
      }
    };

    // Start streaming with small delay
    setTimeout(sendChunk, 200);
  }

  /**
   * Stream processing steps
   */
  private streamProcessingSteps(
    controller: ReadableStreamDefaultController,
    encoder: TextEncoder,
    steps: Array<{ step: string; status: string; result?: string }>,
    requestId: string
  ): void {
    steps.forEach((step, index) => {
      setTimeout(() => {
        const stepEvent = `event: step\ndata: ${JSON.stringify({
          requestId,
          stepIndex: index,
          step: step.step,
          status: step.status,
          result: step.result,
          timestamp: Date.now()
        })}\n\n`;
        controller.enqueue(encoder.encode(stepEvent));
      }, index * 800);
    });
  }

  /**
   * Stream multimodal content
   */
  private streamMultiModalContent(
    controller: ReadableStreamDefaultController,
    encoder: TextEncoder,
    multiModalContent: Array<{ type: string; content: string; metadata?: any }>,
    requestId: string
  ): void {
    multiModalContent.forEach((item, index) => {
      setTimeout(() => {
        const multiModalEvent = `event: multimodal\ndata: ${JSON.stringify({
          requestId,
          index,
          type: item.type,
          content: item.content,
          metadata: item.metadata,
          timestamp: Date.now()
        })}\n\n`;
        controller.enqueue(encoder.encode(multiModalEvent));
      }, index * 600);
    });
  }

  /**
   * Get interceptor status and configuration
   */
  getStatus() {
    return {
      enabled: fastAgentService.isAvailable(),
      config: fastAgentService.getConfig(),
      lastHealthCheck: Date.now()
    };
  }
}

export const fastAgentInterceptor = new FastAgentInterceptor();
