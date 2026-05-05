/**
 * app/api/practice/results/route.ts — Practice Results Webhook
 * 
 * Receives practice evaluation results from CI/CD pipelines.
 * Integrates with the agent experience system for continuous learning.
 * 
 * POST /api/practice/results - Receive practice results
 *   - Validates webhook signature (HMAC-SHA256)
 *   - Stores results and extracts experiences
 *   - Updates agent knowledge base
 * 
 * Security: All requests must include valid X-Practice-Signature header
 */

import { NextRequest, NextResponse } from 'next/server';


import { createHmac, timingSafeEqual } from 'node:crypto';
import { createLogger } from '@/lib/utils/logger';
import { addExperience } from '@/lib/memory/agent-experience';

const logger = createLogger('API:PracticeWebhook');

/**
 * Webhook payload from CI/CD pipeline
 */
export interface PracticeResultPayload {
  // Source identification
  pipeline_id?: string;
  pipeline_name?: string;
  job_id?: string;
  run_id?: string;
  
  // Experiment context
  experiment_name?: string;
  epoch?: number;
  step?: number;
  
  // Dataset information
  dataset: string;
  dataset_index: number;
  source?: string;
  
  // Question/Answer
  raw_question: string;
  correct_answer?: string;
  
  // Agent response
  response: string;
  
  // Evaluation results
  reward?: number;
  reasoning?: string;
  trajectory?: string;
  
  // Verification results from various verifiers
  verifications?: {
    math?: { reward: number; reasoning: string };
    code_coverage?: { reward: number; coverage: any };
    security_scan?: { reward: number; vulnerabilities: any[] };
    complexity?: { reward: number; complexity: any };
    style?: { reward: number; style: any };
    documentation?: { reward: number; documentation: any };
    [key: string]: any;
  };
  
  // Metadata
  metadata?: Record<string, any>;
  
  // Timestamp
  timestamp?: number;
}

/**
 * Verify webhook signature using HMAC-SHA256
 */
function verifyWebhookSignature(body: string, signature: string | null, secret: string | undefined): boolean {
  if (!secret || !signature) {
    logger.warn('[PracticeWebhook] Missing secret or signature');
    return false;
  }
  
  const expected = createHmac('sha256', secret).update(body).digest('hex');
  const expectedWithPrefix = `sha256=${expected}`;
  
  try {
    const sigBuf = Buffer.from(signature, 'utf8');
    const expBuf = Buffer.from(expected, 'utf8');
    const expPrefixBuf = Buffer.from(expectedWithPrefix, 'utf8');
    
    // Check both formats: raw hex and sha256=hex prefix
    if (sigBuf.length === expBuf.length) {
      return timingSafeEqual(sigBuf, expBuf);
    }
    if (sigBuf.length === expPrefixBuf.length) {
      return timingSafeEqual(sigBuf, expPrefixBuf);
    }
    return false;
  } catch (err) {
    logger.error('[PracticeWebhook] Signature verification error', err);
    return false;
  }
}

/**
 * Extract experiences from verification results
 */
