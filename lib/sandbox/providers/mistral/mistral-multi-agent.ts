/**
 * Mistral Multi-Agent Collaboration
 * 
 * Support for multiple specialized agents working together.
 * Implements agent orchestration, task delegation, and result aggregation.
 * 
 * @see https://docs.mistral.ai/agents/
 */

import { Mistral } from '@mistralai/mistralai'
import { randomUUID } from 'node:crypto'
import type { ToolResult } from '../../types'
import type { ToolType } from './mistral-types'

export interface AgentSpec {
  id?: string
  name: string
  role: string
  description: string
  instructions: string
  tools: ToolType[]
  model?: string
}

export interface MultiAgentTask {
  id: string
  description: string
  assignedAgent?: string
  status: 'pending' | 'assigned' | 'running' | 'completed' | 'failed'
  input: string
  output?: string
  error?: string
}

export interface CollaborationResult {
  collaborationId: string
  status: 'initialized' | 'running' | 'completed' | 'failed'
  tasks: MultiAgentTask[]
  agentOutputs: Record<string, string>
  finalOutput?: string
  durationMs: number
}

export interface AgentMessage {
  fromAgent: string
  toAgent: string
  content: string
  timestamp: number
}

export interface CollaborationConfig {
  maxParallelAgents?: number
  timeoutPerAgent?: number
  enableMessagePassing?: boolean
  consensusThreshold?: number
  aggregatorAgent?: string
}

const DEFAULT_CONFIG: Required<CollaborationConfig> = {
  maxParallelAgents: 3,
  timeoutPerAgent: 60000,
  enableMessagePassing: true,
  consensusThreshold: 0.7,
  aggregatorAgent: 'coordinator',
}

export class MistralMultiAgentCollaboration {
  private client: Mistral
  private apiKey: string
  private config: Required<CollaborationConfig>
  private agents: Map<string, AgentSpec> = new Map()
  private messageQueue: AgentMessage[] = []

