/**
 * Complete Example: Enhanced Technical Code Response System
 *
 * This example demonstrates all major features of the enhanced code system:
 * - Multiple processing modes (streaming, agentic, hybrid, standard)
 * - Advanced file management with diff handling
 * - Event-driven workflows and monitoring
 * - Quality assessment and iterative improvement
 * - Error handling and recovery
 * - Custom agent configurations
 * - Real-time progress tracking
 */

import { EventEmitter } from 'events';
import { EnhancedCodeOrchestrator } from '../enhanced-code-orchestrator';
import { ProjectItem } from '../core/enhanced-prompt-engine';

// Sample project files for demonstration
const sampleProjectFiles: ProjectItem[] = [
  {
    id: 'auth-component',
    name: 'AuthComponent.tsx',
    path: 'src/components/AuthComponent.tsx',
    content: `import React from 'react';

export interface AuthComponentProps {
  onLogin?: (user: any) => void;
  onLogout?: () => void;
}

export const AuthComponent: React.FC<AuthComponentProps> = ({ onLogin, onLogout }) => {
  // TODO: Implement authentication logic
  return (
    <div>
      <h2>Authentication</h2>
      {/* TODO: Add login form */}
    </div>
  );
};`,
    language: 'typescript',
    hasEdits: false,
    lastModified: new Date()
  },
  {
    id: 'auth-service',
    name: 'authService.ts',
    path: 'src/services/authService.ts',
    content: `// Authentication service
export class AuthService {
  // TODO: Implement authentication methods
}`,
    language: 'typescript',
    hasEdits: false,
    lastModified: new Date()
  },
  {
    id: 'user-types',
    name: 'types.ts',
    path: 'src/types/user.ts',
    content: `// User-related type definitions
export interface User {
  id: string;
  // TODO: Add user properties
}`,
    language: 'typescript',
    hasEdits: false,
    lastModified: new Date()
  }
];

class EnhancedCodeSystemDemo {
  private orchestrator: EnhancedCodeOrchestrator;
  private sessionResults: Map<string, any> = new Map();

  constructor() {
    // Initialize orchestrator with comprehensive configuration
    this.orchestrator = new EnhancedCodeOrchestrator({
      mode: 'hybrid',
      enableStreaming: true,
      enableAgenticFrameworks: true,
      enableFileManagement: true,
      enableAutoWorkflows: true,
      maxConcurrentSessions: 3,
      defaultTimeoutMs: 120000,
      qualityThreshold: 0.8,
      maxIterations: 5,
      contextOptimization: true,
      errorRecovery: true,

      promptEngineering: {
        depthLevel: 8,
        verbosityLevel: 'verbose',
        includeDocumentation: true,
        includeTestCases: true,
        includeOptimization: true
      },

      streamingConfig: {
        chunkSize: 1000,
        maxTokens: 32000,
        enablePartialValidation: true
      },

      agenticConfig: {
        defaultFramework: 'crewai',
        maxAgents: 5,
        collaborationMode: 'sequential'
      }
    });

    this.setupEventHandlers();
  }

