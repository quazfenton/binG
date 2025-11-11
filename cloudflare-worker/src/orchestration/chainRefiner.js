/**
 * Chain refiner pattern - iterative improvement with feedback
 */

import { pickBestBy } from '../core.js';

export async function chainRefiner({ 
  initialPrompt, 
  callAgent, 
  evaluate, 
  maxAttempts = 3,
  qualityThreshold = 0.9
}) {
  console.log(`[ChainRefiner] Starting with max ${maxAttempts} attempts`);
  
  let prompt = initialPrompt;
  const chain = [];
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    console.log(`[ChainRefiner] Attempt ${attempt}/${maxAttempts}`);
    
    try {
      const resp = await callAgent({ prompt, attempt });
      const evaluation = await evaluate(resp);
      const score = typeof evaluation === 'number' ? evaluation : evaluation.totalScore;
      
      chain.push({ 
        attempt, 
        resp, 
        score,
        evaluation: typeof evaluation === 'object' ? evaluation : null,
        timestamp: Date.now()
      });
      
      console.log(`[ChainRefiner] Attempt ${attempt} score: ${score.toFixed(3)}`);
      
      if (score >= qualityThreshold) {
        console.log(`[ChainRefiner] Quality threshold met! ${score.toFixed(3)} >= ${qualityThreshold}`);
        return { ok: true, chain, best: resp, attempts: attempt };
      }
      
      // Generate feedback for next iteration
      const feedback = generateFeedback(evaluation, score);
      prompt = `Previous attempt scored ${score.toFixed(2)}. ${feedback}\n\nPrevious output:\n\n${resp.text || resp}\n\nReturn only the improved version.`;
      
    } catch (error) {
      console.error(`[ChainRefiner] Attempt ${attempt} failed:`, error.message);
      chain.push({ 
        attempt, 
        error: error.message, 
        score: 0,
        failed: true
      });
    }
  }
  
  const best = pickBestBy(chain.filter(c => !c.failed), c => c.score || 0);
  console.log(`[ChainRefiner] Max attempts reached. Best score: ${best?.score?.toFixed(3)}`);
  
  return { ok: false, chain, best: best?.resp, attempts: maxAttempts };
}

function generateFeedback(evaluation, score) {
  if (typeof evaluation === 'object' && evaluation.metrics) {
    const issues = [];
    
    if (evaluation.metrics.correctness < 0.8) {
      issues.push('Improve correctness and handle edge cases');
    }
    if (evaluation.metrics.performance < 0.7) {
      issues.push('Optimize performance');
    }
    if (evaluation.metrics.style < 0.7) {
      issues.push('Improve code style and readability');
    }
    
    return issues.length > 0 
      ? issues.join('. ') + '.'
      : 'General improvements needed.';
  }
  
  if (score < 0.5) {
    return 'Major improvements needed. Focus on correctness and completeness.';
  } else if (score < 0.7) {
    return 'Moderate improvements needed. Address correctness and quality issues.';
  } else {
    return 'Minor improvements needed. Polish and refine.';
  }
}