function extractExperiences(payload: PracticeResultPayload): Array<{
  lesson: string;
  category: string;
  tags: string[];
  priority: number;
  successRate: number;
  contextHint?: string;
}> {
  const experiences: Array<{
    lesson: string;
    category: string;
    tags: string[];
    priority: number;
    successRate: number;
    contextHint?: string;
  }> = [];
  
  const verifications = payload.verifications || {};
  const overallReward = payload.reward ?? 0.5;
  
  // Process each verification type
  for (const [verifierName, result] of Object.entries(verifications)) {
    if (!result || typeof result !== 'object' || Array.isArray(result)) continue;
    
    const verifierReward = result.reward ?? 0.5;
    const successRate = verifierReward;
    
    // Validate result structure
    const safeResult = result as Record<string, unknown>;
    
    // Extract experiences based on verifier type and result
    switch (verifierName) {
      case 'security_scan': {
        const vulns = safeResult.vulnerabilities as Array<{type?: string; context?: string; match?: string}> | undefined;
        if (Array.isArray(vulns) && vulns.length > 0) {
          experiences.push({
            lesson: `Avoid ${vulns[0].type || 'security'} vulnerabilities: ${vulns[0].context || vulns[0].match || 'see details'}`,
            category: 'security',
            tags: ['security', vulns[0].type || 'vulnerability', 'owasp'],
            priority: verifierReward < 0.5 ? 80 : 60,
            successRate,
            contextHint: 'Security-sensitive code',
          });
        }
        break;
      }
      
      case 'complexity': {
        const complexityData = safeResult.complexity as Record<string, unknown> | undefined;
        const issues = complexityData?.issues as string[] | undefined;
        if (Array.isArray(issues) && issues.length > 0) {
          experiences.push({
            lesson: `Manage code complexity: ${issues[0]}`,
            category: 'performance',
            tags: ['complexity', 'refactoring', 'maintainability'],
            priority: verifierReward < 0.7 ? 70 : 40,
            successRate,
            contextHint: 'Complex code sections',
          });
        }
        break;
      }
      
      case 'style': {
        const styleData = safeResult.style as Record<string, unknown> | undefined;
        const styleIssues = styleData?.issues as Array<{message?: string; code?: string}> | undefined;
        if (Array.isArray(styleIssues) && styleIssues.length > 0) {
          experiences.push({
            lesson: `Follow style guidelines: ${styleIssues[0].message || styleIssues[0].code || 'see details'}`,
            category: 'patterns',
            tags: ['style', 'conventions', 'readability'],
            priority: 50,
            successRate,
            contextHint: 'Code formatting and naming',
          });
        }
        break;
      }
      
      case 'documentation': {
        const docData = safeResult.documentation as Record<string, unknown> | undefined;
        const docIssues = docData?.issues as string[] | undefined;
        if (Array.isArray(docIssues) && docIssues.length > 0) {
          experiences.push({
            lesson: `Improve documentation: ${docIssues[0]}`,
            category: 'patterns',
            tags: ['documentation', 'docstrings', 'readability'],
            priority: 40,
            successRate,
            contextHint: 'Documentation requirements',
          });
        }
        break;
      }
      
      case 'code_coverage': {
        const coverageData = safeResult.coverage as Record<string, unknown> | undefined;
        if (coverageData) {
          const linePercent = coverageData.line_percent as number | undefined;
          experiences.push({
            lesson: `Ensure adequate test coverage: ${linePercent?.toFixed(0) || '0'}% line coverage`,
            category: 'patterns',
            tags: ['testing', 'coverage', 'quality'],
            priority: 60,
            successRate,
            contextHint: 'Test coverage requirements',
          });
        }
        break;
      }
    }
  }
  
  // Extract general lesson from evaluation if overall reward is low
  if (overallReward < 0.5 && payload.reasoning) {
    experiences.push({
      lesson: payload.reasoning.slice(0, 200),
      category: 'general',
      tags: ['evaluation', 'feedback', payload.dataset],
      priority: 70,
      successRate: overallReward,
      contextHint: `Question: ${payload.raw_question.slice(0, 100)}...`,
    });
  }
  
  return experiences;
}

/**
 * Process and store practice result
 */
async function processPracticeResult(payload: PracticeResultPayload): Promise<{
  success: boolean;
  stored: boolean;
  experiences_created: number;
  error?: string;
}> {
  try {
    // Store in memory/experiences system
    const experiences = extractExperiences(payload);
    let experiencesCreated = 0;
    
    for (const exp of experiences) {
      await addExperience(exp.lesson, exp.category, {
        tags: exp.tags,
        priority: exp.priority,
        successRate: exp.successRate,
        contextHint: exp.contextHint,
      });
      experiencesCreated++;
    }
    
    // TODO: Store full result in database for persistence
    // This would use the practice module's database models
    
    logger.info('[PracticeWebhook] Processed result', {
      dataset: payload.dataset,
      reward: payload.reward,
      experiences_created: experiencesCreated,
    });
    
    return {
      success: true,
      stored: true,
      experiences_created: experiencesCreated,
    };
    
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Unknown error';
    logger.error('[PracticeWebhook] Failed to process result', err);
    return {
      success: false,
      stored: false,
      experiences_created: 0,
      error,
    };
  }
}

