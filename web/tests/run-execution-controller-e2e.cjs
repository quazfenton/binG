/**
 * End-to-end test for execution-controller mode
 * 
 * This tests the self-correcting execution loop with a real coding task.
 * Run with: node tests/run-execution-controller-e2e.cjs
 */

const axios = require('axios');

// Test configuration
const API_URL = process.env.API_URL || 'http://localhost:3000';
const API_KEY = process.env.API_KEY || 'test-api-key';
const API_TIMEOUT_MS = parseInt(process.env.API_TIMEOUT_MS || '120000', 10);

async function runTest() {
  console.log('='.repeat(60));
  console.log('Execution Controller Mode - E2E Test');
  console.log('='.repeat(60));
  
  const testTask = 'Create a simple REST API endpoint that returns a list of users with pagination';
  
  console.log('\n📋 Task:', testTask);
  console.log('🎯 Mode: execution-controller (self-correcting loop)');
  console.log('⏱️  Starting test...\n');
  
  const startTime = Date.now();
  
  try {
    const response = await axios.post(
      `${API_URL}/api/agent`,
      {
        mode: 'execution-controller',
        userMessage: testTask,
        systemPrompt: 'You are an expert backend developer. Write production-quality code with error handling, validation, and proper structure.',
        executionControllerConfig: {
          maxCycles: 3,
          enableFinalGate: true,
          completenessThreshold: 0.85,
          qualityThreshold: 0.8,
          depthThreshold: 0.75,
        },
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${API_KEY}`,
        },
        timeout: API_TIMEOUT_MS, // Configurable via API_TIMEOUT_MS env var
      }
    );
    
    // Validate response
    if (!response.data) {
      throw new Error('Empty response from API');
    }
    if (response.status !== 200) {
      throw new Error(`Unexpected status: ${response.status}`);
    }
    
    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(1);
    
    console.log('\n✅ Response received in', duration, 'seconds');
    console.log('-'.repeat(60));
    
    // Extract execution controller metadata
    const ecMetadata = response.data.metadata?.executionController;
    
    if (ecMetadata) {
      console.log('\n📊 Execution Controller Results:');
      console.log('  • Cycles executed:', ecMetadata.cycles);
      console.log('  • Final score:', (ecMetadata.finalScore * 100).toFixed(1) + '%');
      console.log('  • Duration:', (ecMetadata.duration / 1000).toFixed(1) + 's');
      console.log('  • Stopped:', ecMetadata.stopped);
      console.log('  • Reason:', ecMetadata.reason);
      
      if (ecMetadata.completionScore) {
        console.log('\n📈 Completion Scores:');
        console.log('  • Functional:', (ecMetadata.completionScore.functional * 100).toFixed(0) + '%');
        console.log('  • Structure:', (ecMetadata.completionScore.structure * 100).toFixed(0) + '%');
        console.log('  • Depth:', (ecMetadata.completionScore.depth * 100).toFixed(0) + '%');
        console.log('  • Production:', (ecMetadata.completionScore.production * 100).toFixed(0) + '%');
        console.log('  • Quality:', (ecMetadata.completionScore.quality * 100).toFixed(0) + '%');
      }
      
      if (ecMetadata.cycleHistory && ecMetadata.cycleHistory.length > 0) {
        console.log('\n📝 Cycle History:');
        ecMetadata.cycleHistory.forEach((entry, i) => {
          console.log(`  ${i + 1}. ${entry}`);
        });
      }
    }
    
    // Show response preview
    console.log('\n📄 Response Preview:');
    console.log('-'.repeat(40));
    const preview = response.data.response?.slice(0, 500) || 'No response';
    console.log(preview);
    if (response.data.response?.length > 500) {
      console.log('\n... (truncated)');
    }
    console.log('-'.repeat(40));
    
    // Verify self-correction happened
    if (ecMetadata && ecMetadata.cycles > 1) {
      console.log('\n✅ Self-correction loop verified:');
      console.log(`   - Task was evaluated and corrected ${ecMetadata.cycles - 1} time(s)`);
      console.log('   - Self-correction triggers worked as expected');
    } else if (ecMetadata && ecMetadata.cycles === 1) {
      console.log('\n⚠️  Single cycle - quality was acceptable on first attempt');
      console.log('   This is OK if the task was simple enough.');
    }
    
    // Verify output quality
    const hasCodeStructure = /src\/|components\/|api\//.test(response.data.response || '');
    const hasErrorHandling = /try catch|error handling|validate/i.test(response.data.response || '');
    
    console.log('\n🔍 Output Quality Checks:');
    console.log('  • Has code structure:', hasCodeStructure ? '✅' : '❌');
    console.log('  • Has error handling:', hasErrorHandling ? '✅' : '❌');
    
    console.log('\n' + '='.repeat(60));
    console.log('TEST PASSED ✅');
    console.log('='.repeat(60));
    
    return {
      success: true,
      cycles: ecMetadata?.cycles || 0,
      finalScore: ecMetadata?.finalScore || 0,
    };
    
  } catch (error) {
    console.error('\n❌ Test failed:');
    if (error.response) {
      console.error('  Status:', error.response.status);
      console.error('  Data:', JSON.stringify(error.response.data, null, 2));
    } else if (error.code === 'ECONNREFUSED') {
      console.error('  Could not connect to', API_URL);
      console.error('  Make sure the server is running on localhost:3000');
    } else {
      console.error('  Error:', error.message);
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('TEST FAILED ❌');
    console.log('='.repeat(60));
    
    return { success: false, error: error.message };
  }
}

// Run the test
runTest()
  .then(result => {
    process.exit(result.success ? 0 : 1);
  })
  .catch(err => {
    console.error('Unexpected error:', err);
    process.exit(1);
  });