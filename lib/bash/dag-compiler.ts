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
 */
export function extractRedirect(command: string): { command: string; outputFile?: string } {
  // Match > or >> patterns
  const match = command.match(/(.+?)>\s*(.+)/);
  
  if (!match) {
    return { command };
  }

  return {
    command: match[1].trim(),
    outputFile: match[2].trim(),
  };
}

/**
 * Extract input redirection from command
 */
export function extractInputRedirect(command: string): { command: string; inputFile?: string } {
  const match = command.match(/(.+?)<\s*(.+)/);
  
  if (!match) {
    return { command };
  }

  return {
    command: match[1].trim(),
    inputFile: match[2].trim(),
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
          const mergedNode = createDAGNode(
            currentGroup[0].id,
            'bash',
            mergedCommand,
            currentGroup[0].dependsOn
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
      const mergedNode = createDAGNode(
        currentGroup[0].id,
        'bash',
        mergedCommand,
        currentGroup[0].dependsOn
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
 */
export function optimizeForParallelism(dag: DAG): DAG {
  const levels = identifyParallelism(dag);
  
  if (levels.length <= dag.nodes.length) {
    // Already optimal or close to it
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
