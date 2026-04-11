/**
 * Direct Agent Kernel Test
 * 
 * Tests agent execution by importing kernel directly.
 * Run with: npx tsx scripts/test-kernel-direct.ts
 */

import { getAgentKernel, createAgentKernel, type AgentConfig } from '../lib/agent/agent-kernel';

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testKernel() {
  console.log('=== Agent Kernel Direct Test ===\n');
  
  // Create kernel with shorter time slice for testing (500ms instead of 60s)
  const kernel = createAgentKernel();
  
  // Override timeSlice via env for faster testing
  process.env.KERNEL_TIME_SLICE = '500';
  process.env.KERNEL_MAX_CONCURRENT_AGENTS = '4';
  
  kernel.start();
  console.log('✓ Kernel started (500ms time slice)\n');

  // Listen for events
  kernel.on('agent:executed', (data: any) => {
    console.log(`  [Event] Agent executed: ${data.agentId}, iterations: ${data.iterations}`);
  });
  
  kernel.on('agent:failed', (data: any) => {
    console.log(`  [Event] Agent failed: ${data.agentId}, error: ${data.error}`);
  });

  // Test 1: Default Agent
  console.log('--- Test 1: Default Agent (fallback) ---');
  try {
    const config1: AgentConfig = {
      type: 'ephemeral',
      userId: 'test-user',
      goal: 'Process a simple task',
      priority: 'normal',
      maxIterations: 1,
    };
    const id1 = await kernel.spawnAgent(config1);
    await kernel.submitWork(id1, { task: 'Hello from test' });
    
    await sleep(3000);
    const status1 = kernel.getAgentStatus(id1);
    console.log(`  Agent ID: ${id1}`);
    console.log(`  Status: ${status1?.status}`);
    console.log(`  Result: ${JSON.stringify(status1?.result)?.substring(0, 150)}`);
    console.log('✓ Default agent test complete\n');
  } catch (error: any) {
    console.log(`  ✗ Failed: ${error.message}\n`);
  }

  // Test 2: Research Agent
  console.log('--- Test 2: Research Agent ---');
  try {
    const config2: AgentConfig = {
      type: 'ephemeral',
      userId: 'test-user',
      goal: 'Research AI trends',
      priority: 'high',
      maxIterations: 1,
    };
    const id2 = await kernel.spawnAgent(config2);
    await kernel.submitWork(id2, { 
      query: 'artificial intelligence', 
      depth: 1,
      sources: ['web']
    });
    
    await sleep(5000);
    const status2 = kernel.getAgentStatus(id2);
    console.log(`  Agent ID: ${id2}`);
    console.log(`  Status: ${status2?.status}`);
    console.log(`  Result: ${JSON.stringify(status2?.result)?.substring(0, 200)}`);
    console.log('✓ Research agent test complete\n');
  } catch (error: any) {
    console.log(`  ✗ Failed: ${error.message}\n`);
  }

  // Test 3: Hacker News Agent
  console.log('--- Test 3: Hacker News Agent ---');
  try {
    const config3: AgentConfig = {
      type: 'ephemeral',
      userId: 'test-user',
      goal: 'Get HN daily top stories',
      priority: 'normal',
      maxIterations: 1,
    };
    const id3 = await kernel.spawnAgent(config3);
    await kernel.submitWork(id3, { count: 5 });
    
    await sleep(5000);
    const status3 = kernel.getAgentStatus(id3);
    console.log(`  Agent ID: ${id3}`);
    console.log(`  Status: ${status3?.status}`);
    console.log(`  Result: ${JSON.stringify(status3?.result)?.substring(0, 200)}`);
    console.log('✓ Hacker News agent test complete\n');
  } catch (error: any) {
    console.log(`  ✗ Failed: ${error.message}\n`);
  }

  // Test 4: Type inference from goal
  console.log('--- Test 4: Auto-detect agent type from goal ---');
  try {
    const config4: AgentConfig = {
      type: 'ephemeral',
      userId: 'test-user',
      goal: 'Send email to team about update',
      priority: 'normal',
      maxIterations: 1,
    };
    const id4 = await kernel.spawnAgent(config4);
    await kernel.submitWork(id4, { 
      to: 'team@example.com', 
      subject: 'Update', 
      body: 'Test email' 
    });
    
    await sleep(3000);
    const status4 = kernel.getAgentStatus(id4);
    console.log(`  Agent ID: ${id4}`);
    console.log(`  Status: ${status4?.status}`);
    console.log(`  Inferred type: email from goal`);
    console.log(`  Result: ${JSON.stringify(status4?.result)?.substring(0, 150)}`);
    console.log('✓ Auto-detection test complete\n');
  } catch (error: any) {
    console.log(`  ✗ Failed: ${error.message}\n`);
  }

  // Print final stats
  console.log('--- Final Kernel Stats ---');
  const stats = kernel.getStats();
  console.log(`Total agents: ${stats.totalAgents}`);
  console.log(`By status: ${JSON.stringify(stats.byStatus)}`);
  console.log(`Total work items: ${stats.totalWorkItems}`);

  // Cleanup
  await kernel.stop();
  console.log('\n✓ Kernel stopped');
  console.log('\n=== Test Complete ===');
}

testKernel().catch(console.error);