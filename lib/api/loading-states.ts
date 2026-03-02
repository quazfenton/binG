/**
 * Advanced UX Loading States with Dynamic Messaging
 * Provides contextual loading messages and progress indicators
 */

export interface LoadingState {
  phase: string;
  message: string;
  progress?: number;
  estimatedDuration?: number;
  canCancel?: boolean;
}

export interface LoadingConfig {
  enabled: boolean;
  rotationInterval: number;
  showProgress: boolean;
  showEstimates: boolean;
  contextualMessages: boolean;
}

class LoadingStateManager {
  private config: LoadingConfig;
  private currentState: LoadingState | null = null;
  private messageRotationTimer: NodeJS.Timeout | null = null;
  private phaseStartTime: number = 0;

  // Contextual message pools
  private messagePool = {
    analyzing: [
      "Analyzing your request...",
      "Understanding the complexity...",
      "Evaluating the best approach...",
      "Processing requirements...",
      "Determining optimal strategy..."
    ],
    processing: [
      "Working on your request...",
      "Generating high-quality response...",
      "Applying advanced techniques...",
      "Optimizing the solution...",
      "Crafting detailed response..."
    ],
    reflecting: [
      "Reviewing for quality...",
      "Checking accuracy and completeness...",
      "Applying multiple perspectives...",
      "Enhancing response quality...",
      "Performing quality assurance..."
    ],
    tools: [
      "Executing tools and functions...",
      "Accessing external resources...",
      "Processing file operations...",
      "Running specialized tools...",
      "Integrating tool results..."
    ],
    chaining: [
      "Coordinating multiple agents...",
      "Orchestrating workflow steps...",
      "Managing agent interactions...",
      "Synchronizing parallel processes...",
      "Combining agent outputs..."
    ],
    finalizing: [
      "Finalizing response...",
      "Applying finishing touches...",
      "Preparing final output...",
      "Completing quality checks...",
      "Ready to deliver..."
    ]
  };

  // Phase duration estimates (in seconds)
  private phaseDurations = {
    analyzing: 3,
    processing: 15,
    reflecting: 8,
    tools: 12,
    chaining: 20,
    finalizing: 5
  };

  constructor() {
    this.config = {
      enabled: process.env.FAST_AGENT_LOADING_STATES !== 'false',
      rotationInterval: parseInt(process.env.FAST_AGENT_MESSAGE_ROTATION || '3000'),
      showProgress: process.env.FAST_AGENT_SHOW_PROGRESS !== 'false',
      showEstimates: process.env.FAST_AGENT_SHOW_ESTIMATES !== 'false',
      contextualMessages: process.env.FAST_AGENT_CONTEXTUAL_MESSAGES !== 'false'
    };
  }

  /**
   * Start a loading phase with contextual messaging
   */
  startPhase(phase: keyof typeof this.messagePool, context?: Record<string, any>): LoadingState {
    if (!this.config.enabled) {
      return { phase, message: 'Processing...' };
    }

    this.phaseStartTime = Date.now();
    
    const messages = this.getContextualMessages(phase, context);
    const estimatedDuration = this.phaseDurations[phase] || 10;
    
    this.currentState = {
      phase,
      message: messages[0],
      progress: 0,
      estimatedDuration: this.config.showEstimates ? estimatedDuration : undefined,
      canCancel: phase !== 'finalizing'
    };

    // Start message rotation
    if (messages.length > 1) {
      this.startMessageRotation(messages);
    }

    return { ...this.currentState };
  }

  /**
   * Update progress for current phase
   */
  updateProgress(progress: number, customMessage?: string): LoadingState | null {
    if (!this.currentState) return null;

    this.currentState.progress = Math.min(100, Math.max(0, progress));
    
    if (customMessage) {
      this.currentState.message = customMessage;
    }

    return { ...this.currentState };
  }

  /**
   * End current loading phase
   */
  endPhase(): void {
    if (this.messageRotationTimer) {
      clearInterval(this.messageRotationTimer);
      this.messageRotationTimer = null;
    }
    this.currentState = null;
  }

  /**
   * Get contextual messages based on phase and context
   */
  private getContextualMessages(phase: keyof typeof this.messagePool, context?: Record<string, any>): string[] {
    let messages = [...this.messagePool[phase]];

    if (!this.config.contextualMessages || !context) {
      return messages;
    }

    // Add contextual messages based on request characteristics
    if (context.hasCode && phase === 'processing') {
      messages.push(
        "Generating optimized code...",
        "Applying best practices...",
        "Ensuring code quality..."
      );
    }

    if (context.hasFiles && phase === 'tools') {
      messages.push(
        "Processing file operations...",
        "Managing file system tasks...",
        "Handling data transformations..."
      );
    }

    if (context.isComplex && phase === 'processing') {
      messages.push(
        "Handling complex requirements...",
        "Breaking down into manageable steps...",
        "Applying advanced algorithms..."
      );
    }

    if (context.multiModal && phase === 'processing') {
      messages.push(
        "Processing multimodal content...",
        "Handling diverse media types...",
        "Integrating multimedia elements..."
      );
    }

    return messages;
  }

  /**
   * Start rotating through messages
   */
  private startMessageRotation(messages: string[]): void {
    let currentIndex = 0;
    
    this.messageRotationTimer = setInterval(() => {
      if (!this.currentState) return;
      
      currentIndex = (currentIndex + 1) % messages.length;
      this.currentState.message = messages[currentIndex];
    }, this.config.rotationInterval);
  }

  /**
   * Get estimated total duration for a request
   */
  estimateTotalDuration(phases: string[], context?: Record<string, any>): number {
    let totalDuration = 0;
    
    phases.forEach(phase => {
      const baseDuration = this.phaseDurations[phase as keyof typeof this.phaseDurations] || 10;
      let multiplier = 1;
      
      // Adjust based on context
      if (context?.isComplex) multiplier *= 1.5;
      if (context?.hasReflection) multiplier *= 1.3;
      if (context?.multiModal) multiplier *= 1.2;
      
      totalDuration += baseDuration * multiplier;
    });
    
    return Math.round(totalDuration);
  }

  /**
   * Create loading state for streaming responses
   */
  createStreamingState(phase: string, progress: number): {
    event: string;
    data: string;
  } {
    const state = this.updateProgress(progress);
    
    return {
      event: 'loading',
      data: JSON.stringify({
        phase: state?.phase || phase,
        message: state?.message || 'Processing...',
        progress: state?.progress || progress,
        estimatedDuration: state?.estimatedDuration,
        canCancel: state?.canCancel || false,
        timestamp: Date.now()
      })
    };
  }

  /**
   * Get current loading state
   */
  getCurrentState(): LoadingState | null {
    return this.currentState ? { ...this.currentState } : null;
  }

  /**
   * Check if loading states are enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Get configuration
   */
  getConfig(): LoadingConfig {
    return { ...this.config };
  }
}

export const loadingStateManager = new LoadingStateManager();
