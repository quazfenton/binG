/**
 * E2B Advanced Agent Examples
 * 
 * Examples demonstrating Amp and Codex integration with E2B sandboxes
 * 
 * @see https://e2b.dev/docs/agents/amp
 * @see https://e2b.dev/docs/agents/codex
 */

import { Sandbox } from '@e2b/code-interpreter'
import { createAmpService, createCodexService, CodexSchemas } from '@/lib/sandbox/providers'

// ==================== Amp Examples ====================

/**
 * Example 1: Basic Amp Execution
 * 
 * Run Amp coding agent with a simple prompt
 */
async function basicAmpExample() {
  const sandbox = await Sandbox.create('amp', {
    envs: {
      AMP_API_KEY: process.env.AMP_API_KEY!,
    },
  })

  try {
    const amp = createAmpService(sandbox, process.env.AMP_API_KEY!)

    const result = await amp.run({
      prompt: 'Create a hello world HTTP server in Go',
      dangerouslyAllowAll: true,
    })

    console.log('Amp Result:')
    console.log('stdout:', result.stdout)
    console.log('stderr:', result.stderr)
  } finally {
    await sandbox.kill()
  }
}

/**
 * Example 2: Amp with Streaming JSON
 * 
 * Stream Amp events in real-time for monitoring
 */
async function ampStreamingExample() {
  const sandbox = await Sandbox.create('amp', {
    envs: {
      AMP_API_KEY: process.env.AMP_API_KEY!,
    },
  })

  try {
    const amp = createAmpService(sandbox, process.env.AMP_API_KEY!)

    console.log('Starting Amp with streaming JSON...')

    for await (const event of amp.streamJson({
      prompt: 'Find and fix all TODO comments in the codebase',
      streamJson: true,
      workingDir: '/home/user/repo',
    })) {
      switch (event.type) {
        case 'assistant':
          console.log(
            `[Assistant] Tokens: ${event.message.usage?.output_tokens || 0}`
          )
          break
        case 'result':
          console.log(
            `[Result] ${event.message.subtype} in ${event.message.duration_ms}ms`
          )
          break
        case 'tool_call':
          console.log(
            `[Tool] ${event.message.tool_call?.name}: ${JSON.stringify(event.message.tool_call?.arguments)}`
          )
          break
        case 'thinking':
          console.log(`[Thinking] ${event.message.content}`)
          break
      }
    }
  } finally {
    await sandbox.kill()
  }
}

/**
 * Example 3: Amp Thread Management
 * 
 * Continue conversations with follow-up tasks
 */
async function ampThreadExample() {
  const sandbox = await Sandbox.create('amp', {
    envs: {
      AMP_API_KEY: process.env.AMP_API_KEY!,
    },
    timeoutMs: 600000,
  })

  try {
    const amp = createAmpService(sandbox, process.env.AMP_API_KEY!)

    // Start a new thread with initial task
    console.log('Starting initial analysis...')
    const initial = await amp.run({
      prompt: 'Analyze the codebase and create a refactoring plan',
      dangerouslyAllowAll: true,
      workingDir: '/home/user/repo',
      onStdout: (data) => process.stdout.write(data),
    })

    // List threads and get the most recent
    const threads = await amp.threads.list()
    console.log(`Found ${threads.length} threads`)

    if (threads.length > 0) {
      const threadId = threads[0].id
      console.log(`Continuing thread ${threadId}...`)

      // Continue the thread with follow-up task
      const followUp = await amp.threads.continue(
        threadId,
        'Now implement step 1 of the plan'
      )

      console.log('Follow-up result:', followUp.stdout)
    }

    // Get git diff to see changes
    const diff = await sandbox.commands.run('cd /home/user/repo && git diff')
    console.log('Git Diff:')
    console.log(diff.stdout)
  } finally {
    await sandbox.kill()
  }
}

// ==================== Codex Examples ====================

/**
 * Example 4: Basic Codex Execution
 * 
 * Run OpenAI Codex with auto-approval
 */
async function basicCodexExample() {
  const sandbox = await Sandbox.create('codex', {
    envs: {
      CODEX_API_KEY: process.env.CODEX_API_KEY!,
    },
  })

  try {
    const codex = createCodexService(sandbox, process.env.CODEX_API_KEY!)

    const result = await codex.run({
      prompt: 'Create a hello world HTTP server in Go',
      fullAuto: true,
      skipGitRepoCheck: true,
    })

    console.log('Codex Result:')
    console.log('stdout:', result.stdout)
    console.log('exitCode:', result.exitCode)
  } finally {
    await sandbox.kill()
  }
}

/**
 * Example 5: Codex with Schema-Validated Output
 * 
 * Get structured JSON output for security review
 */
async function codexSchemaExample() {
  const sandbox = await Sandbox.create('codex', {
    envs: {
      CODEX_API_KEY: process.env.CODEX_API_KEY!,
    },
  })

  try {
    // Write security review schema
    await sandbox.files.write(
      '/home/user/schema.json',
      JSON.stringify(CodexSchemas.securityReview, null, 2)
    )

    const codex = createCodexService(sandbox, process.env.CODEX_API_KEY!)

    const result = await codex.run({
      prompt: 'Review this codebase for security issues',
      fullAuto: true,
      skipGitRepoCheck: true,
      outputSchemaPath: '/home/user/schema.json',
      workingDir: '/home/user/repo',
    })

    // Parse and display structured output
    const output = JSON.parse(result.stdout)
    console.log('Security Issues Found:')
    output.issues.forEach((issue: any) => {
      console.log(`  - [${issue.severity}] ${issue.file}:${issue.line}`)
      console.log(`    ${issue.description}`)
      if (issue.recommendation) {
        console.log(`    Recommendation: ${issue.recommendation}`)
      }
    })
  } finally {
    await sandbox.kill()
  }
}