  /**
   * Set up comprehensive event handlers for monitoring and control
   */
  private setupEventHandlers(): void {
    // Session lifecycle events
    this.orchestrator.on('session_started', (data) => {
      console.log('🚀 Session started:', {
        sessionId: data.sessionId,
        mode: data.mode,
        fileCount: data.fileCount,
        taskComplexity: data.taskComplexity
      });
    });

    this.orchestrator.on('session_progress', (progress) => {
      console.log(`📊 Progress: ${progress.progress.toFixed(1)}% - ${progress.currentStep}`);
      if (progress.estimatedTimeRemaining) {
        console.log(`⏱️  Estimated time remaining: ${Math.round(progress.estimatedTimeRemaining / 1000)}s`);
      }
    });

    this.orchestrator.on('session_completed', (result) => {
      console.log('✅ Session completed successfully:', {
        sessionId: result.sessionId,
        duration: `${result.duration}ms`,
        qualityScore: result.qualityScore?.toFixed(3)
      });

      this.sessionResults.set(result.sessionId, result);
      this.displayResults(result);
    });

    this.orchestrator.on('session_failed', (error) => {
      console.error('❌ Session failed:', {
        sessionId: error.sessionId,
        error: error.error,
        status: error.state.status
      });
    });

    this.orchestrator.on('session_recovered', (recovery) => {
      console.log('🔄 Session recovered:', {
        sessionId: recovery.sessionId,
        partialResults: Object.keys(recovery.partialResults)
      });
    });

    // Streaming events
    this.orchestrator.on('chunk_processed', (data) => {
      const preview = data.assembledContent.length > 100
        ? data.assembledContent.substring(0, 100) + '...'
        : data.assembledContent;

      console.log(`🌊 Chunk processed: ${data.chunk.sequenceNumber} (${preview})`);
    });

    this.orchestrator.on('streaming_error', (error) => {
      console.error('🌊❌ Streaming error:', error);
    });

    // File management events
    this.orchestrator.on('diffs_pending_approval', async (data) => {
      console.log('📝 Diffs pending approval:', {
        fileId: data.fileId,
        diffCount: data.diffs.length
      });

      // Auto-approve diffs with high confidence
      const autoApprove = data.diffs.every(diff =>
        diff.confidence && diff.confidence > 0.9 && diff.operation !== 'delete'
      );

      if (autoApprove) {
        console.log('✨ Auto-approving high-confidence diffs');
        // In a real implementation, you would access the file manager
        // await this.orchestrator.getFileManager().handleUserApproval(data.fileId, data.diffs, 'apply');
      } else {
        console.log('🤔 Manual approval required for diffs');
        this.displayDiffsForApproval(data.fileId, data.diffs);
      }
    });

    this.orchestrator.on('auto_file_requested', (request) => {
      console.log('📂 Auto file requested:', {
        currentFile: request.currentFileId,
        nextFile: request.nextFileId,
        reason: request.reason
      });
    });

    // System monitoring events
    this.orchestrator.on('metrics_updated', (metrics) => {
      console.log('📈 System metrics updated:', {
        activeSessions: metrics.activeSessions,
        successRate: `${(metrics.successRate * 100).toFixed(1)}%`,
        avgQuality: metrics.averageQualityScore?.toFixed(3)
      });
    });

    this.orchestrator.on('maintenance_completed', (data) => {
      console.log('🧹 Maintenance completed:', {
        cleanedSessions: data.cleanedSessions,
        activeSessions: data.activeSessions
      });
    });
  }

  /**
   * Demo 1: Standard Mode - Simple component enhancement
   */
  async demoStandardMode(): Promise<string> {
    console.log('\n=== Demo 1: Standard Mode ===');

    const sessionId = await this.orchestrator.startSession({
      task: "Enhance the AuthComponent with proper form handling, validation, and error states",
      files: [sampleProjectFiles[0]], // Just the auth component
      options: {
        mode: 'standard',
        priority: 'medium',
        requireApproval: false,
        enableDiffs: true,
        contextHints: ['form validation', 'error handling', 'TypeScript']
      }
    });

    return sessionId;
  }

  /**
   * Demo 2: Streaming Mode - Complex component with real-time feedback
   */
  async demoStreamingMode(): Promise<string> {
    console.log('\n=== Demo 2: Streaming Mode ===');

    const sessionId = await this.orchestrator.startSession({
      task: "Create a comprehensive authentication system with login, registration, password reset, and session management",
      files: sampleProjectFiles,
      options: {
        mode: 'streaming',
        priority: 'high',
        expectedOutputSize: 4000,
        requireApproval: true,
        enableDiffs: true,
        contextHints: [
          'JWT tokens',
          'form validation',
          'error handling',
          'responsive design',
          'accessibility',
          'TypeScript',
          'React hooks'
        ]
      }
    });

    return sessionId;
  }

