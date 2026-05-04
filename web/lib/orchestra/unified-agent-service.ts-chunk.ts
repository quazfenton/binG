async function runV1Orchestrated(
  config: UnifiedAgentConfig,
  messages: any[],
  startTime: number
): Promise<UnifiedAgentResult> {
  // === SESSION TRACKING FOR SUCCESSIVE CALLS ===
  const sessionId = config.sessionId || `session-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const feedbackContext: FeedbackContext = {
    sessionId,
    turnNumber: 0,
    accumulatedFeedback: [],
    recentFailures: [],
    corrections: [],
  };

  // Ensure tool system is initialized
  if (!isToolSystemReady()) {
    await initToolSystem({ userId: config.userId || 'system', enableMCP: true, enableSandbox: true });
  }

  // Use shared capability-based tool executor
  const capabilityExecuteTool = createCapabilityToolExecutor(config);

  const orchestratorConfig: OrchestratorConfig = {
    iterationConfig: {
      maxIterations: config.maxSteps || parseInt(process.env.LLM_AGENT_TOOLS_MAX_ITERATIONS || '15', 10),
      maxTokens: config.maxTokens || 32000,
      maxDurationMs: parseInt(process.env.LLM_AGENT_TOOLS_TIMEOUT_MS || '60000', 10),
    },
    tools: config.tools || [],
    executeTool: capabilityExecuteTool,
  };

  const orchestrator = new PlanActVerifyOrchestrator(orchestratorConfig);
  let content = '';
  let firstResponseContent: string | null = null; 
  let stepsCount = 0;
  const steps: any[] = [];

  try {
    for await (const event of orchestrator.execute(config.userMessage, messages)) {
      if (config.onStreamChunk && event.type === 'token') {
        config.onStreamChunk(event.content);
      }

      if (event.type === 'done') {
        content = event.response;
        stepsCount = event.stats?.iterations || 0;
        
        if (!firstResponseContent && content) {
          firstResponseContent = content;
        }
      } else if (event.type === 'tool_result') {
        recordToolCall(sessionId);
        
        steps.push({
          toolName: event.tool,
          args: {},
          result: { success: true, output: JSON.stringify(event.result), exitCode: 0 },
        });

        // Check for re-evaluation trigger
        const reEvalTrigger = checkReEvalTrigger(sessionId);
        if (reEvalTrigger.triggered) {
          log.info('[ReEval-Orchestrated] Trigger detected', { 
            reason: reEvalTrigger.reason,
            recommendedAction: reEvalTrigger.recommendedAction,
          });
          recordReEval(sessionId);
        }
      }
    }

    // Successive tracking and feedback
    const freshTracker = getTracker(sessionId);
    recordResponse(sessionId, content.length, true);
    
    const healingTrigger = detectHealingTrigger(feedbackContext, content, freshTracker.consecutiveToolCalls);
    const injectedFeedback = injectFeedback(feedbackContext);
    const trackerSummary = generateTrackerSummary(sessionId);

    (config as any)._injectedFeedback = injectedFeedback;
    (config as any)._trackerSummary = trackerSummary;

    // ─── First-Response Routing Parsing ───
    const parsedRouting: ParsedRouting = parseFirstResponseRouting(firstResponseContent || content);
    if (parsedRouting.found && parsedRouting.routing) {
      (config as any)._routingMetadata = parsedRouting.routing;
      log.info('[RoutingParser] Parsed routing', {
        classification: parsedRouting.routing.classification,
        role: parsedRouting.routing.suggestedRole,
        continue: parsedRouting.routing.continue,
      });

      if (parsedRouting.routing.continue && parsedRouting.routing.planSteps.length > 0) {
        (config as any)._stepReprompt = generateStepReprompt(parsedRouting.routing, 0);
      }
      
      if (!injectedFeedback.roleRedirectSection && parsedRouting.routing.roleOptions.length > 0) {
        const routingRedirect = routingToRoleRedirectSection(parsedRouting.routing);
        if (routingRedirect) {
          (config as any)._routingRoleRedirect = routingRedirect;
        }
      }
    }

    // Review cycle check
    const reviewCheck = shouldTriggerReview(
      stepsCount,
      (config as any)._routingMetadata?.estimatedSteps || 1,
      freshTracker.consecutiveToolCalls,
      (freshTracker as any).toolCalls || 0,
      1.0 
    );

    if (reviewCheck.trigger) {
      log.warn('[ReviewCycle] Threshold exceeded, triggering review', { reason: reviewCheck.reason });
      (config as any)._reviewTriggered = true;
      (config as any)._reviewReason = reviewCheck.reason;
      (config as any)._reviewSuggestedAction = reviewCheck.suggestedAction;
    }

    // Telemetry and results
    const _orchDefaults = await resolveDynamicDefaults();
    const provider = config.provider || _orchDefaults.provider;
    const model = config.model || _orchDefaults.model;
    const duration = Date.now() - startTime;

    chatRequestLogger.logRequestComplete(
      `unified-v1-orch-${Date.now()}`,
      true,
      undefined,
      duration,
      undefined,
      provider,
      model,
    ).catch(() => {});

    return {
      success: true,
      response: stripRoutingMarkers(content),
      steps,
      totalSteps: stepsCount,
      mode: 'v1-api',
      metadata: {
        provider,
        model,
        duration,
        orchestrator: true,
        routing: (config as any)._routingMetadata ? {
          classification: (config as any)._routingMetadata.classification,
          complexity: (config as any)._routingMetadata.complexity,
          suggestedRole: (config as any)._routingMetadata.suggestedRole,
          continue: (config as any)._routingMetadata.continue,
          reviewTriggered: (config as any)._reviewTriggered || false,
          reviewReason: (config as any)._reviewReason || undefined,
        } : undefined,
      },
    };
  } catch (err: any) {
    invalidateDynamicDefaultsCache();
    const _orchDefaults = await resolveDynamicDefaults();
    const provider = config.provider || _orchDefaults.provider;
    const model = config.model || _orchDefaults.model;
    const duration = Date.now() - startTime;

    chatRequestLogger.logRequestComplete(
      `unified-v1-orch-${Date.now()}`,
      false,
      undefined,
      duration,
      err.message,
      provider,
      model,
    ).catch(() => {});

    throw err;
  }
}
