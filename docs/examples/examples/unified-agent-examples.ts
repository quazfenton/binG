/**
 * Unified Agent Examples
 * 
 * Examples demonstrating how to use the Unified Agent Interface
 * for various AI agent scenarios.
 */

import { createAgent, createQuickAgent } from '@bing/shared/agent/unified-agent'

// ==================== Example 1: Basic Terminal Agent ====================

/**
 * Simple terminal-based agent for code execution and CLI operations
 */
async function basicTerminalAgent() {
  const agent = await createQuickAgent({
    provider: 'e2b',
  })

  try {
    // Execute shell commands
    await agent.terminalSend('cd /workspace')
    await agent.terminalSend('npm init -y')
    await agent.terminalSend('npm install express')

    // Create a file
    await agent.writeFile('server.js', `
const express = require('express')
const app = express()

app.get('/', (req, res) => {
  res.send('Hello, World!')
})

app.listen(3000, () => {
  console.log('Server running on port 3000')
})
`)

    // Start the server
    await agent.terminalSend('node server.js &')

    // Check output
    const output = agent.getTerminalOutput()
    console.log('Terminal output:', output)
  } finally {
    await agent.cleanup()
  }
}

// ==================== Example 2: Computer Use Agent ====================

/**
 * Desktop automation agent for GUI tasks
 * Example: Automate a web form submission
 */
async function computerUseAgent() {
  const agent = await createQuickAgent({
    provider: 'e2b',
    desktop: true,
  })

  try {
    // Take initial screenshot
    const screenshot = await agent.desktopScreenshot()
    const resolution = await agent.desktopResolution()
    
    console.log(`Screen resolution: ${resolution.width}x${resolution.height}`)

    // Open browser (assuming browser is available on desktop)
    await agent.desktopHotkey(['Super', 'R']) // Open run dialog
    await agent.desktopType('firefox')
    await agent.desktopPress('Enter')

    // Wait for browser to open
    await new Promise(resolve => setTimeout(resolve, 2000))

    // Navigate to URL (simulated clicks)
    await agent.desktopClick({ x: 100, y: 50 }) // Click address bar
    await agent.desktopType('https://example.com')
    await agent.desktopPress('Enter')

    // Wait for page load
    await new Promise(resolve => setTimeout(resolve, 3000))

    // Take screenshot after navigation
    const afterScreenshot = await agent.desktopScreenshot()
    
    // Fill form (example coordinates)
    await agent.desktopClick({ x: 200, y: 300 }) // Click input field
    await agent.desktopType('John Doe')
    await agent.desktopClick({ x: 200, y: 350 }) // Click email field
    await agent.desktopType('john@example.com')
    await agent.desktopClick({ x: 200, y: 400 }) // Click submit button

  } finally {
    await agent.cleanup()
  }
}

// ==================== Example 3: MCP-Enhanced Agent ====================

/**
 * Agent with MCP tools for extended capabilities
 * Example: Research using browser automation
 */
async function mcpAgent() {
  const agent = await createAgent({
    provider: 'e2b',
    capabilities: ['terminal', 'mcp'],
    mcp: {
      browserbase: {
        apiKey: process.env.BROWSERBASE_API_KEY!,
        projectId: process.env.BROWSERBASE_PROJECT_ID!,
      },
      filesystem: {
        rootPath: '/workspace',
      },
    },
  })

  try {
    // List available MCP tools
    const tools = await agent.mcpListTools()
    console.log('Available MCP tools:', tools)

    // Use browser to research
    const researchResult = await agent.mcpCall('browserbase_navigate', {
      url: 'https://news.ycombinator.com',
    })

    // Extract headlines
    const headlines = await agent.mcpCall('browserbase_evaluate', {
      script: `
        Array.from(document.querySelectorAll('.titleline a')).map(a => a.textContent)
      `,
    })

    console.log('Headlines:', headlines)

    // Save results to file
    await agent.writeFile('headlines.json', JSON.stringify(headlines, null, 2))

  } finally {
    await agent.cleanup()
  }
}

// ==================== Example 4: Git Workflow Agent ====================

/**
 * Agent for automated Git workflows
 * Example: Clone, modify, commit, and push
 */
async function gitWorkflowAgent() {
  const agent = await createQuickAgent({
    provider: 'e2b',
  })

  try {
    // Clone repository
    await agent.gitClone('https://github.com/owner/repo.git', {
      path: 'my-repo',
      depth: 1,
    })

    // Navigate to repo
    await agent.terminalSend('cd my-repo')

    // Make changes
    await agent.writeFile('src/feature.ts', `
export function newFeature(): string {
  return 'Hello from new feature!'
}
`)

    // Check status
    const status = await agent.gitStatus()
    console.log('Git status:', status)

    // Commit changes
    await agent.gitCommit('feat: add new feature', true)

    // Push to remote
    await agent.gitPush('origin', 'main')

    console.log('Changes pushed successfully!')

  } finally {
    await agent.cleanup()
  }
}

// ==================== Example 5: Code Execution Agent ====================

/**
 * Agent for multi-language code execution
 * Example: Data analysis pipeline
 */
