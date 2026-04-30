/**
 * E2E Test: Execution Controller Self-Correction
 * 
 * This test verifies that the execution-controller mode can:
 * 1. Detect low-quality initial output
 * 2. Trigger self-correction
 * 3. Improve output across multiple cycles
 * 4. Reach production-quality completion
 * 
 * Run with: node tests/test-execution-controller-self-correction.cjs
 * Requires: Server running on localhost:3000
 */

const BASE_URL = process.env.API_URL || 'http://localhost:3000';
const AUTH_EMAIL = process.env.AUTH_EMAIL || 'test@test.com';
const AUTH_PASSWORD = process.env.AUTH_PASSWORD || 'Testing0';
const REQUEST_TIMEOUT_MS = parseInt(process.env.REQUEST_TIMEOUT_MS || '120000', 10);

// ─── Test Configuration ─────────────────────────────────────────────────────

const TEST_CONFIG = {
  // Task designed to require self-correction (starts simple, needs refinement)
  task: 'Create a REST API endpoint for user management with CRUD operations including pagination, filtering, and error handling',
  
  // Execution controller config designed to trigger self-correction
  executionControllerConfig: {
    maxCycles: 4,
    enableFinalGate: true,
    completenessThreshold: 0.85,
    continuityThreshold: 0.7,
    qualityThreshold: 0.8,
    depthThreshold: 0.75,
    minImprovementDelta: 0.02,
    stagnationCycles: 2,
  },
};

// ─── Helper Functions ───────────────────────────────────────────────────────

async function login() {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: AUTH_EMAIL, password: AUTH_PASSWORD }),
  });
  
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Login failed: ${res.status} ${text}`);
  }
  
  const data = await res.json();
  return data?.accessToken || data?.token || '';
}

async function runExecutionController(token, config) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  
  try {
    const res = await fetch(`${BASE_URL}/api/agent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        mode: 'execution-controller',
        userMessage: config.task,
        systemPrompt: 'You are an expert backend developer. Write production-quality code with proper error handling, validation, and documentation.',
        executionControllerConfig: config.executionControllerConfig,
        stream: false,
      }),
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`API call failed: ${res.status} ${text.slice(0, 200)}`);
    }
    
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`Non-JSON response: ${text.slice(0, 200)}`);
    }
  } finally {
    clearTimeout(timeoutId);
  }
}

