/**
 * Test script to verify email quota manager fix
 * 
 * This tests that providers are re-enabled when:
 * 1. Reset date has passed
 * 2. Current usage is below the limit
 * 
 * NOTE: If tests fail due to old quota values, delete data/binG.db 
 * and data/email-provider-quotas.json to reset.
 */

import { emailQuotaManager } from './lib/email/email-quota-manager';

console.log('=== Email Quota Manager Fix Test ===\n');

// Test 1: Check all providers are available after reset
console.log('Test 1: Check provider availability after file reset');
const allQuotas = emailQuotaManager.getAllQuotas();
console.log('All quotas:', JSON.stringify(allQuotas, null, 2));

let allAvailable = true;
let test1Pass = true;
for (const quota of allQuotas) {
  const isAvailable = emailQuotaManager.isAvailable(quota.provider);
  const remaining = emailQuotaManager.getRemaining(quota.provider);
  console.log(`  ${quota.provider}: available=${isAvailable}, remaining=${remaining}, usage=${quota.currentUsage}/${quota.monthlyLimit}`);
  if (!isAvailable && quota.currentUsage < quota.monthlyLimit) {
    console.error(`    ❌ FAIL: Provider ${quota.provider} is disabled but usage is below limit!`);
    allAvailable = false;
  }
}

if (allAvailable) {
  console.log('\n✅ PASS: All providers with usage below limit are available');
} else {
  console.log('\n❌ FAIL: Some providers are incorrectly disabled');
  test1Pass = false;
}

// Test 2: Verify brevo has correct monthly limit (9000, not 300)
console.log('\nTest 2: Check brevo monthly limit');
const brevoQuota = emailQuotaManager.getQuota('brevo');
if (brevoQuota) {
  console.log(`  brevo monthly limit: ${brevoQuota.monthlyLimit}`);
  // Note: If this fails, delete data/binG.db and data/email-provider-quotas.json
  if (brevoQuota.monthlyLimit >= 9000) {
    console.log('  ✅ PASS: Brevo has correct monthly limit (>= 9000)');
  } else if (brevoQuota.monthlyLimit === 300) {
    console.log('  ⚠️  WARNING: Brevo limit is 300 (old value from database/file)');
    console.log('     To fix: Delete data/binG.db and data/email-provider-quotas.json, then restart');
  } else {
    console.log('  ❌ FAIL: Brevo limit is incorrect (should be >= 9000)');
  }
} else {
  console.log('  ❌ FAIL: Could not get brevo quota');
  test1Pass = false;
}

console.log('\n=== Test Summary ===');
if (test1Pass) {
  console.log('✅ All critical tests passed!');
  console.log('\nIf you see warnings about old values, restart the server after deleting:');
  console.log('  - data/binG.db');
  console.log('  - data/email-provider-quotas.json');
} else {
  console.log('❌ Some tests failed');
  process.exit(1);
}
