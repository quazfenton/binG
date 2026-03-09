/**
 * HITL Workflow Examples
 * 
 * Demonstrates usage of the enhanced Human-in-the-Loop workflow system.
 * 
 * @see lib/stateful-agent/human-in-the-loop.ts
 */

import {
  // Workflows
  defaultWorkflow,
  strictWorkflow,
  permissiveWorkflow,
  getWorkflow,
  registerWorkflow,
  getActiveWorkflow,
  
  // Evaluation
  evaluateWorkflow,
  evaluateActiveWorkflow,
  
  // Approval functions
  requireApprovalWithWorkflow,
  createWorkflowApprovalRequest,
  
  // Manager
  createHITLWorkflowManager,
  HITLWorkflowManager,
  
  // Types
  type ApprovalWorkflow,
  type ApprovalRule,
  type ApprovalContext,
  type WorkflowEvaluation,
} from '@/lib/stateful-agent';

/**
 * Example 1: Using the default workflow
 */
export async function exampleDefaultWorkflow() {
  console.log('=== Example 1: Default Workflow ===');
  
  const workflow = getWorkflow('default') || defaultWorkflow;
  console.log('Active workflow:', workflow.name);
  console.log('Rules:', workflow.rules.length);
  
  // Evaluate a shell command
  const shellEval = evaluateWorkflow(
    workflow,
    'execShell',
    { command: 'rm -rf /tmp/cache' },
    { riskLevel: 'high' }
  );
  
  console.log('Shell command requires approval:', shellEval.requiresApproval);
  console.log('Matched rule:', shellEval.matchedRule?.name);
}

/**
 * Example 2: Using workflow manager for stateful execution
 */
export async function exampleWorkflowManager() {
  console.log('=== Example 2: Workflow Manager ===');
  
  const manager = createHITLWorkflowManager(defaultWorkflow);
  
  // Evaluate without executing
  const eval1 = manager.evaluate('writeFile', { path: '.env' }, {
    filePath: '.env',
    riskLevel: 'high'
  });
  
  console.log('Write to .env requires approval:', eval1.requiresApproval);
  
  // Execute with automatic approval handling
  const result = await manager.executeWithApproval(
    'writeFile',
    { path: 'src/app.ts', content: 'console.log("hello")' },
    async () => {
      // Your actual execution logic here
      console.log('Executing file write...');
      return { success: true };
    },
    { filePath: 'src/app.ts' },
    'user-123'
  );
  
  console.log('Execution result:', result);
  
  // Get history
  const history = manager.getHistory(10);
  console.log('Recent evaluations:', history.length);
}

/**
 * Example 3: Creating custom workflow
 */
export function exampleCustomWorkflow() {
  console.log('=== Example 3: Custom Workflow ===');
  
  const customWorkflow: ApprovalWorkflow = {
    id: 'my-custom-workflow',
    name: 'My Custom Workflow',
    type: 'hybrid',
    rules: [
      {
        id: 'block-dangerous-commands',
        name: 'Block Dangerous Commands',
        condition: (toolName, params) => {
          const cmd = params?.command || '';
          return cmd.includes('rm -rf') || cmd.includes('sudo');
        },
        action: 'require_approval',
        timeout: 300000,
        description: 'Require approval for dangerous shell commands',
      },
      {
        id: 'auto-approve-reads',
        name: 'Auto-approve Read Operations',
        condition: (toolName) => ['readFile', 'listFiles'].includes(toolName),
        action: 'auto_approve',
        description: 'Read operations are safe',
      },
    ],
    defaultAction: 'auto_approve',
  };
  
  // Register custom workflow
  registerWorkflow(customWorkflow);
  
  // Use it
  const workflow = getWorkflow('my-custom-workflow');
  if (workflow) {
    const eval1 = evaluateWorkflow(workflow, 'execShell', { command: 'ls -la' });
    console.log('ls -la requires approval:', eval1.requiresApproval);
    
    const eval2 = evaluateWorkflow(workflow, 'execShell', { command: 'rm -rf /' });
    console.log('rm -rf / requires approval:', eval2.requiresApproval);
  }
}

/**
 * Example 4: Using pre-built rules
 */
export async function examplePreBuiltRules() {
  console.log('=== Example 4: Pre-built Rules ===');
  
  // The default workflow already includes these rules:
  // - createShellCommandRule()
  // - createSensitiveFilesRule()
  // - createReadOnlyRule()
  // - createHighRiskFileRule()
  
  const workflow = getActiveWorkflow();
  
  // Test sensitive file rule
  const sensitiveEval = evaluateWorkflow(
    workflow,
    'writeFile',
    { path: '.env', content: 'SECRET=123' },
    { filePath: '.env', riskLevel: 'high' }
  );
  
  console.log('Write to .env:', sensitiveEval.requiresApproval);
  console.log('Matched rule:', sensitiveEval.matchedRule?.name);
  
  // Test read-only rule
  const readEval = evaluateWorkflow(
    workflow,
    'readFile',
    { path: 'src/app.ts' },
    { filePath: 'src/app.ts' }
  );
  
  console.log('Read file auto-approved:', !readEval.requiresApproval);
}

/**
 * Example 5: Workflow-based approval in API route
 */
export async function exampleApiRouteIntegration(
  toolName: string,
  params: any,
  userId: string
) {
  console.log('=== Example 5: API Route Integration ===');
  
  // This is how you'd use it in an API route
  const approvalContext: ApprovalContext = {
    filePath: params?.path,
    riskLevel: params?.command?.includes('sudo') ? 'high' : 'medium',
    userId,
  };
  
  const result = await requireApprovalWithWorkflow(
    toolName,
    params,
    approvalContext,
    userId
  );
  
  if (!result.approved) {
    console.log('Approval denied:', result.reason);
    return { success: false, error: result.reason };
  }
  
  console.log('Approval granted');
  return { success: true };
}

/**
 * Example 6: Switching workflows based on environment
 */
export function exampleEnvironmentWorkflows() {
  console.log('=== Example 6: Environment Workflows ===');
  
  // In development, use permissive workflow
  if (process.env.NODE_ENV === 'development') {
    const workflow = getWorkflow('permissive') || permissiveWorkflow;
    console.log('Dev mode: Using permissive workflow');
    return workflow;
  }
  
  // In production, use strict workflow
  if (process.env.NODE_ENV === 'production') {
    const workflow = getWorkflow('strict') || strictWorkflow;
    console.log('Prod mode: Using strict workflow');
    return workflow;
  }
  
  // Default
  console.log('Using default workflow');
  return defaultWorkflow;
}

/**
 * Example 7: Creating workflow approval request manually
 */
export function exampleManualRequest() {
  console.log('=== Example 7: Manual Approval Request ===');
  
  const { request, evaluation } = createWorkflowApprovalRequest(
    'execShell',
    { command: 'npm install' },
    { riskLevel: 'low' }
  );
  
  console.log('Request type:', request.type);
  console.log('Action:', request.action);
  console.log('Requires approval:', evaluation.requiresApproval);
  console.log('Matched rule:', evaluation.matchedRule?.name);
  
  // You would then send this request to your approval system
  // and use hitlManager.requestInterrupt() to wait for response
}

// Run examples if this file is executed directly
if (require.main === module) {
  console.log('HITL Workflow Examples\n');
  exampleDefaultWorkflow();
  console.log('\n');
  examplePreBuiltRules();
  console.log('\n');
  exampleCustomWorkflow();
  console.log('\n');
  exampleEnvironmentWorkflows();
}