  /**
   * Demo 3: Agentic Mode - Multi-agent collaboration
   */
  async demoAgenticMode(): Promise<string> {
    console.log('\n=== Demo 3: Agentic Mode ===');

    const sessionId = await this.orchestrator.startSession({
      task: "Refactor and secure the authentication system with enterprise-grade security features",
      files: sampleProjectFiles,
      options: {
        mode: 'agentic',
        priority: 'critical',
        frameworkPreference: 'crewai',
        qualityThreshold: 0.9,
        requireApproval: true,
        enableDiffs: true,
        customAgents: [
          {
            id: 'security-expert',
            role: 'Security Expert',
            goal: 'Implement robust security measures and prevent common vulnerabilities',
            backstory: 'Specialized in authentication security, OAuth, JWT, and OWASP best practices',
            tools: ['security_audit', 'vulnerability_scan', 'crypto_validation'],
            expertise: ['security', 'authentication', 'encryption', 'OWASP'],
            capabilities: {
              codeGeneration: true,
              codeReview: true,
              testing: false,
              debugging: true,
              optimization: false,
              documentation: true
            }
          },
          {
            id: 'architect',
            role: 'Solution Architect',
            goal: 'Design scalable and maintainable authentication architecture',
            backstory: 'Expert in system design patterns and enterprise architecture',
            tools: ['architecture_design', 'pattern_analysis', 'scalability_assessment'],
            expertise: ['architecture', 'design_patterns', 'scalability', 'microservices'],
            capabilities: {
              codeGeneration: true,
              codeReview: true,
              testing: false,
              debugging: false,
              optimization: true,
              documentation: true
            }
          }
        ],
        contextHints: [
          'enterprise security',
          'OAuth 2.0',
          'JWT best practices',
          'rate limiting',
          'audit logging',
          'session management',
          'RBAC',
          'microservices'
        ]
      }
    });

    return sessionId;
  }

  /**
   * Demo 4: Hybrid Mode - Best of streaming and agentic
   */
  async demoHybridMode(): Promise<string> {
    console.log('\n=== Demo 4: Hybrid Mode ===');

    const sessionId = await this.orchestrator.startSession({
      task: "Build a complete user management system with authentication, authorization, user profiles, and admin dashboard",
      files: sampleProjectFiles,
      options: {
        mode: 'hybrid',
        priority: 'high',
        expectedOutputSize: 6000,
        qualityThreshold: 0.85,
        requireApproval: true,
        enableDiffs: true,
        frameworkPreference: 'crewai',
        contextHints: [
          'user management',
          'authentication',
          'authorization',
          'admin dashboard',
          'user profiles',
          'CRUD operations',
          'data validation',
          'responsive UI',
          'accessibility',
          'TypeScript',
          'React',
          'state management'
        ]
      }
    });

    return sessionId;
  }

  /**
   * Demo 5: Complex Workflow - Multi-step development process
   */
  async demoComplexWorkflow(): Promise<string[]> {
    console.log('\n=== Demo 5: Complex Workflow ===');

    const sessionIds: string[] = [];

    // Step 1: Architecture design
    console.log('Step 1: Architecture Design');
    const architectureSession = await this.orchestrator.startSession({
      task: "Design the overall architecture for a scalable user authentication and management system",
      files: [sampleProjectFiles[2]], // Start with types
      options: {
        mode: 'agentic',
        priority: 'high',
        qualityThreshold: 0.9,
        frameworkPreference: 'crewai',
        contextHints: ['system architecture', 'scalability', 'design patterns', 'TypeScript interfaces']
      }
    });
    sessionIds.push(architectureSession);

    // Wait for architecture completion before proceeding
    await this.waitForSessionCompletion(architectureSession);

    // Step 2: Core service implementation
    console.log('Step 2: Core Service Implementation');
    const serviceSession = await this.orchestrator.startSession({
      task: "Implement the core authentication service with all necessary methods",
      files: [sampleProjectFiles[1]], // Auth service
      options: {
        mode: 'streaming',
        priority: 'high',
        expectedOutputSize: 3000,
        contextHints: ['service implementation', 'authentication logic', 'error handling']
      }
    });
    sessionIds.push(serviceSession);

    // Step 3: UI component implementation (parallel)
    console.log('Step 3: UI Component Implementation');
    const componentSession = await this.orchestrator.startSession({
      task: "Create comprehensive authentication UI components with forms and validation",
      files: [sampleProjectFiles[0]], // Auth component
      options: {
        mode: 'hybrid',
        priority: 'medium',
        expectedOutputSize: 2500,
        qualityThreshold: 0.8,
        contextHints: ['React components', 'form handling', 'UI/UX', 'validation']
      }
    });
    sessionIds.push(componentSession);

    return sessionIds;
  }

