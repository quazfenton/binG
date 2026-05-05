/**
 * Role Redirector
 * 
 * Manages weighted role suggestions and routing options for specialized handling.
 * Enables LLM to redirect/choose via simulated situational engineering.
 * 
 * Features:
 * - Role weight calculation based on context
 * - Routing options generation
 * - Tool call redirect suggestions
 * - Multi-role orchestration support
 */

import type { RoleRedirect } from './feedback-injection';

export const REDIRECTABLE_ROLES = [
  'coder',
  'reviewer',
  'planner',
  'architect',
  'researcher',
  'debugger',
  'specialist',
  'orchestrator',
  'simplifier'
] as const;

export type Role = typeof REDIRECTABLE_ROLES[number];

export interface RoleCapability {
  strengths: string[];
  weaknesses: string[];
  bestFor: string[];
  tools?: string[];
}

export interface RoleSuggestion {
  role: Role;
  weight: number;
  reason: string;
  triggerCondition?: string;
  confidence: number;
  contextMatch: number; // 0-1 how well context matches role strengths
}

// Role capabilities mapping
const ROLE_CAPABILITIES: Record<Role, RoleCapability> = {
  coder: {
    strengths: ['code generation', 'refactoring', 'debugging', 'implementation'],
    weaknesses: ['high-level architecture', 'documentation', 'testing strategy'],
    bestFor: ['implement features', 'fix bugs', 'write functions', 'modify existing code'],
  },
  reviewer: {
    strengths: ['code review', 'quality assurance', 'best practices', 'pattern detection'],
    weaknesses: ['implementation speed', 'creative solutions'],
    bestFor: ['review code', 'identify issues', 'suggest improvements', 'validate solutions'],
  },
  planner: {
    strengths: ['task decomposition', 'roadmapping', 'step sequencing', 'dependency analysis'],
    weaknesses: ['code writing', 'quick fixes'],
    bestFor: ['plan implementation', 'break down tasks', 'sequence steps', 'estimate effort'],
  },
  architect: {
    strengths: ['system design', 'pattern selection', 'scalability planning', 'technology choices'],
    weaknesses: ['detailed implementation', 'quick fixes'],
    bestFor: ['design systems', 'choose patterns', 'plan architecture', 'evaluate tradeoffs'],
  },
  researcher: {
    strengths: ['information gathering', 'documentation analysis', 'learning new domains'],
    weaknesses: ['implementation', 'decision making'],
    bestFor: ['research topics', 'find solutions', 'learn frameworks', 'gather requirements'],
  },
  debugger: {
    strengths: ['error diagnosis', 'troubleshooting', 'root cause analysis', 'fix verification'],
    weaknesses: ['new feature development', 'creative solutions'],
    bestFor: ['fix errors', 'diagnose issues', 'trace problems', 'verify fixes'],
  },
  specialist: {
    strengths: ['deep expertise', 'advanced techniques', 'optimization', 'edge cases'],
    weaknesses: ['general tasks', 'quick solutions'],
    bestFor: ['complex problems', 'optimize performance', 'handle edge cases', 'advanced features'],
  },
  orchestrator: {
    strengths: ['coordination', 'task routing', 'workflow management', 'multi-agent coordination'],
    weaknesses: ['detailed implementation'],
    bestFor: ['coordinate complex tasks', 'route to specialists', 'manage workflows'],
  },
  simplifier: {
    strengths: ['simplification', 'explanation', 'summarization', 'clarity'],
    weaknesses: ['complex implementation', 'detailed research'],
    bestFor: ['simplify complex topics', 'explain code', 'summarize information'],
  },
};

// ============================================================================
// Role Suggestion Generation
// ============================================================================

/**
 * Analyze context and generate role suggestions
 */
