import { NextRequest, NextResponse } from 'next/server';
import { streamText, generateText } from 'ai';
import { createModelWithFallback } from '@/lib/stateful-agent/agents/provider-fallback';
import { allTools, nangoTools } from '@/lib/stateful-agent/tools';
import { runStatefulAgent } from '@/lib/stateful-agent';
import { runCrewAIWorkflow } from '@/lib/crewai';
import { getSandboxProvider } from '@/lib/sandbox/providers';
import { runAgentLoop } from '@/lib/sandbox/agent-loop';
import { generateSecureId } from '@/lib/utils';
import type { SandboxProviderType } from '@/lib/sandbox/providers';

const USE_STATEFUL_AGENT = process.env.USE_STATEFUL_AGENT === 'true';
const USE_CREWAI = process.env.USE_CREWAI === 'true';
const DEFAULT_SANDBOX_PROVIDER = (process.env.SANDBOX_PROVIDER || 'daytona') as SandboxProviderType;
const MAX_SANDBOX_IDLE = parseInt(process.env.MAX_SANDBOX_IDLE || '300000');

// Combined tools for AI SDK
const combinedTools = {
  ...allTools,
  ...nangoTools,
};

export async function POST(request: NextRequest) {
  const requestId = generateSecureId('agent');

  console.log(
    `[StatefulAgent API] Request ${requestId} - Mode: ${
      USE_CREWAI ? 'CrewAI' : USE_STATEFUL_AGENT ? 'StatefulAgent' : 'Legacy Agent'
    }`,
  );

  let effectiveUseCrewAI = USE_CREWAI;
  let effectiveUseStateful = USE_STATEFUL_AGENT;

  try {
    const body = await request.json();
    
    // Parse and validate maxSteps with upper bound to prevent excessive API calls
    // Default from env, clamped to reasonable maximum (50 steps)
    const envMaxSteps = parseInt(process.env.AI_SDK_MAX_STEPS || '10', 10);
    const userMaxSteps = typeof body.maxSteps === 'number' ? body.maxSteps : envMaxSteps;
    const maxSteps = Math.max(1, Math.min(userMaxSteps, 50)); // Clamp between 1 and 50
    
    const {
      messages,
      sessionId,
      sandboxId,
      provider = 'openai',
      model = 'gpt-4o',
      temperature = 0.7,
      maxTokens = 4000,
      stream = false,
      useStateful = USE_STATEFUL_AGENT,
      useCrewAI = USE_CREWAI,
      enforcePlanActVerify = true,
    } = body;

    effectiveUseCrewAI = useCrewAI;
    effectiveUseStateful = useStateful;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json(
        { error: 'Messages array is required' },
        { status: 400 }
      );
    }

    const lastMessage = messages[messages.length - 1];
    const userMessage = typeof lastMessage.content === 'string'
      ? lastMessage.content
      : lastMessage.content[0]?.text || '';

    // CrewAI mode (opt-in)
    if (useCrewAI) {
      const crewResult = await runCrewAIWorkflow({
        sessionId: sessionId || requestId,
        userMessage,
      });

      return NextResponse.json({
        success: crewResult.success,
        response: crewResult.response,
        steps: crewResult.tasks.length,
        errors: crewResult.errors,
        metadata: {
          agentType: 'crewai',
          process: crewResult.process,
          streamRequested: stream === true,
        },
      });
    }

    // AI SDK streaming mode with tool calling
    if (stream || body.useAI_SDK === true) {
      const preferredProvider = (provider as 'openai' | 'anthropic' | 'google') || 'openai';
      const modelId = model.replace(`${provider}:`, '') || 'gpt-4o';

      const { model: aiModel, provider: actualProvider } = await createModelWithFallback(
        preferredProvider,
        modelId
      );

      const result = streamText({
        model: aiModel,
        messages: messages.map(m => ({
          role: m.role as 'user' | 'assistant' | 'system',
          content: typeof m.content === 'string' ? m.content : m.content[0]?.text || '',
        })),
        tools: combinedTools,
        maxSteps,
        temperature,
        maxTokens,
        onError: ({ error }) => {
          console.error('[StatefulAgent AI SDK] Stream error:', error);
        },
        onFinish: ({ text, toolCalls, toolResults, finishReason }) => {
          console.log('[StatefulAgent AI SDK] Stream completed:', {
            textLength: text?.length || 0,
            toolCallsCount: toolCalls?.length || 0,
            toolResultsCount: toolResults?.length || 0,
            finishReason,
            provider: actualProvider,
          });
        },
        experimental_telemetry: {
          isEnabled: true,
          functionId: 'stateful-agent',
          metadata: {
            sessionId: sessionId || requestId,
            provider: actualProvider,
          },
        },
      });

      return result.toDataStreamResponse({
        sendReasoning: true,
        getErrorMessage: (error) => {
          return error instanceof Error ? error.message : 'Unknown error';
        },
      });
    }

    // Stateful agent mode (existing behavior)
    if (useStateful) {
      let sandboxHandle;

      if (sandboxId) {
        const sandboxProvider = getSandboxProvider(DEFAULT_SANDBOX_PROVIDER);
        sandboxHandle = await sandboxProvider.getSandbox(sandboxId);
      }

      const result = await runStatefulAgent(userMessage, {
        sessionId,
        sandboxHandle,
        enforcePlanActVerify,
        maxSelfHealAttempts: parseInt(process.env.MAX_SELF_HEAL_ATTEMPTS || '3'),
      });

      return NextResponse.json({
        success: result.success,
        response: result.response,
        steps: result.steps,
        errors: result.errors,
        sessionId: result.vfs ? requestId : undefined,
        metadata: {
          agentType: 'stateful',
          workflow: 'plan-act-verify',
          selfHealingAttempts: result.errors.length,
          provider: 'openai',
        },
      });
    }

    // Legacy agent mode
    let targetSandboxId = sandboxId;

    if (!targetSandboxId) {
      const sandboxProvider = getSandboxProvider(DEFAULT_SANDBOX_PROVIDER);
      const sandbox = await sandboxProvider.createSandbox({
        language: 'typescript',
        resources: {
          cpu: 1,
          memory: 512,
        },
      });
      targetSandboxId = sandbox.id;
    }

    const legacyResult = await runAgentLoop({
      userMessage,
      sandboxId: targetSandboxId,
      conversationHistory: messages.slice(0, -1),
    });

    return NextResponse.json({
      success: true,
      response: legacyResult.response,
      steps: legacyResult.totalSteps,
      sandboxId: targetSandboxId,
      metadata: {
        agentType: 'legacy',
        workflow: 'direct-loop',
      },
    });

  } catch (error) {
    console.error(`[StatefulAgent API] Error:`, error);

    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      metadata: {
        agentType: effectiveUseCrewAI ? 'crewai' : effectiveUseStateful ? 'stateful' : 'legacy',
      },
    }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    agentType: USE_CREWAI ? 'crewai' : USE_STATEFUL_AGENT ? 'stateful' : 'legacy',
    features: {
      planActVerify: USE_STATEFUL_AGENT,
      crewAI: USE_CREWAI,
      selfHealing: USE_STATEFUL_AGENT,
      multiModel: process.env.USE_MULTI_MODEL === 'true',
      hitl: process.env.ENABLE_HITL === 'true',
    },
    config: {
      maxSelfHealAttempts: process.env.MAX_SELF_HEAL_ATTEMPTS || '3',
      crewaiProcess: process.env.CREWAI_DEFAULT_PROCESS || 'sequential',
      crewaiAgentsConfig: process.env.CREWAI_AGENTS_CONFIG || 'src/config/agents.yaml',
      architectModel: process.env.ARCHITECT_MODEL || 'claude-sonnet-4-20250514',
      builderModel: process.env.BUILDER_MODEL || 'gpt-5-codex',
      linterModel: process.env.LINTER_MODEL || 'claude-haiku-3-20250711',
    },
  });
}