  constructor(apiKey: string, config: CollaborationConfig = {}, serverURL?: string) {
    this.apiKey = apiKey
    this.client = new Mistral({
      apiKey,
      serverURL: serverURL || 'https://api.mistral.ai/v1',
    })
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * Register an agent with the collaboration
   */
  async registerAgent(agentSpec: AgentSpec): Promise<string> {
    const agentId = agentSpec.id || `agent-${randomUUID()}`
    
    const agent: AgentSpec = {
      ...agentSpec,
      id: agentId,
    }

    // Create agent in Mistral if not exists
    try {
      const mistralAgent = await this.client.beta.agents.create({
        model: agent.model || 'mistral-medium-latest',
        name: agent.name,
        description: agent.description,
        instructions: agent.instructions,
        tools: agent.tools.map(t => ({ type: t })),
      })
      
      agent.id = mistralAgent.id
    } catch (error) {
      console.warn('[MultiAgent] Failed to create Mistral agent, using local only:', error)
    }

    this.agents.set(agentId, agent)
    return agentId
  }

  /**
   * Execute a task with multiple agents
   */
  async executeCollaboration(
    taskDescription: string,
    agentRoles?: string[]
  ): Promise<CollaborationResult> {
    const startTime = Date.now()
    const collaborationId = `collab-${randomUUID()}`
    
    // Determine which agents to use
    const activeAgents = agentRoles 
      ? Array.from(this.agents.values()).filter(a => agentRoles.includes(a.role))
      : Array.from(this.agents.values())

    if (activeAgents.length === 0) {
      throw new Error('No agents registered for collaboration')
    }

    // Create tasks for each agent
    const tasks: MultiAgentTask[] = activeAgents.map((agent, index) => ({
      id: `task-${index}`,
      description: taskDescription,
      assignedAgent: agent.id,
      status: 'pending' as const,
      input: this.buildTaskPrompt(agent, taskDescription),
    }))

    // Execute tasks in parallel
    const agentOutputs: Record<string, string> = {}
    
    const taskPromises = tasks.map(async (task) => {
      const agent = this.agents.get(task.assignedAgent!)
      if (!agent) {
        task.status = 'failed'
        task.error = 'Agent not found'
        return
      }

      task.status = 'running'

      try {
        const output = await this.executeAgentTask(agent, task.input)
        task.status = 'completed'
        task.output = output
        agentOutputs[agent.role] = output

        // Enable message passing between agents
        if (this.config.enableMessagePassing) {
          this.broadcastMessage(agent.role, output)
        }
      } catch (error) {
        task.status = 'failed'
        task.error = error instanceof Error ? error.message : 'Unknown error'
      }
    })

    await Promise.all(taskPromises)

    // Aggregate results
    const finalOutput = await this.aggregateResults(agentOutputs, taskDescription)

    return {
      collaborationId,
      status: tasks.every(t => t.status === 'completed') ? 'completed' : 'failed',
      tasks,
      agentOutputs,
      finalOutput,
      durationMs: Date.now() - startTime,
    }
  }

  /**
   * Execute a task with sequential agent handoff
   */
  async executeSequential(
    taskDescription: string,
    agentSequence: string[]
  ): Promise<CollaborationResult> {
    const startTime = Date.now()
    const collaborationId = `collab-seq-${randomUUID()}`
    
    const tasks: MultiAgentTask[] = []
    const agentOutputs: Record<string, string> = {}
    let previousOutput = taskDescription

    for (let i = 0; i < agentSequence.length; i++) {
      const role = agentSequence[i]
      const agent = Array.from(this.agents.values()).find(a => a.role === role)
      
      if (!agent) {
        throw new Error(`Agent with role ${role} not found`)
      }

      const task: MultiAgentTask = {
        id: `task-${i}`,
        description: `Step ${i + 1}: ${role}`,
        assignedAgent: agent.id,
        status: 'running',
        input: previousOutput,
      }

      tasks.push(task)

      try {
        const output = await this.executeAgentTask(agent, this.buildSequentialPrompt(agent, previousOutput, i + 1))
        task.status = 'completed'
        task.output = output
        agentOutputs[role] = output
        previousOutput = output
      } catch (error) {
        task.status = 'failed'
        task.error = error instanceof Error ? error.message : 'Unknown error'
        break
      }
    }

    return {
      collaborationId,
      status: tasks.every(t => t.status === 'completed') ? 'completed' : 'failed',
      tasks,
      agentOutputs,
      finalOutput: previousOutput,
      durationMs: Date.now() - startTime,
    }
  }

  /**
   * Send a message to another agent
   */
  sendMessage(fromRole: string, toRole: string, content: string): void {
    const message: AgentMessage = {
      fromAgent: fromRole,
      toAgent: toRole,
      content,
      timestamp: Date.now(),
    }
    this.messageQueue.push(message)
  }

  /**
   * Get messages for an agent
   */
  getMessagesForAgent(agentRole: string): AgentMessage[] {
    return this.messageQueue.filter(m => m.toAgent === agentRole)
  }

  /**
   * Clear message queue
   */
  clearMessages(): void {
    this.messageQueue = []
  }

  /**
   * Get registered agents
   */
  listAgents(): AgentSpec[] {
    return Array.from(this.agents.values())
  }

  private async executeAgentTask(agent: AgentSpec, prompt: string): Promise<string> {
    try {
      const conversation = await this.client.beta.conversations.start({
        agentId: agent.id,
        inputs: [{ role: 'user', content: prompt }],
        store: true,
      })

      return this.extractResponse(conversation)
    } catch (error) {
      throw new Error(`Agent ${agent.role} failed: ${error instanceof Error ? error.message : error}`)
    }
  }

  private async aggregateResults(
    agentOutputs: Record<string, string>,
    originalTask: string
  ): Promise<string> {
    // Use coordinator agent to aggregate results
    const coordinator = Array.from(this.agents.values()).find(
      a => a.role === this.config.aggregatorAgent
    )

    if (!coordinator) {
      // Fallback: concatenate all outputs
      return Object.entries(agentOutputs)
        .map(([role, output]) => `=== ${role} ===\n${output}`)
        .join('\n\n')
    }

    const aggregationPrompt = `Aggregate the following agent outputs into a coherent response for the original task:
    
Original Task: ${originalTask}

${Object.entries(agentOutputs)
  .map(([role, output]) => `${role}:\n${output}`)
  .join('\n\n')}

Provide a consolidated answer.`

    return this.executeAgentTask(coordinator, aggregationPrompt)
  }

  private buildTaskPrompt(agent: AgentSpec, task: string): string {
    return `${agent.instructions}

Task: ${task}

Execute this task and return your result.`
  }

  private buildSequentialPrompt(agent: AgentSpec, previousOutput: string, step: number): string {
    return `${agent.instructions}

This is step ${step} of a multi-step task.

Previous step's output:
${previousOutput}

Continue from here and provide your output.`
  }

  private broadcastMessage(fromRole: string, content: string): void {
    for (const agent of this.agents.values()) {
      if (agent.role !== fromRole) {
        this.messageQueue.push({
          fromAgent: fromRole,
          toAgent: agent.role,
          content,
          timestamp: Date.now(),
        })
      }
    }
  }

  private extractResponse(response: any): string {
    if (!response?.outputs || !Array.isArray(response.outputs)) {
      return ''
    }

    const chunks: string[] = []
    for (const entry of response.outputs) {
      if (entry?.type === 'message.output') {
        const content = entry.content
        if (typeof content === 'string') {
          chunks.push(content)
        } else if (Array.isArray(content)) {
          for (const chunk of content) {
            if (chunk?.text) {
              chunks.push(chunk.text)
            }
          }
        }
      }
    }

    return chunks.join('\n').trim()
  }
}

/**
 * Create a default collaboration with common agent roles
 */
export async function createDefaultCollaboration(
  apiKey: string,
  config?: CollaborationConfig
): Promise<MistralMultiAgentCollaboration> {
  const collaboration = new MistralMultiAgentCollaboration(apiKey, config)

  // Register default agents
  await collaboration.registerAgent({
    name: 'Research Agent',
    role: 'researcher',
    description: 'Gathers information and researches topics',
    instructions: `You are a research specialist. 
Your job is to find and summarize relevant information.
Be thorough and cite sources when possible.
Focus on accuracy and completeness.`,
    tools: ['web_search'],
  })

  await collaboration.registerAgent({
    name: 'Code Agent',
    role: 'coder',
    description: 'Writes and executes code',
    instructions: `You are a coding specialist.
Your job is to write clean, efficient code.
Always consider edge cases and error handling.
Explain your code when necessary.`,
    tools: ['code_interpreter'],
  })

  await collaboration.registerAgent({
    name: 'Review Agent',
    role: 'reviewer',
    description: 'Reviews and validates outputs',
    instructions: `You are a quality assurance specialist.
Your job is to review and validate outputs.
Check for accuracy, completeness, and correctness.
Provide constructive feedback.`,
    tools: ['code_interpreter'],
  })

  await collaboration.registerAgent({
    name: 'Coordinator',
    role: 'coordinator',
    description: 'Orchestrates multi-agent tasks',
    instructions: `You are a collaboration coordinator.
Your job is to aggregate results from multiple agents.
Synthesize different perspectives into a coherent response.
Ensure all aspects of the task are addressed.`,
    tools: ['code_interpreter', 'web_search'],
  })

  return collaboration
}

export function createMultiAgentCollaboration(
  apiKey: string,
  config?: CollaborationConfig
): MistralMultiAgentCollaboration {
  return new MistralMultiAgentCollaboration(apiKey, config)
}