export function analyzeContextAndSuggestRoles(
  context: {
    taskDescription?: string;
    recentFailures?: string[];
    toolCallPatterns?: string[];
    responsePatterns?: string[];
    complexity?: 'low' | 'medium' | 'high';
  }
): RoleSuggestion[] {
  const suggestions: RoleSuggestion[] = [];
  
  const { taskDescription = '', recentFailures = [], toolCallPatterns = [], complexity = 'medium' } = context;
  
  // Analyze task type
  const taskLower = taskDescription.toLowerCase();
  
  // Code generation tasks
  if (taskLower.includes('create') || taskLower.includes('implement') || taskLower.includes('write')) {
    suggestions.push({
      role: 'coder',
      weight: 0.9,
      reason: 'Task involves code generation or implementation',
      triggerCondition: 'code_generation_task',
      confidence: 0.85,
      contextMatch: 0.9,
    });
  }
  
  // Review tasks
  if (taskLower.includes('review') || taskLower.includes('check') || taskLower.includes('improve')) {
    suggestions.push({
      role: 'reviewer',
      weight: 0.9,
      reason: 'Task involves code review or quality checking',
      triggerCondition: 'code_review_task',
      confidence: 0.85,
      contextMatch: 0.9,
    });
  }
  
  // Planning tasks
  if (taskLower.includes('plan') || taskLower.includes('break down') || taskLower.includes('sequence')) {
    suggestions.push({
      role: 'planner',
      weight: 0.9,
      reason: 'Task involves planning or task decomposition',
      triggerCondition: 'planning_task',
      confidence: 0.85,
      contextMatch: 0.9,
    });
  }
  
  // Architecture tasks
  if (taskLower.includes('design') || taskLower.includes('architecture') || taskLower.includes('system')) {
    suggestions.push({
      role: 'architect',
      weight: 0.9,
      reason: 'Task involves system design or architecture',
      triggerCondition: 'architecture_task',
      confidence: 0.85,
      contextMatch: 0.9,
    });
  }
  
  // Debug tasks
  if (taskLower.includes('bug') || taskLower.includes('error') || taskLower.includes('fix') || taskLower.includes('debug')) {
    suggestions.push({
      role: 'debugger',
      weight: 0.9,
      reason: 'Task involves debugging or error fixing',
      triggerCondition: 'debug_task',
      confidence: 0.85,
      contextMatch: 0.9,
    });
  }
  
  // Research tasks
  if (taskLower.includes('research') || taskLower.includes('find') || taskLower.includes('learn')) {
    suggestions.push({
      role: 'researcher',
      weight: 0.9,
      reason: 'Task involves research or information gathering',
      triggerCondition: 'research_task',
      confidence: 0.85,
      contextMatch: 0.9,
    });
  }
  
  // High complexity suggests orchestrator or architect
  if (complexity === 'high') {
    suggestions.push({
      role: 'orchestrator',
      weight: 0.7,
      reason: 'High complexity task may benefit from orchestration',
      triggerCondition: 'high_complexity',
      confidence: 0.6,
      contextMatch: 0.7,
    });
    suggestions.push({
      role: 'architect',
      weight: 0.65,
      reason: 'High complexity may require architectural planning',
      triggerCondition: 'high_complexity',
      confidence: 0.55,
      contextMatch: 0.65,
    });
  }
  
  // Analyze failures for role suggestions
  if (recentFailures.length > 0) {
    const failureTypes = categorizeFailures(recentFailures);
    
    if (failureTypes.toolExecution) {
      suggestions.push({
        role: 'specialist',
        weight: 0.8,
        reason: 'Tool execution failures suggest need for specialized handling',
        triggerCondition: 'tool_execution_failure',
        confidence: 0.7,
        contextMatch: 0.8,
      });
    }
    
    if (failureTypes.logicErrors) {
      suggestions.push({
        role: 'reviewer',
        weight: 0.7,
        reason: 'Logic errors suggest need for code review',
        triggerCondition: 'logic_error',
        confidence: 0.6,
        contextMatch: 0.7,
      });
    }
    
    if (failureTypes.planningErrors) {
      suggestions.push({
        role: 'planner',
        weight: 0.75,
        reason: 'Planning issues suggest need for better task decomposition',
        triggerCondition: 'planning_error',
        confidence: 0.65,
        contextMatch: 0.75,
      });
    }
  }
  
  // Analyze tool patterns
  if (toolCallPatterns.length > 0) {
    const highToolUsage = toolCallPatterns.length > 5;
    const variedTools = new Set(toolCallPatterns).size > 3;
    
    if (highToolUsage && variedTools) {
      suggestions.push({
        role: 'orchestrator',
        weight: 0.6,
        reason: 'High tool usage with variety suggests orchestration needed',
        triggerCondition: 'varied_tool_usage',
        confidence: 0.5,
        contextMatch: 0.6,
      });
    }
  }
  
  // Sort by weight and return top suggestions
  return suggestions
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 5);
}