// Idempotency tracking
// NOTE: In production serverless deployments, use Redis or database instead of in-memory Set.
// The current implementation works for single-instance deployments or sticky sessions.
const processedResults = new Set<string>();

// POST /api/practice/results
export async function POST(req: NextRequest) {
  let rawBody: string;
  
  try {
    rawBody = await req.text();
  } catch {
    logger.warn('[PracticeWebhook] Failed to read request body');
    return NextResponse.json(
      { error: 'Failed to read request body' },
      { status: 400 }
    );
  }
  
  // Verify webhook signature
  const signature = req.headers.get('x-practice-signature') || 
                    req.headers.get('x-hub-signature-256');
  
  const webhookSecret = process.env.PRACTICE_WEBHOOK_SECRET;
  
  if (!verifyWebhookSignature(rawBody, signature, webhookSecret)) {
    logger.warn('[PracticeWebhook] Invalid signature');
    return NextResponse.json(
      { error: 'Invalid webhook signature' },
      { status: 401 }
    );
  }
  
  // Parse payload
  let payload: PracticeResultPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch (parseErr) {
    logger.warn('[PracticeWebhook] Invalid JSON payload');
    return NextResponse.json(
      { error: 'Invalid JSON payload' },
      { status: 400 }
    );
  }
  
  // Validate required fields
  if (!payload.dataset || !payload.raw_question || !payload.response) {
    return NextResponse.json(
      { error: 'Missing required fields: dataset, raw_question, response' },
      { status: 400 }
    );
  }
  
  // Generate idempotency key
  // Use a combination of identifiers to prevent collisions
  // Fall back to response hash if no pipeline/run IDs are provided
  const primaryKey = payload.pipeline_id || payload.run_id || payload.job_id;
  let idempotencyKey: string;
  
  if (primaryKey) {
    idempotencyKey = `${primaryKey}:${payload.dataset}:${payload.dataset_index}`;
  } else {
    // Create a hash from response content as fallback
    const responseHash = rawBody.split('').reduce((acc, char) => {
      return ((acc << 5) - acc + char.charCodeAt(0)) | 0;
    }, 0).toString(16);
    idempotencyKey = `${payload.dataset}:${payload.dataset_index}:${responseHash}`;
  }
  
  if (processedResults.has(idempotencyKey)) {
    logger.info('[PracticeWebhook] Duplicate request detected, returning success', { idempotencyKey });
    return NextResponse.json({
      success: true,
      duplicate: true,
      message: 'Already processed',
    });
  }
  
  // Set defaults
  payload.timestamp = payload.timestamp || Date.now();
  payload.source = payload.source || 'ci-cd-webhook';
  
  // Process the result
  try {
    // Log experiment context for debugging
    if (payload.experiment_name) {
      logger.info('[PracticeWebhook] Processing result', {
        experiment: payload.experiment_name,
        epoch: payload.epoch,
        step: payload.step,
      });
    }
    
    const result = await processPracticeResult(payload);
    
    if (!result.success) {
      return NextResponse.json(
        { 
          success: false,
          error: result.error || 'Processing failed',
        },
        { status: 500 }
      );
    }
    
    // Mark as processed for idempotency
    processedResults.add(idempotencyKey);
    
    // Limit memory usage by removing old entries
    if (processedResults.size > 10000) {
      const entries = Array.from(processedResults);
      processedResults.clear();
      entries.slice(-5000).forEach(e => processedResults.add(e));
    }
    
    return NextResponse.json({
      success: true,
      dataset: payload.dataset,
      reward: payload.reward,
      experiences_created: result.experiences_created,
      processed_at: new Date().toISOString(),
    });
    
  } catch (err) {
    logger.error('[PracticeWebhook] Unexpected error', {
      error: err instanceof Error ? err.message : String(err),
      payload: rawBody.slice(0, 500), // Log first 500 chars for debugging
    });
    return NextResponse.json(
      { error: 'Webhook processing failed' },
      { status: 500 }
    );
  }
}

// GET /api/practice/results - Health check
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    service: 'practice-webhook',
    endpoint: '/api/practice/results',
    methods: ['POST'],
    headers_required: ['x-practice-signature'],
    timestamp: new Date().toISOString(),
  });
}