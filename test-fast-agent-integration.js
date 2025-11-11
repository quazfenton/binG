#!/usr/bin/env node

/**
 * Test script for fast-agent integration
 * Tests both fast-agent routing and fallback to original system
 */

const fetch = require('node-fetch');

const API_BASE = 'http://localhost:3000/api';
const CHAT_ENDPOINT = `${API_BASE}/chat`;

// Test cases
const testCases = [
  {
    name: 'Advanced Tool Request (should route to fast-agent)',
    request: {
      messages: [
        {
          role: 'user',
          content: 'Create a Python script that reads a CSV file and generates a report with charts'
        }
      ],
      provider: 'openai',
      model: 'gpt-4',
      stream: false
    },
    expectFastAgent: true
  },
  {
    name: 'File Operation Request (should route to fast-agent)',
    request: {
      messages: [
        {
          role: 'user',
          content: 'Save this data to a JSON file and create a backup in the uploads directory'
        }
      ],
      provider: 'openai',
      model: 'gpt-4',
      stream: false
    },
    expectFastAgent: true
  },
  {
    name: 'Agent Chaining Request (should route to fast-agent)',
    request: {
      messages: [
        {
          role: 'user',
          content: 'Create a multi-step workflow to process user data through validation, transformation, and storage'
        }
      ],
      provider: 'openai',
      model: 'gpt-4',
      stream: false
    },
    expectFastAgent: true
  },
  {
    name: 'Regular Chat (should use original system)',
    request: {
      messages: [
        {
          role: 'user',
          content: 'What is the capital of France?'
        }
      ],
      provider: 'openai',
      model: 'gpt-4',
      stream: false
    },
    expectFastAgent: false
  },
  {
    name: 'Simple Question (should use original system)',
    request: {
      messages: [
        {
          role: 'user',
          content: 'Explain quantum physics in simple terms'
        }
      ],
      provider: 'openai',
      model: 'gpt-4',
      stream: false
    },
    expectFastAgent: false
  }
];

async function runTest(testCase) {
  console.log(`\n🧪 Testing: ${testCase.name}`);
  console.log(`Expected routing: ${testCase.expectFastAgent ? 'fast-agent' : 'original system'}`);
  
  try {
    const response = await fetch(CHAT_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(testCase.request)
    });

    if (!response.ok) {
      console.log(`❌ HTTP Error: ${response.status} ${response.statusText}`);
      const errorText = await response.text();
      console.log(`Error details: ${errorText}`);
      return false;
    }

    const result = await response.json();
    
    // Check if response came from fast-agent
    const isFromFastAgent = result.source === 'fast-agent';
    
    console.log(`📊 Response source: ${result.source || 'original'}`);
    console.log(`✅ Content length: ${result.data?.content?.length || 0} characters`);
    
    // Verify routing expectation
    if (testCase.expectFastAgent === isFromFastAgent) {
      console.log(`✅ Routing correct: ${isFromFastAgent ? 'fast-agent' : 'original system'}`);
      return true;
    } else {
      console.log(`❌ Routing incorrect: expected ${testCase.expectFastAgent ? 'fast-agent' : 'original'}, got ${isFromFastAgent ? 'fast-agent' : 'original'}`);
      return false;
    }
    
  } catch (error) {
    console.log(`❌ Test failed: ${error.message}`);
    return false;
  }
}

async function testFallback() {
  console.log(`\n🔄 Testing Fallback Functionality`);
  console.log(`This test assumes fast-agent server is NOT running to test fallback`);
  
  const fallbackTest = {
    messages: [
      {
        role: 'user',
        content: 'Create a Python script with file operations (should fallback to original system)'
      }
    ],
    provider: 'openai',
    model: 'gpt-4',
    stream: false
  };

  try {
    const response = await fetch(CHAT_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(fallbackTest)
    });

    if (!response.ok) {
      console.log(`❌ Fallback test failed: ${response.status} ${response.statusText}`);
      return false;
    }

    const result = await response.json();
    const isFromOriginal = !result.source || result.source !== 'fast-agent';
    
    if (isFromOriginal) {
      console.log(`✅ Fallback working: Request handled by original system`);
      return true;
    } else {
      console.log(`❌ Fallback not working: Request still handled by fast-agent`);
      return false;
    }
    
  } catch (error) {
    console.log(`❌ Fallback test failed: ${error.message}`);
    return false;
  }
}

async function checkHealth() {
  console.log(`\n🏥 Checking API Health`);
  
  try {
    const response = await fetch(CHAT_ENDPOINT, {
      method: 'GET'
    });

    if (response.ok) {
      const result = await response.json();
      console.log(`✅ API is healthy`);
      console.log(`📋 Available providers: ${result.data?.providers?.map(p => p.id).join(', ') || 'none'}`);
      return true;
    } else {
      console.log(`❌ API health check failed: ${response.status}`);
      return false;
    }
  } catch (error) {
    console.log(`❌ API health check failed: ${error.message}`);
    return false;
  }
}

async function main() {
  console.log('🚀 Fast-Agent Integration Test Suite');
  console.log('=====================================');
  
  // Check API health first
  const isHealthy = await checkHealth();
  if (!isHealthy) {
    console.log('\n❌ API is not healthy. Please start the development server first.');
    process.exit(1);
  }

  let passed = 0;
  let total = testCases.length;

  // Run all test cases
  for (const testCase of testCases) {
    const success = await runTest(testCase);
    if (success) passed++;
  }

  // Test fallback functionality
  console.log('\n' + '='.repeat(50));
  const fallbackSuccess = await testFallback();
  if (fallbackSuccess) {
    passed++;
    total++;
  } else {
    total++;
  }

  // Summary
  console.log('\n' + '='.repeat(50));
  console.log(`📊 Test Results: ${passed}/${total} tests passed`);
  
  if (passed === total) {
    console.log('🎉 All tests passed! Fast-agent integration is working correctly.');
  } else {
    console.log('⚠️  Some tests failed. Check the configuration and fast-agent server.');
  }

  console.log('\n📝 Notes:');
  console.log('- Ensure FAST_AGENT_ENABLED=true in .env');
  console.log('- For routing tests: start fast-agent server on configured endpoint');
  console.log('- For fallback test: stop fast-agent server to test fallback');
  console.log('- Check console logs for detailed routing information');
}

// Run the test suite
main().catch(console.error);