/**
 * Categorize failures by type
 */
function categorizeFailures(failures: string[]): {
  toolExecution: boolean;
  logicErrors: boolean;
  planningErrors: boolean;
  formatErrors: boolean;
} {
  return {
    toolExecution: failures.some(f => 
      f.includes('tool') || f.includes('execute') || f.includes('command')
    ),
    logicErrors: failures.some(f => 
      f.includes('logic') || f.includes('bug') || f.includes('incorrect')
    ),
    planningErrors: failures.some(f => 
      f.includes('plan') || f.includes('step') || f.includes('sequence')
    ),
    formatErrors: failures.some(f => 
      f.includes('format') || f.includes('parse') || f.includes('invalid')
    ),
  };
}

// ============================================================================
// Weighted Role Selection
// ============================================================================

export interface WeightedRoleSelection {
  primaryRole: Role;
  secondaryRoles: Role[];
  routingOptions: RoutingOption[];
  confidence: number;
  reasoning: string;
}

export interface RoutingOption {
  target: Role;
  weight: number;
  reason: string;
  conditions: string[];
}

/**
 * Generate weighted role selection based on context
 */
export function generateWeightedRoleSelection(
  context: {
    currentRole?: Role;
    taskDescription?: string;
    feedbackContext?: any;
    trackerState?: any;
    toolSelectionWeights?: Record<string, number>;
  }
): WeightedRoleSelection {
  const suggestions = analyzeContextAndSuggestRoles({
    taskDescription: context.taskDescription,
    recentFailures: context.feedbackContext?.recentFailures?.map((f: any) => f.content),
    toolCallPatterns: context.trackerState?.recentTools,
    complexity: context.trackerState?.consecutiveToolCalls > 5 ? 'high' : 'medium',
  });
  
  // Build weighted selection
  const primaryRole = suggestions[0]?.role || 'coder';
  const secondaryRoles = suggestions.slice(1, 4).map(s => s.role);
  
  // Generate routing options
  const routingOptions: RoutingOption[] = suggestions.map(suggestion => ({
    target: suggestion.role,
    weight: suggestion.weight,
    reason: suggestion.reason,
    conditions: suggestion.triggerCondition ? [suggestion.triggerCondition] : [],
  }));
  
  return {
    primaryRole,
    secondaryRoles,
    routingOptions,
    confidence: suggestions[0]?.confidence || 0.5,
    reasoning: suggestions[0]?.reason || 'Default selection based on context',
  };
}

// ============================================================================
// Role Injection for Prompts
// ============================================================================

/**
 * Generate role injection section for system prompt
 */
export function generateRoleInjectionSection(
  selection: WeightedRoleSelection,
  includeOptions: boolean = true
): string {
  let section = `\n## Role Routing\n`;
  section += `Primary role: **${selection.primaryRole}** (${(selection.confidence * 100).toFixed(0)}% confidence)\n`;
  section += `Reasoning: ${selection.reasoning}\n`;
  
  if (selection.secondaryRoles.length > 0) {
    section += `\nAlternative roles:\n`;
    selection.secondaryRoles.forEach(role => {
      section += `- ${role}\n`;
    });
  }
  
  if (includeOptions && selection.routingOptions.length > 0) {
    section += `\n## Routing Options\n`;
    section += `You may redirect to these roles based on task requirements:\n`;
    
    selection.routingOptions.forEach(option => {
      section += `- **${option.target}** (${(option.weight * 100).toFixed(0)}% weight): ${option.reason}\n`;
      if (option.conditions.length > 0) {
        section += `  Trigger conditions: ${option.conditions.join(', ')}\n`;
      }
    });
  }
  
  return section;
}

