/**
 * Reflect & critic pattern - dual perspective generation
 */

export async function reflectCritic({ 
  basePrompt, 
  callAgent, 
  polisherConfig 
}) {
  console.log('[ReflectCritic] Starting dual-thread generation');
  
  // Thread 1: Creative solution generation
  console.log('[ReflectCritic] Creating solution...');
  const creator = await callAgent({ 
    prompt: `${basePrompt}\n\nGenerate a complete, working solution. Be thorough and innovative.`,
    agentConfig: { model: 'creative', temperature: 0.8 }
  });
  
  const creatorText = creator.text || creator;
  
  // Thread 2: Critical analysis
  console.log('[ReflectCritic] Analyzing solution...');
  const critic = await callAgent({ 
    prompt: `Review the following solution for:\n- Correctness and bugs\n- Edge cases and error handling\n- Performance issues\n- Security concerns\n- Code quality\n\nProvide a numbered list of specific issues.\n\nSolution:\n\n${creatorText}`,
    agentConfig: { model: 'critic', temperature: 0.3 }
  });
  
  const criticText = critic.text || critic;
  
  // Synthesis: Address criticisms
  console.log('[ReflectCritic] Synthesizing final solution...');
  const combined = `Original solution:\n\n${creatorText}\n\nCritical analysis identified these issues:\n${criticText}\n\nPlease produce a corrected, polished final solution that addresses all identified issues.`;
  
  const polished = await callAgent({ 
    prompt: combined, 
    agentConfig: polisherConfig || { model: 'polish', temperature: 0.4 }
  });
  
  console.log('[ReflectCritic] Complete');
  
  return { 
    creator, 
    critic, 
    polished,
    metadata: {
      creatorLength: creatorText.length,
      criticLength: criticText.length,
      polishedLength: (polished.text || polished).length
    }
  };
}