/**
 * Example 6: Codex with Image Input
 * 
 * Implement UI from design mockup
 */
async function codexImageExample() {
  const sandbox = await Sandbox.create('codex', {
    envs: {
      CODEX_API_KEY: process.env.CODEX_API_KEY!,
    },
    timeoutMs: 600000,
  })

  try {
    // Read design mockup from local filesystem
    const fs = await import('node:fs')
    const mockupPath = './mockup.png'
    const mockupData = fs.readFileSync(mockupPath)

    // Upload to sandbox
    await sandbox.files.write('/home/user/mockup.png', mockupData)

    const codex = createCodexService(sandbox, process.env.CODEX_API_KEY!)

    const result = await codex.runWithImage({
      prompt: 'Implement this UI design as a React component with TypeScript',
      imagePath: '/home/user/mockup.png',
      imageData: mockupData,
      fullAuto: true,
      skipGitRepoCheck: true,
      workingDir: '/home/user/repo',
    })

    console.log('Implementation complete!')
    console.log('stdout:', result.stdout)

    // Show git diff
    const diff = await sandbox.commands.run('cd /home/user/repo && git diff')
    console.log('Changes:')
    console.log(diff.stdout)
  } finally {
    await sandbox.kill()
  }
}

/**
 * Example 7: Codex Streaming Events
 * 
 * Monitor Codex execution in real-time
 */
async function codexStreamingExample() {
  const sandbox = await Sandbox.create('codex', {
    envs: {
      CODEX_API_KEY: process.env.CODEX_API_KEY!,
    },
  })

  try {
    const codex = createCodexService(sandbox, process.env.CODEX_API_KEY!)

    console.log('Starting Codex with event streaming...')

    for await (const event of codex.streamEvents({
      prompt: 'Refactor the utils module into separate files',
      fullAuto: true,
      skipGitRepoCheck: true,
      workingDir: '/home/user/repo',
    })) {
      switch (event.type) {
        case 'tool_call':
          console.log(
            `[Tool] ${event.data.tool_name}: ${JSON.stringify(event.data.arguments)}`
          )
          break
        case 'file_change':
          console.log(
            `[File] ${event.data.change_type} ${event.data.file_path}`
          )
          break
        case 'message':
          console.log(`[Message] ${event.data.content}`)
          break
        case 'error':
          console.error(`[Error] ${event.data.error}`)
          break
        case 'thinking':
          console.log(`[Thinking] ${event.data.thinking}`)
          break
      }
    }

    console.log('Codex execution complete!')
  } finally {
    await sandbox.kill()
  }
}

// ==================== Combined Examples ====================

/**
 * Example 8: Multi-Agent Workflow (Amp + Codex)
 * 
 * Use Amp for planning, Codex for implementation
 */
async function multiAgentExample() {
  // Create sandboxes for both agents
  const ampSandbox = await Sandbox.create('amp', {
    envs: { AMP_API_KEY: process.env.AMP_API_KEY! },
    timeoutMs: 600000,
  })

  const codexSandbox = await Sandbox.create('codex', {
    envs: { CODEX_API_KEY: process.env.CODEX_API_KEY! },
    timeoutMs: 600000,
  })

  try {
    // Clone repository to both sandboxes
    const repoUrl = 'https://github.com/your-org/your-repo.git'
    await ampSandbox.git.clone(repoUrl, { path: '/home/user/repo', depth: 1 })
    await codexSandbox.git.clone(repoUrl, { path: '/home/user/repo', depth: 1 })

    // Step 1: Amp creates refactoring plan
    const amp = createAmpService(ampSandbox, process.env.AMP_API_KEY!)
    const planResult = await amp.run({
      prompt: 'Analyze the codebase and create a detailed refactoring plan with specific steps',
      dangerouslyAllowAll: true,
      workingDir: '/home/user/repo',
    })

    console.log('Refactoring Plan:')
    console.log(planResult.stdout)

    // Step 2: Codex implements the plan
    const codex = createCodexService(codexSandbox, process.env.CODEX_API_KEY!)
    const implementResult = await codex.run({
      prompt: `Implement this refactoring plan:\n\n${planResult.stdout}`,
      fullAuto: true,
      skipGitRepoCheck: true,
      workingDir: '/home/user/repo',
    })

    console.log('Implementation Result:')
    console.log(implementResult.stdout)

    // Step 3: Get final diff
    const diff = await codexSandbox.commands.run(
      'cd /home/user/repo && git diff'
    )
    console.log('Final Changes:')
    console.log(diff.stdout)
  } finally {
    await ampSandbox.kill()
    await codexSandbox.kill()
  }
}

// ==================== Export Examples ====================

export {
  basicAmpExample,
  ampStreamingExample,
  ampThreadExample,
  basicCodexExample,
  codexSchemaExample,
  codexImageExample,
  codexStreamingExample,
  multiAgentExample,
}

// Run example if executed directly
if (process.argv[2] === '--run-example') {
  const exampleName = process.argv[3] || 'basic-amp'

  const examples: Record<string, () => Promise<void>> = {
    'basic-amp': basicAmpExample,
    'amp-stream': ampStreamingExample,
    'amp-thread': ampThreadExample,
    'basic-codex': basicCodexExample,
    'codex-schema': codexSchemaExample,
    'codex-image': codexImageExample,
    'codex-stream': codexStreamingExample,
    'multi-agent': multiAgentExample,
  }

  const example = examples[exampleName]
  if (example) {
    console.log(`Running example: ${exampleName}`)
    example().catch(console.error)
  } else {
    console.error('Unknown example:', exampleName)
    console.log('Available examples:', Object.keys(examples))
  }
}
