/**
 * Agent Kernel Test Script
 * 
 * Tests agent execution directly by importing the kernel and running
 * various agent types without requiring the full Next.js server.
 * 
 * Run with: npx tsx scripts/test-kernel-agents.ts
 */

import { getAgentKernel, startAgentKernel, type AgentConfig } from '../lib/agent/agent-kernel';

async function testKernel() {
  console.log('=== Agent Kernel Test Suite ===\n');
  
  // Start kernel
  const kernel = getAgentKernel();
  kernel.start();
  console.log('✓ Kernel started\n');

  // Test 1: Research Agent
  console.log('--- Test 1: Research Agent ---');
  try {
    const researchConfig: AgentConfig = {
      type: 'ephemeral',
      userId: 'test-user',
      goal: 'Research the topic: artificial intelligence trends',
      priority: 'high',
      maxIterations: 1,
    };
    const researchId = await kernel.spawnAgent(researchConfig);
    await kernel.submitWork(researchId, { 
      query: 'AI trends 2024', 
      depth: 2, 
      sources: ['web', 'news'] 
    });
    
    // Wait for execution
    await new Promise(r => setTimeout(r, 5000));
    const researchStatus = kernel.getAgentStatus(researchId);
    console.log(`  Agent ID: ${researchId}`);
    console.log(`  Status: ${researchStatus?.status}`);
    console.log(`  Iterations: ${researchStatus?.iterations}`);
    console.log(`  Result: ${JSON.stringify(researchStatus?.result)?.substring(0, 200)}`);
    console.log('✓ Research agent test complete\n');
  } catch (error: any) {
    console.log(`  ✗ Failed: ${error.message}\n`);
  }

  // Test 2: Hacker News Agent
  console.log('--- Test 2: Hacker News Agent ---');
  try {
    const hnConfig: AgentConfig = {
      type: 'ephemeral',
      userId: 'test-user',
      goal: 'Get Hacker News daily digest',
      priority: 'normal',
      maxIterations: 1,
    };
    const hnId = await kernel.spawnAgent(hnConfig);
    await kernel.submitWork(hnId, { count: 5 });
    
    await new Promise(r => setTimeout(r, 5000));
    const hnStatus = kernel.getAgentStatus(hnId);
    console.log(`  Agent ID: ${hnId}`);
    console.log(`  Status: ${hnStatus?.status}`);
    console.log(`  Iterations: ${hnStatus?.iterations}`);
    console.log('✓ Hacker News agent test complete\n');
  } catch (error: any) {
    console.log(`  ✗ Failed: ${error.message}\n`);
  }

  // Test 3: Email Agent
  console.log('--- Test 3: Email Agent ---');
  try {
    const emailConfig: AgentConfig = {
      type: 'ephemeral',
      userId: 'test-user',
      goal: 'Send email notification',
      priority: 'low',
      maxIterations: 1,
    };
    const emailId = await kernel.spawnAgent(emailConfig);
    await kernel.submitWork(emailId, { 
      to: 'test@example.com', 
      subject: 'Test from Agent Kernel', 
      body: 'Hello from the kernel!' 
    });
    
    await new Promise(r => setTimeout(r, 3000));
    const emailStatus = kernel.getAgentStatus(emailId);
    console.log(`  Agent ID: ${emailId}`);
    console.log(`  Status: ${emailStatus?.status}`);
    console.log(`  Iterations: ${emailStatus?.iterations}`);
    console.log('✓ Email agent test complete\n');
  } catch (error: any) {
    console.log(`  ✗ Failed: ${error.message}\n`);
  }

  // Test 4: Default Agent (fallback)
  console.log('--- Test 4: Default Agent ---');
  try {
    const defaultConfig: AgentConfig = {
      type: 'ephemeral',
      userId: 'test-user',
      goal: 'Process a simple task',
      priority: 'normal',
      maxIterations: 1,
    };
    const defaultId = await kernel.spawnAgent(defaultConfig);
    await kernel.submitWork(defaultId, { task: 'Echo test message' });
    
    await new Promise(r => setTimeout(r, 2000));
    const defaultStatus = kernel.getAgentStatus(defaultId);
    console.log(`  Agent ID: ${defaultId}`);
    console.log(`  Status: ${defaultStatus?.status}`);
    console.log(`  Iterations: ${defaultStatus?.iterations}`);
    console.log(`  Result: ${JSON.stringify(defaultStatus?.result)}`);
    console.log('✓ Default agent test complete\n');
  } catch (error: any) {
    console.log(`  ✗ Failed: ${error.message}\n`);
  }

  // Get final stats
  console.log('--- Kernel Statistics ---');
  const stats = kernel.getStats();
  console.log(`  Total Agents: ${stats.totalAgents}`);
  console.log(`  By Status: ${JSON.stringify(stats.byStatus)}`);
  console.log(`  By Priority: ${JSON.stringify(stats.byPriority)}`);
  console.log(`  Total Work Items: ${stats.totalWorkItems}`);
  console.log('');

  // Cleanup
  await kernel.stop();
  console.log('✓ Kernel stopped');
  console.log('\n=== Test Suite Complete ===');
}

testKernel().catch(console.error);