function analyzeOutputQuality(response) {
  const output = response.response || '';
  const issues = [];
  const passed = [];
  
  // Quality thresholds
  const MIN_FILES = 5;
  const MIN_CRUD_OPS = 3;
  
  // Check file generation
  const filePatterns = [
    /src\//i, /services?\//i, /api\//i, /components?\//i,
    /config/i, /utils?\//i, /models?\//i, /routes?\//i,
  ];
  const filesFound = filePatterns.filter(p => p.test(output)).length;
  
  if (filesFound >= MIN_FILES) {
    passed.push(`✅ File structure: ${filesFound} patterns found`);
  } else {
    issues.push(`❌ File structure: only ${filesFound} patterns (need ${MIN_FILES}+)`);
  }
  
  // Check error handling
  if (/try catch|error handling|try {/i.test(output)) {
    passed.push('✅ Error handling present');
  } else {
    issues.push('❌ No error handling found');
  }
  
  // Check validation
  if (/validate|sanitize|check.*input|verify/i.test(output)) {
    passed.push('✅ Input validation present');
  } else {
    issues.push('❌ No input validation found');
  }
  
  // Check configuration
  if (/config|env|dotenv|tsconfig|package.json/i.test(output)) {
    passed.push('✅ Configuration files present');
  } else {
    issues.push('❌ No configuration files found');
  }
  
  // Check project structure
  if (/(src|lib|components|services|api)\//i.test(output)) {
    passed.push('✅ Proper project structure');
  } else {
    issues.push('❌ No proper project structure');
  }
  
  // Check for placeholders
  if (/TODO|FIXME|placeholder|mock data|sample data/i.test(output)) {
    issues.push('❌ Contains placeholders or TODOs');
  } else {
    passed.push('✅ No placeholders');
  }
  
  // Check for pagination
  if (/pagination|page|limit|offset/i.test(output)) {
    passed.push('✅ Pagination implemented');
  } else {
    issues.push('⚠️  Pagination may be missing');
  }
  
  // Check for CRUD operations
  const crudOps = ['create', 'read', 'update', 'delete'].filter(op => 
    new RegExp(`\\b${op}\\b|${op.toLowerCase()}\\b|GET|POST|PUT|DELETE|PATCH`, 'i').test(output)
  );
  if (crudOps.length >= MIN_CRUD_OPS) {
    passed.push(`✅ CRUD operations: ${crudOps.join(', ')}`);
  } else {
    issues.push(`⚠️  CRUD operations incomplete: ${crudOps.length}/4`);
  }
  
  return { passed, issues };
}

// ─── Main Test ──────────────────────────────────────────────────────────────

async function runTest() {
  console.log('═'.repeat(70));
  console.log('EXECUTION CONTROLLER SELF-CORRECTION E2E TEST');
  console.log('═'.repeat(70));
  
  let token;
  
  try {
    // Step 1: Login
    console.log('\n📋 Step 1: Authenticating...');
    token = await login();
    console.log('   ✅ Authentication successful');
    
    // Step 2: Run execution controller mode
    console.log('\n📋 Step 2: Running execution-controller mode...');
    console.log(`   Task: ${TEST_CONFIG.task.slice(0, 60)}...`);
    console.log(`   Max Cycles: ${TEST_CONFIG.executionControllerConfig.maxCycles}`);
    console.log(`   Final Gate: ${TEST_CONFIG.executionControllerConfig.enableFinalGate ? 'enabled' : 'disabled'}`);
    
    const startTime = Date.now();
    const response = await runExecutionController(token, TEST_CONFIG);
    const duration = (Date.now() - startTime) / 1000;
    
    console.log(`   ✅ Response received in ${duration.toFixed(1)}s`);
    
    // Step 3: Extract execution controller metadata
    console.log('\n📋 Step 3: Analyzing execution controller results...');
    
    const ecMeta = response.metadata?.executionController;
    
    if (!ecMeta) {
      throw new Error('No execution controller metadata in response');
    }
    
    console.log('\n   📊 Execution Controller Metrics:');
    console.log(`      • Cycles executed: ${ecMeta.cycles}`);
    console.log(`      • Final score: ${(ecMeta.finalScore * 100).toFixed(1)}%`);
    console.log(`      • Duration: ${(ecMeta.duration / 1000).toFixed(1)}s`);
    console.log(`      • Stopped: ${ecMeta.stopped ? 'yes' : 'no'}`);
    console.log(`      • Reason: ${ecMeta.reason || 'N/A'}`);
    
    if (ecMeta.completionScore) {
      console.log('\n   📈 Completion Gate Scores:');
      console.log(`      • Functional: ${(ecMeta.completionScore.functional * 100).toFixed(0)}%`);
      console.log(`      • Structure: ${(ecMeta.completionScore.structure * 100).toFixed(0)}%`);
      console.log(`      • Depth: ${(ecMeta.completionScore.depth * 100).toFixed(0)}%`);
      console.log(`      • Production: ${(ecMeta.completionScore.production * 100).toFixed(0)}%`);
      console.log(`      • Quality: ${(ecMeta.completionScore.quality * 100).toFixed(0)}%`);
    }
    
    // Step 4: Verify self-correction occurred
    console.log('\n📋 Step 4: Verifying self-correction behavior...');
    
    const selfCorrectionVerified = ecMeta.cycles > 1;
    
    if (selfCorrectionVerified) {
      console.log(`   ✅ Self-correction verified: ${ecMeta.cycles - 1} correction(s) occurred`);
      
      // Show cycle history
      if (ecMeta.cycleHistory && ecMeta.cycleHistory.length > 0) {
        console.log('\n   📝 Cycle History:');
        ecMeta.cycleHistory.forEach((entry, i) => {
          const triggerMatch = entry.match(/triggered|midpoint/i);
          if (triggerMatch) {
            console.log(`      ${i + 1}. ${entry} ← TRIGGER`);
          } else {
            console.log(`      ${i + 1}. ${entry}`);
          }
        });
      }
    } else {
      console.log('   ⚠️  Single cycle - initial output was already acceptable');
    }
    
    // Step 5: Analyze output quality
    console.log('\n📋 Step 5: Analyzing output quality...');
    
    const quality = analyzeOutputQuality(response);
    
    console.log('\n   ✅ Quality Checks Passed:');
    quality.passed.forEach(msg => console.log(`      ${msg}`));
    
    if (quality.issues.length > 0) {
      console.log('\n   ⚠️  Quality Issues:');
      quality.issues.forEach(msg => console.log(`      ${msg}`));
    }
    
    // Step 6: Verify production readiness
    console.log('\n📋 Step 6: Verifying production readiness...');
    
    const productionChecks = [
      { name: 'Final score >= 80%', pass: ecMeta.finalScore >= 0.8 },
      { name: 'Completion gate functional >= 90%', pass: ecMeta.completionScore?.functional >= 0.9 },
      { name: 'Completion gate quality >= 85%', pass: ecMeta.completionScore?.quality >= 0.85 },
      { name: 'At least 2 cycles executed', pass: ecMeta.cycles >= 2 },
      { name: 'No placeholders in output', pass: !quality.issues.some(i => i.includes('placeholder')) },
    ];
    
    let productionReady = true;
    productionChecks.forEach(check => {
      if (check.pass) {
        console.log(`      ✅ ${check.name}`);
      } else {
        console.log(`      ❌ ${check.name}`);
        productionReady = false;
      }
    });
    
    // Final summary
    console.log('\n' + '═'.repeat(70));
    console.log('TEST RESULTS');
    console.log('═'.repeat(70));
    
    console.log('\n📊 Summary:');
    console.log(`   • Self-correction cycles: ${ecMeta.cycles}`);
    console.log(`   • Final quality score: ${(ecMeta.finalScore * 100).toFixed(1)}%`);
    console.log(`   • Production ready: ${productionReady ? '✅ YES' : '⚠️  PARTIAL'}`);
    console.log(`   • Output length: ${(response.response || '').length} chars`);
    
    // Show response preview
    console.log('\n📄 Response Preview:');
    console.log('-'.repeat(50));
    const preview = (response.response || '').slice(0, 800);
    console.log(preview);
    if ((response.response || '').length > 800) {
      console.log('\n... (truncated)');
    }
    console.log('-'.repeat(50));
    
    if (productionReady) {
      console.log('\n✅ TEST PASSED: Execution controller achieved production-quality output!');
      console.log('═'.repeat(70));
      return { success: true, data: { ecMeta, quality } };
    } else {
      console.log('\n⚠️  TEST PARTIAL: Some production criteria not met.');
      console.log('   The self-correction loop worked, but output needs improvement.');
      console.log('═'.repeat(70));
      return { success: false, data: { ecMeta, quality }, reason: 'Production criteria not met' };
    }
    
  } catch (error) {
    console.error('\n❌ TEST FAILED:', error.message);
    
    if (error.message.includes('ECONNREFUSED')) {
      console.error('   Server not running on', BASE_URL);
      console.error('   Start the server with: pnpm dev');
    } else if (error.message.includes('401') || error.message.includes('Unauthorized')) {
      console.error('   Authentication failed. Check AUTH_EMAIL and AUTH_PASSWORD env vars.');
    } else if (error.name === 'AbortError') {
      console.error(`   Request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`);
    }
    
    console.log('═'.repeat(70));
    return { success: false, error: error.message };
  }
}

// Run if executed directly
runTest()
  .then(result => {
    process.exit(result.success ? 0 : 1);
  })
  .catch(err => {
    console.error('Unexpected error:', err);
    process.exit(1);
  });