async function codeExecutionAgent() {
  const agent = await createAgent({
    provider: 'e2b',
    capabilities: ['terminal', 'code-execution'],
    codeExecution: {
      enabled: true,
      defaultLanguage: 'python',
      timeout: 60000,
    },
  })

  try {
    // Python data analysis
    const pythonResult = await agent.codeExecute('python', `
import pandas as pd
import numpy as np

# Create sample data
data = {
    'name': ['Alice', 'Bob', 'Charlie', 'David'],
    'age': [25, 30, 35, 40],
    'salary': [50000, 60000, 70000, 80000]
}

df = pd.DataFrame(data)

# Analysis
print("Mean age:", df['age'].mean())
print("Mean salary:", df['salary'].mean())
print("\\nCorrelation:")
print(df.corr())
`)

    console.log('Python output:', pythonResult.output)

    // JavaScript visualization
    const jsResult = await agent.codeExecute('javascript', `
const data = [1, 2, 3, 4, 5];
const squared = data.map(x => x * x);
console.log('Original:', data);
console.log('Squared:', squared);
`)

    console.log('JavaScript output:', jsResult.output)

  } finally {
    await agent.cleanup()
  }
}

// ==================== Example 6: Multi-Step Agent Workflow ====================

/**
 * Complex multi-step workflow combining all capabilities
 * Example: Full development cycle
 */
async function fullWorkflowAgent() {
  const agent = await createAgent({
    provider: 'e2b',
    capabilities: ['terminal', 'desktop', 'mcp', 'code-execution', 'git'],
    mcp: {
      browserbase: {
        apiKey: process.env.BROWSERBASE_API_KEY!,
      },
    },
  })

  try {
    // Step 1: Research requirements using MCP
    const requirements = await agent.mcpCall('browserbase_navigate', {
      url: 'https://github.com/trending',
    })

    // Step 2: Clone trending project
    await agent.gitClone('https://github.com/trending-project.git', {
      depth: 1,
    })

    // Step 3: Analyze codebase
    await agent.terminalSend('cd trending-project')
    await agent.terminalSend('find . -name "*.ts" -o -name "*.js" | head -20')

    // Step 4: Run tests
    const testResult = await agent.codeExecute('python', `
import subprocess
result = subprocess.run(['npm', 'test'], capture_output=True, text=True)
print(result.stdout)
print(result.stderr)
`)

    // Step 5: Make improvements (using desktop for IDE)
    await agent.desktopHotkey(['Super', 'R'])
    await agent.desktopType('code .') // Open VS Code
    await agent.desktopPress('Enter')

    // Step 6: Commit and push
    await agent.gitCommit('improve: optimize performance', true)
    await agent.gitPush()

    console.log('Full workflow completed!')

  } finally {
    await agent.cleanup()
  }
}

// ==================== Example 7: Agent with Output Callbacks ====================

/**
 * Agent with real-time output monitoring
 */
async function agentWithCallbacks() {
  const agent = await createQuickAgent({
    provider: 'e2b',
  })

  // Set up output callback for real-time monitoring
  agent.onTerminalOutput((output) => {
    console.log(`[${new Date(output.timestamp).toISOString()}] ${output.type}: ${output.data}`)
  })

  try {
    // Long-running command with streaming output
    await agent.terminalSend('npm install')
    
    // Output will be logged via callback in real-time
    
    // Check session stats
    const stats = agent.getSessionStats()
    console.log('Session stats:', stats)

  } finally {
    await agent.cleanup()
  }
}

// ==================== Example 8: Error Handling and Recovery ====================

/**
 * Agent with robust error handling
 */
async function resilientAgent() {
  const agent = await createQuickAgent({
    provider: 'e2b',
  })

  try {
    // Try primary operation
    try {
      await agent.terminalSend('some-command')
    } catch (error: any) {
      console.warn('Primary command failed, trying alternative...')
      
      // Fallback operation
      await agent.terminalSend('alternative-command')
    }

    // Check session health
    const stats = agent.getSessionStats()
    if (stats.uptime > 300000) { // 5 minutes
      console.log('Session running long, consider refreshing')
    }

  } catch (error: any) {
    console.error('Agent error:', error.message)
    
    // Attempt recovery
    try {
      await agent.cleanup()
    } catch (cleanupError) {
      console.error('Cleanup failed:', cleanupError)
    }
    
    throw error
  }
}

// ==================== Export Examples ====================

export {
  basicTerminalAgent,
  computerUseAgent,
  mcpAgent,
  gitWorkflowAgent,
  codeExecutionAgent,
  fullWorkflowAgent,
  agentWithCallbacks,
  resilientAgent,
}

// Run example if executed directly
if (process.argv[2] === '--run-example') {
  const exampleName = process.argv[3] || 'basic'
  
  const examples: Record<string, () => Promise<void>> = {
    basic: basicTerminalAgent,
    desktop: computerUseAgent,
    mcp: mcpAgent,
    git: gitWorkflowAgent,
    code: codeExecutionAgent,
    full: fullWorkflowAgent,
    callbacks: agentWithCallbacks,
    resilient: resilientAgent,
  }

  const example = examples[exampleName]
  if (example) {
    console.log(`Running example: ${exampleName}`)
    example().catch(console.error)
  } else {
    console.error('Unknown example:', exampleName)
  }
}