  /**
   * Demo 6: Error Handling and Recovery
   */
  async demoErrorHandling(): Promise<void> {
    console.log('\n=== Demo 6: Error Handling and Recovery ===');

    // Simulate a problematic session
    try {
      const sessionId = await this.orchestrator.startSession({
        task: "This is an intentionally problematic task that may cause issues",
        files: [], // No files to simulate an error condition
        options: {
          mode: 'agentic',
          timeoutMs: 10000, // Short but valid timeout to force timeout error
          qualityThreshold: 0.99 // Impossibly high threshold
        }
      });

      console.log('Problematic session started:', sessionId);

      // The session should fail and demonstrate recovery
      await this.waitForSessionCompletion(sessionId);

    } catch (error) {
      console.log('Expected error caught:', error.message);
    }
  }

  /**
   * Demo 7: Performance Monitoring
   */
  async demoPerformanceMonitoring(): Promise<void> {
    console.log('\n=== Demo 7: Performance Monitoring ===');

    // Start multiple concurrent sessions to test performance
    const sessionIds = await Promise.all([
      this.orchestrator.startSession({
        task: "Quick component update task 1",
        files: [sampleProjectFiles[0]],
        options: { mode: 'standard' }
      }),
      this.orchestrator.startSession({
        task: "Quick component update task 2",
        files: [sampleProjectFiles[1]],
        options: { mode: 'standard' }
      }),
      this.orchestrator.startSession({
        task: "Quick component update task 3",
        files: [sampleProjectFiles[2]],
        options: { mode: 'standard' }
      })
    ]);

    console.log(`Started ${sessionIds.length} concurrent sessions`);

    // Monitor metrics during execution
    const metricsInterval = setInterval(() => {
      const metrics = this.orchestrator.getMetrics();
      console.log('Current metrics:', {
        activeSessions: metrics.activeSessions,
        completedSessions: metrics.completedSessions,
        successRate: `${(metrics.successRate * 100).toFixed(1)}%`,
        avgResponseTime: `${metrics.performanceMetrics.averageResponseTime}ms`
      });
    }, 2000);

    // Wait for all sessions to complete
    await Promise.all(sessionIds.map(id => this.waitForSessionCompletion(id)));

    clearInterval(metricsInterval);

    console.log('Final system metrics:', this.orchestrator.getMetrics());
  }

