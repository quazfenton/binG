/**
 * Parallel explorers pattern - test multiple approaches simultaneously
 */

import { parallelMap, pickBestBy } from '../core.js';

export async function parallelExplorers({ 
  inputs, 
  callAgent, 
  scoreFn, 
  concurrency = 3, 
  finalPolish 
}) {
  console.log(`[ParallelExplorers] Starting with ${inputs.length} variants`);
  
  const candidates = await parallelMap(
    inputs,
    async (item) => {
      const startTime = Date.now();
      
      try {
        const res = await callAgent({ 
          prompt: item.prompt, 
          agentConfig: item.agentConfig 
        });
        
        const score = await scoreFn(res);
        const duration = Date.now() - startTime;
        
        console.log(`[ParallelExplorers] ${item.name}: score=${score.toFixed(3)}, duration=${duration}ms`);
        
        return { 
          ...item, 
          res, 
          score,
          duration,
          failed: false
        };
      } catch (error) {
        console.error(`[ParallelExplorers] ${item.name} failed:`, error.message);
        return {
          ...item,
          error: error.message,
          score: 0,
          failed: true
        };
      }
    },
    concurrency
  );
  
  const validCandidates = candidates.filter(c => !c.failed);
  const winner = pickBestBy(validCandidates, c => c.score || 0);
  
  console.log(`[ParallelExplorers] Winner: ${winner?.name} with score ${winner?.score?.toFixed(3)}`);
  
  let polished = null;
  if (finalPolish && winner) {
    console.log('[ParallelExplorers] Applying final polish...');
    try {
      polished = await callAgent({ 
        prompt: `Polish and finalize the following result. Ensure correctness and quality:\n\n${winner.res.text || winner.res}`, 
        agentConfig: finalPolish 
      });
    } catch (error) {
      console.error('[ParallelExplorers] Polish failed:', error.message);
    }
  }
  
  return { candidates, winner, polished };
}
