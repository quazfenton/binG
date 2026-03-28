/**
 * DAG Compiler - Bash Pipeline → Executable Graph
 * 
 * Converts bash pipelines into typed, executable DAGs
 * 
 * @see bash.md - Bash-native agent execution patterns
 */

import { DAG, DAGNode, DAGNodeType, createDAG, createDAGNode } from './bash-event-schema';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('Bash:DAGCompiler');

// ============================================================================
// Pipeline Parsing
// ============================================================================

/**
 * Parse bash pipeline into steps
 * Handles quoted strings and escaped pipes
 */
export function parsePipeline(command: string): string[] {
  const parts: string[] = [];
  let current = '';
  let inQuote = false;
  let quoteChar = '';
  let escaped = false;

  for (const char of command) {
    // Handle escape sequences
    if (char === '\\' && !escaped) {
      escaped = true;
      current += char;
      continue;
    }

    if (escaped) {
      escaped = false;
      current += char;
      continue;
    }

    // Handle quotes
    if ((char === '"' || char === "'") && !inQuote) {
      inQuote = true;
      quoteChar = char;
      current += char;
    } else if (char === quoteChar && inQuote) {
      inQuote = false;
      quoteChar = '';
      current += char;
    } else if (char === '|' && !inQuote) {
      // Pipe outside quotes - split here
      parts.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  // Add last part
  if (current.trim()) {
    parts.push(current.trim());
  }

  logger.debug('Parsed pipeline', {
    input: command,
    parts,
  });

  return parts;
}

/**
 * Extract output redirection from command
 *
 * Handles:
 * - Both > (overwrite) and >> (append) patterns
 * - Quoted filenames (single and double quotes)
 * - Multiple redirections (returns the last output redirect)
 * - Commands with < input redirection combined with > output
 *
 * Limitations: Does not handle heredocs (<<) or process substitution (>(...))
 */
export function extractRedirect(command: string): { command: string; outputFile?: string } {
  // Skip if command contains heredoc syntax (too complex for simple parsing)
  if (command.includes('<<')) {
    return { command };
  }

  // Remove quoted strings temporarily to avoid matching > inside quotes
  const quotedStrings: string[] = [];
  let placeholderIndex = 0;
  const placeholderChar = '\x00'; // Use null byte as placeholder
  
  // Replace quoted strings with placeholders
  const unquotedCommand = command.replace(/(["'])(?:(?!\1).)*\1/g, (match) => {
    quotedStrings[placeholderIndex] = match;
    return `${placeholderChar}${placeholderIndex++}${placeholderChar}`;
  });

  // Match output redirection: > or >> (but not >> as part of other operators)
  // We want the LAST output redirect in case of multiple redirects
  const redirectRegex = /([^|;&]+)(>>?)\s*([^\s|;&]+)/g;
  let lastMatch: RegExpExecArray | null = null;
  let match: RegExpExecArray | null;
  
  while ((match = redirectRegex.exec(unquotedCommand)) !== null) {
    // Skip if this looks like a comparison operator (e.g., a > b in test context)
    const beforeMatch = unquotedCommand.slice(0, match.index).trimEnd();
    if (beforeMatch.endsWith("'") || beforeMatch.endsWith('test') ||
        beforeMatch.endsWith('-gt') || beforeMatch.endsWith('-lt')) {
      continue; // Skip shell test comparisons
    }
    lastMatch = match;
  }

  if (!lastMatch) {
    return { command };
  }

  // Restore quoted strings in the command part
  let cmdPart = lastMatch[1].replace(
    new RegExp(`${placeholderChar}(\\d+)${placeholderChar}`, 'g'),
    (_, idx) => quotedStrings[parseInt(idx)] || ''
  );

  // Restore quoted strings in the file part
  let filePart = lastMatch[3].replace(
    new RegExp(`${placeholderChar}(\\d+)${placeholderChar}`, 'g'),
    (_, idx) => quotedStrings[parseInt(idx)] || ''
  );

  // Reconstruct command without the output redirect
  const commandWithoutRedirect = unquotedCommand
    .slice(0, lastMatch.index) + unquotedCommand.slice(lastMatch.index + lastMatch[0].length);
  
  // Restore quoted strings in the reconstructed command
  const finalCommand = commandWithoutRedirect.replace(
    new RegExp(`${placeholderChar}(\\d+)${placeholderChar}`, 'g'),
    (_, idx) => quotedStrings[parseInt(idx)] || ''
  );

  logger.debug('Extracted redirect', {
    original: command,
    command: finalCommand.trim(),
    outputFile: filePart,
  });

  return {
    command: finalCommand.trim(),
    outputFile: filePart.trim(),
  };
}

/**
 * Extract input redirection from command
 *
 * Handles:
 * - < input redirection
 * - Quoted filenames (single and double quotes)
 * - Skips heredoc syntax (<<)
 */
export function extractInputRedirect(command: string): { command: string; inputFile?: string } {
  // Skip heredoc syntax (too complex for simple parsing)
  if (command.includes('<<')) {
    return { command };
  }

  // Remove quoted strings temporarily to avoid matching < inside quotes
  const quotedStrings: string[] = [];
  let placeholderIndex = 0;
  const placeholderChar = '\x00';
  
  const unquotedCommand = command.replace(/(["'])(?:(?!\1).)*\1/g, (match) => {
    quotedStrings[placeholderIndex] = match;
    return `${placeholderChar}${placeholderIndex++}${placeholderChar}`;
  });

  // Match input redirection: < (but not <<)
  const match = unquotedCommand.match(/([^|;&<]+)<\s*([^\s|;&<]+)/);

  if (!match) {
    return { command };
  }

  // Restore quoted strings
  const cmdPart = match[1].replace(
    new RegExp(`${placeholderChar}(\\d+)${placeholderChar}`, 'g'),
    (_, idx) => quotedStrings[parseInt(idx)] || ''
  );
  
  const filePart = match[2].replace(
    new RegExp(`${placeholderChar}(\\d+)${placeholderChar}`, 'g'),
    (_, idx) => quotedStrings[parseInt(idx)] || ''
  );

  // Reconstruct command without the input redirect
  const commandWithoutRedirect = unquotedCommand
    .slice(0, match.index) + unquotedCommand.slice(match.index + match[0].length);
  
  const finalCommand = commandWithoutRedirect.replace(
    new RegExp(`${placeholderChar}(\\d+)${placeholderChar}`, 'g'),
    (_, idx) => quotedStrings[parseInt(idx)] || ''
  );

  return {
    command: finalCommand.trim(),
    inputFile: filePart.trim(),
  };
}

// ============================================================================
// Command Classification
// ============================================================================

/**
 * Classify command type for routing
 */
export function classifyCommand(command: string): DAGNodeType {
  const trimmed = command.trim().toLowerCase();

  // Check for container/runtime commands
  if (trimmed.startsWith('node ') || 
      trimmed.startsWith('python ') || 
      trimmed.startsWith('python3 ') ||
      trimmed.startsWith('npm ') ||
      trimmed.startsWith('npx ') ||
      trimmed.startsWith('deno ')) {
    return 'container';
  }

  // Check for tool-like commands (could use structured tools)
  if (trimmed.startsWith('curl ') || 
      trimmed.startsWith('wget ') ||
      trimmed.startsWith('http ') ||
      trimmed.startsWith('git ')) {
    return 'tool';
  }

  // Default to bash
  return 'bash';
}

/**
 * Detect command dependencies from file operations
 */
export function detectFileDependencies(command: string): string[] {
  const files: string[] = [];

  // Match file paths in common patterns
  const patterns = [
    /cat\s+([^\s|>&]+)/g,
    /grep\s+.*?\s+([^\s|>&]+)/g,
    /<\s*([^\s|>&]+)/g,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(command)) !== null) {
      const file = match[1];
      if (file && !file.startsWith('-')) {
        files.push(file);
      }
    }
  }

  return files;
}

// ============================================================================
// DAG Compilation
// ============================================================================

/**
 * Compile bash command to DAG
 */
export function compileBashToDAG(command: string, agentId: string = 'default'): DAG {
  logger.info('Compiling bash to DAG', { command });

  const steps = parsePipeline(command);

  const nodes: DAGNode[] = steps.map((step, i) => {
    const { command: cmd, outputFile } = extractRedirect(step);
    const { inputFile } = extractInputRedirect(cmd);
    
    const node = createDAGNode(
      `step-${i}`,
      classifyCommand(cmd),
      cmd,
      i === 0 ? [] : [`step-${i - 1}`]
    );

    // Add file outputs
    if (outputFile) {
      node.outputs = [outputFile];
    }

    // Add file inputs as dependencies (for future optimization)
    if (inputFile) {
      node.metadata = {
        ...node.metadata,
        inputFile,
      };
    }

    return node;
  });

  const dag = createDAG(nodes, agentId, command);

  logger.debug('DAG compiled', {
    nodeId: nodes.length,
    dag,
  });

  return dag;
}

// ============================================================================
// DAG Optimization
// ============================================================================

/**
 * Optimize DAG by merging consecutive bash nodes
 */
export function mergeConsecutiveNodes(dag: DAG): DAG {
  if (dag.nodes.length <= 1) {
    return dag;
  }

  const mergedNodes: DAGNode[] = [];
  let currentGroup: DAGNode[] = [];

  for (const node of dag.nodes) {
    if (node.type === 'bash' && 
        currentGroup.length > 0 && 
        currentGroup[currentGroup.length - 1].type === 'bash') {
      // Group consecutive bash nodes
      currentGroup.push(node);
    } else {
      // Flush current group
      if (currentGroup.length > 0) {
        if (currentGroup.length === 1) {
          mergedNodes.push(currentGroup[0]);
        } else {
          // Merge into single node
          const mergedCommand = currentGroup.map(n => n.command).join(' | ');
          const allDeps = new Set<string>();
          for (const n of currentGroup) {
            if (n.dependsOn) {
              for (const dep of n.dependsOn) {
                allDeps.add(dep);
              }
            }
          }
          const mergedNode = createDAGNode(
            currentGroup[0].id,
            'bash',
            mergedCommand,
            Array.from(allDeps)
          );
          mergedNode.outputs = currentGroup[currentGroup.length - 1].outputs;
          mergedNode.metadata = {
            ...currentGroup[0].metadata,
            mergedFrom: currentGroup.map(n => n.id),
          };
          mergedNodes.push(mergedNode);
        }
      }
      currentGroup = [node];
    }
  }

  // Flush last group
  if (currentGroup.length > 0) {
    if (currentGroup.length === 1) {
      mergedNodes.push(currentGroup[0]);
    } else {
      const mergedCommand = currentGroup.map(n => n.command).join(' | ');
      const allDeps = new Set<string>();
      for (const n of currentGroup) {
        if (n.dependsOn) {
          for (const dep of n.dependsOn) {
            allDeps.add(dep);
          }
        }
      }
      const mergedNode = createDAGNode(
        currentGroup[0].id,
        'bash',
        mergedCommand,
        Array.from(allDeps)
      );
      mergedNode.outputs = currentGroup[currentGroup.length - 1].outputs;
      mergedNode.metadata = {
        ...currentGroup[0].metadata,
        mergedFrom: currentGroup.map(n => n.id),
      };
      mergedNodes.push(mergedNode);
    }
  }

  logger.debug('DAG optimized - merged nodes', {
    before: dag.nodes.length,
    after: mergedNodes.length,
  });

  return {
    ...dag,
    nodes: mergedNodes,
    metadata: {
      ...dag.metadata,
      optimized: true,
    },
  };
}

/**
 * Identify parallel execution opportunities
 */
export function identifyParallelism(dag: DAG): string[][] {
  const levels: string[][] = [];
  const nodeLevel = new Map<string, number>();

  // Calculate level for each node
  for (const node of dag.nodes) {
    let maxDepLevel = -1;
    
    for (const dep of node.dependsOn) {
      const depLevel = nodeLevel.get(dep) || 0;
      maxDepLevel = Math.max(maxDepLevel, depLevel);
    }
    
    const level = maxDepLevel + 1;
    nodeLevel.set(node.id, level);
    
    if (!levels[level]) {
      levels[level] = [];
    }
    levels[level].push(node.id);
  }

  logger.debug('Parallelism identified', { levels });

  return levels.filter(level => level.length > 0);
}

/**
 * Reorder DAG for optimal parallel execution
 * 
 * Groups nodes by dependency level to maximize parallel execution opportunities
 */
export function optimizeForParallelism(dag: DAG): DAG {
  const levels = identifyParallelism(dag);

  // Only reorder if we have multiple levels (parallelism opportunities)
  if (levels.length <= 1) {
    // No parallelism opportunities - all nodes are sequential
    return dag;
  }

  // Reorder nodes by level
  const reorderedNodes: DAGNode[] = [];
  const nodeMap = new Map(dag.nodes.map(n => [n.id, n]));

  for (const level of levels) {
    for (const nodeId of level) {
      const node = nodeMap.get(nodeId);
      if (node) {
        reorderedNodes.push(node);
      }
    }
  }

  logger.info('DAG reordered for parallelism', {
    originalOrder: dag.nodes.map(n => n.id),
    newOrder: reorderedNodes.map(n => n.id),
  });

  return {
    ...dag,
    nodes: reorderedNodes,
  };
}

/**
 * Full optimization pipeline
 */
export function optimizeDAG(dag: DAG): DAG {
  let optimized = dag;

  // Step 1: Merge consecutive bash nodes
  optimized = mergeConsecutiveNodes(optimized);

  // Step 2: Reorder for parallelism
  optimized = optimizeForParallelism(optimized);

  return optimized;
}

// ============================================================================
// Advanced Compilation
// ============================================================================

/**
 * Compile with LLM assistance (for complex commands)
 */
export async function compileWithLLM(
  command: string,
  agentId: string
): Promise<DAG> {
  // TODO: Integrate with LLM provider for complex command parsing
  // For now, fall back to standard compilation
  
  logger.warn('LLM-assisted compilation not yet implemented, using standard compilation');
  
  return compileBashToDAG(command, agentId);
}

/**
 * Validate DAG structure
 */
export function validateDAG(dag: DAG): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const nodeIds = new Set(dag.nodes.map(n => n.id));

  // Check for duplicate IDs
  const uniqueIds = new Set(dag.nodes.map(n => n.id));
  if (uniqueIds.size !== dag.nodes.length) {
    errors.push('Duplicate node IDs detected');
  }

  // Check for missing dependencies
  for (const node of dag.nodes) {
    for (const dep of node.dependsOn) {
      if (!nodeIds.has(dep)) {
        errors.push(`Node ${node.id} depends on non-existent node ${dep}`);
      }
    }
  }

  // Check for cycles (simple check)
  const visited = new Set<string>();
  const visiting = new Set<string>();

  function hasCycle(nodeId: string): boolean {
    if (visiting.has(nodeId)) {
      return true;
    }
    if (visited.has(nodeId)) {
      return false;
    }

    visiting.add(nodeId);
    
    const node = dag.nodes.find(n => n.id === nodeId);
    if (node) {
      for (const dep of node.dependsOn) {
        if (hasCycle(dep)) {
          return true;
        }
      }
    }

    visiting.delete(nodeId);
    visited.add(nodeId);
    
    return false;
  }

  for (const node of dag.nodes) {
    if (hasCycle(node.id)) {
      errors.push('Cycle detected in DAG');
      break;
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