  /**
   * Utility method to wait for session completion
   */
  private waitForSessionCompletion(sessionId: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const checkStatus = () => {
        const status = this.orchestrator.getSessionStatus(sessionId);

        if (status?.status === 'completed') {
          resolve(this.orchestrator.getSessionResults(sessionId));
        } else if (status?.status === 'failed' || status?.status === 'cancelled') {
          reject(new Error(`Session ${sessionId} ${status.status}`));
        } else {
          // Still processing, check again in 1 second
          setTimeout(checkStatus, 1000);
        }
      };

      checkStatus();
    });
  }

  /**
   * Display session results in a formatted way
   */
  private displayResults(result: any): void {
    console.log('\n📋 Session Results Summary:');
    console.log('─'.repeat(50));

    if (result.results && result.results.responses) {
      result.results.responses.forEach((response: any, index: number) => {
        console.log(`Response ${index + 1}:`);
        console.log(`  Task: ${response.task}`);
        console.log(`  Workflow State: ${response.workflow_state}`);
        console.log(`  Technical Depth: ${response.technical_depth?.complexity_score}/10`);
        console.log(`  Quality Score: ${response.agentic_metadata?.quality_score?.toFixed(3) || 'N/A'}`);
        console.log(`  Tokens Used: ${response.technical_depth?.estimated_tokens || 'N/A'}`);

        if (response.diffs && response.diffs.length > 0) {
          console.log(`  Diffs Generated: ${response.diffs.length}`);
          response.diffs.forEach((diff: any, diffIndex: number) => {
            console.log(`    ${diffIndex + 1}. ${diff.operation} at lines ${diff.lineRange.join('-')}: ${diff.description}`);
          });
        }

        console.log('');
      });
    }

    console.log('─'.repeat(50));
  }

  /**
   * Display diffs for manual approval
   */
  private displayDiffsForApproval(fileId: string, diffs: any[]): void {
    console.log(`\n📝 Diffs for approval (${fileId}):`);
    console.log('─'.repeat(40));

    diffs.forEach((diff, index) => {
      console.log(`${index + 1}. Operation: ${diff.operation}`);
      console.log(`   Lines: ${diff.lineRange.join(' - ')}`);
      console.log(`   Description: ${diff.description || 'No description'}`);
      console.log(`   Confidence: ${diff.confidence ? (diff.confidence * 100).toFixed(1) + '%' : 'N/A'}`);

      if (diff.preview) {
        console.log(`   Preview: ${diff.preview}`);
      }

      console.log('');
    });

    console.log('─'.repeat(40));
    console.log('In a real application, you would show an approval dialog here.');
  }

  /**
   * Run all demonstrations
   */
  async runAllDemos(): Promise<void> {
    console.log('🎬 Starting Enhanced Code System Demonstrations');
    console.log('=' * 60);

    try {
      // Demo 1: Standard Mode
      const standardSession = await this.demoStandardMode();
      await this.waitForSessionCompletion(standardSession);

      // Demo 2: Streaming Mode
      const streamingSession = await this.demoStreamingMode();
      await this.waitForSessionCompletion(streamingSession);

      // Demo 3: Agentic Mode
      const agenticSession = await this.demoAgenticMode();
      await this.waitForSessionCompletion(agenticSession);

      // Demo 4: Hybrid Mode
      const hybridSession = await this.demoHybridMode();
      await this.waitForSessionCompletion(hybridSession);

      // Demo 5: Complex Workflow
      const workflowSessions = await this.demoComplexWorkflow();
      await Promise.all(workflowSessions.map(id => this.waitForSessionCompletion(id)));

      // Demo 6: Error Handling
      await this.demoErrorHandling();

      // Demo 7: Performance Monitoring
      await this.demoPerformanceMonitoring();

      console.log('\n🎉 All demonstrations completed successfully!');

      // Final system summary
      this.displaySystemSummary();

    } catch (error) {
      console.error('❌ Demo execution failed:', error);
    } finally {
      // Cleanup
      await this.orchestrator.shutdown();
      console.log('🛑 System shutdown completed');
    }
  }

  /**
   * Display final system summary
   */
  private displaySystemSummary(): void {
    const metrics = this.orchestrator.getMetrics();

    console.log('\n📊 Final System Summary:');
    console.log('=' * 50);
    console.log(`Total Sessions: ${metrics.totalSessions}`);
    console.log(`Completed Sessions: ${metrics.completedSessions}`);
    console.log(`Failed Sessions: ${metrics.failedSessions}`);
    console.log(`Success Rate: ${(metrics.successRate * 100).toFixed(1)}%`);
    console.log(`Average Quality Score: ${metrics.averageQualityScore?.toFixed(3) || 'N/A'}`);
    console.log(`Average Session Duration: ${metrics.averageSessionDuration}ms`);

    console.log('\nComponent Usage:');
    console.log(`  Streaming: ${metrics.componentsUsage.streaming} sessions`);
    console.log(`  Agentic: ${metrics.componentsUsage.agentic} sessions`);
    console.log(`  File Management: ${metrics.componentsUsage.fileManagement} sessions`);

    console.log('\nPerformance Metrics:');
    console.log(`  Average Response Time: ${metrics.performanceMetrics.averageResponseTime}ms`);
    console.log(`  Throughput: ${metrics.performanceMetrics.throughput} requests/min`);
    console.log(`  Error Rate: ${(metrics.performanceMetrics.errorRate * 100).toFixed(2)}%`);

    console.log('=' * 50);
  }
}

// Main execution
async function main() {
  const demo = new EnhancedCodeSystemDemo();
  await demo.runAllDemos();
}

// Export for use in other contexts
export { EnhancedCodeSystemDemo };

// Run if executed directly
if (require.main === module) {
  main().catch(console.error);
}
