/**
 * Quality evaluation and scoring
 */

import { retryWithBackoff } from './core.js';

/**
 * Score via n8n webhook (quick synchronous tests)
 */
export async function scoreViaN8N({ text, n8nWebhook, n8nSecret, timeout = 5000 }) {
  if (!n8nWebhook) {
    console.warn('No n8n webhook configured, using heuristic scoring');
    return heuristicScore(text);
  }
  
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (n8nSecret) {
      headers['x-n8n-secret'] = n8nSecret;
    }
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    const response = await fetch(n8nWebhook, {
      method: 'POST',
      headers,
      body: JSON.stringify({ text, type: 'quick-score' }),
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      console.warn(`n8n scoring failed with status ${response.status}`);
      return heuristicScore(text);
    }
    
    const result = await response.json();
    
    // Extract score from various formats
    if (typeof result.passRate === 'number') {
      return Math.max(0, Math.min(1, result.passRate));
    }
    if (typeof result.score === 'number') {
      return Math.max(0, Math.min(1, result.score));
    }
    if (typeof result.passed === 'boolean') {
      return result.passed ? 1 : 0;
    }
    
    return heuristicScore(text);
  } catch (error) {
    console.warn('n8n scoring error:', error.message);
    return heuristicScore(text);
  }
}

/**
 * Heuristic scoring (fallback when n8n unavailable)
 */
export function heuristicScore(text) {
  if (!text || typeof text !== 'string') return 0;
  
  let score = 0.5;
  const length = text.length;
  
  if (length > 50) score += 0.1;
  if (length > 200) score += 0.1;
  
  const patterns = {
    hasFunction: /\b(function|def|const|let|var)\s+\w+/,
    hasClass: /\b(class|interface)\s+\w+/,
    hasComments: /\/\/|\/\*|\#/,
    hasErrorHandling: /\b(try|catch|except|error|Error)\b/,
  };
  
  for (const pattern of Object.values(patterns)) {
    if (pattern.test(text)) score += 0.05;
  }
  
  return Math.max(0, Math.min(1, score));
}

/**
 * Multi-metric evaluation
 */
export async function evaluateMultiMetric(text, config, env) {
  const metrics = { correctness: 0, performance: 0, style: 0 };
  
  if (config.testing?.enableQuickTests && env.N8N_WEBHOOK_QUICK) {
    metrics.correctness = await scoreViaN8N({
      text,
      n8nWebhook: env.N8N_WEBHOOK_QUICK,
      n8nSecret: env.N8N_SECRET,
      timeout: config.testing.quickTestTimeout,
    });
  } else {
    metrics.correctness = heuristicScore(text);
  }
  
  metrics.performance = 0.7;
  metrics.style = 0.7;
  
  const weights = config.quality?.scoreWeights || {
    correctness: 0.4,
    performance: 0.3,
    style: 0.3,
  };
  
  const totalScore = 
    metrics.correctness * weights.correctness +
    metrics.performance * weights.performance +
    metrics.style * weights.style;
  
  return {
    totalScore,
    metrics,
    weights,
    passed: totalScore >= (config.quality?.passThreshold || 0.85),
  };
}