/**
 * Generate role-specific instructions for a role
 */
export function generateRoleInstructions(role: Role): string {
  const capabilities = ROLE_CAPABILITIES[role];
  
  let instructions = `\n## ${role.charAt(0).toUpperCase() + role.slice(1)} Role Instructions\n`;
  instructions += `Focus on: ${capabilities.strengths.join(', ')}\n`;
  instructions += `Avoid: ${capabilities.weaknesses.join(', ')}\n`;
  instructions += `Best for: ${capabilities.bestFor.join('; ')}\n`;
  
  return instructions;
}

// ============================================================================
// Tool Selection with Role Context
// ============================================================================

export interface ToolSuggestion {
  toolName: string;
  role: Role;
  weight: number;
  reason: string;
}

/**
 * Generate tool suggestions based on role and context
 */
export function suggestToolsForRole(
  role: Role,
  context: {
    taskDescription?: string;
    availableTools?: string[];
    recentToolCalls?: string[];
  }
): ToolSuggestion[] {
  const suggestions: ToolSuggestion[] = [];
  const { taskDescription = '', availableTools = [], recentToolCalls = [] } = context;
  
  // Role-specific tool weights
  const roleToolWeights: Record<Role, Record<string, number>> = {
    coder: {
      'write_file': 0.9,
      'read_file': 0.8,
      'execute_bash': 0.7,
      'search_files': 0.6,
    },
    reviewer: {
      'read_file': 0.9,
      'search_files': 0.8,
      'execute_bash': 0.5,
    },
    planner: {
      'search_files': 0.8,
      'read_file': 0.7,
      'list_directory': 0.6,
    },
    architect: {
      'search_files': 0.9,
      'read_file': 0.8,
      'list_directory': 0.7,
    },
    researcher: {
      'web_search': 0.9,
      'search_files': 0.7,
      'read_file': 0.6,
    },
    debugger: {
      'execute_bash': 0.9,
      'read_file': 0.7,
      'search_files': 0.6,
    },
    specialist: {
      'execute_bash': 0.8,
      'read_file': 0.8,
      'search_files': 0.7,
    },
    orchestrator: {
      'list_directory': 0.9,
      'search_files': 0.7,
      'read_file': 0.6,
    },
    simplifier: {
      'read_file': 0.7,
      'list_directory': 0.6,
    },
  };
  
  const weights = roleToolWeights[role] || {};
  
  // Generate suggestions for available tools
  for (const tool of availableTools) {
    const weight = weights[tool] || 0.5;
    if (weight > 0.4) {
      suggestions.push({
        toolName: tool,
        role,
        weight,
        reason: `${role} tasks typically benefit from ${tool}`,
      });
    }
  }
  
  // Sort by weight
  return suggestions.sort((a, b) => b.weight - a.weight);
}

/**
 * Generate tool selection section for role
 */
export function generateToolSelectionSection(
  role: Role,
  context: {
    taskDescription?: string;
    availableTools?: string[];
    recentToolCalls?: string[];
  }
): string {
  const suggestions = suggestToolsForRole(role, context);
  
  if (suggestions.length === 0) {
    return '';
  }
  
  let section = `\n## Tool Selection for ${role} Role\n`;
  section += `Suggested tools (sorted by relevance):\n`;
  
  suggestions.forEach(suggestion => {
    section += `- **${suggestion.toolName}** (${(suggestion.weight * 100).toFixed(0)}%): ${suggestion.reason}\n`;
  });
  
  return section;
}