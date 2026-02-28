# Integration Usage Examples

**Date:** 2026-02-27  
**Purpose:** Comprehensive usage examples for all integration enhancements

---

## Table of Contents

1. [E2B Amp Integration](#e2b-amp-integration)
2. [E2B Git Integration](#e2b-git-integration)
3. [MCP Client Enhancements](#mcp-client-enhancements)
4. [Smithery Registry](#smithery-registry)
5. [Composio Triggers](#composio-triggers)

---

## E2B Amp Integration

### Basic Amp Execution

```typescript
import { Sandbox } from '@e2b/code-interpreter';
import { createAmpService } from '@/lib/sandbox/providers/e2b-amp-service';

async function runAmpTask() {
  // Create sandbox with Amp template
  const sandbox = await Sandbox.create('amp', {
    envs: {
      AMP_API_KEY: process.env.AMP_API_KEY,
    },
    timeoutMs: 600000, // 10 minutes
  });

  try {
    // Get Amp service
    const amp = createAmpService(sandbox, sandbox.sandboxId);

    // Execute task
    const result = await amp.execute({
      prompt: 'Create a hello world HTTP server in Go',
      dangerouslyAllowAll: true,
    });

    console.log('Output:', result.stdout);
    console.log('Thread ID:', result.threadId);
  } finally {
    await sandbox.kill();
  }
}
```

### Streaming JSON Events

```typescript
async function runAmpWithStreaming() {
  const sandbox = await Sandbox.create('amp', {
    envs: { AMP_API_KEY: process.env.AMP_API_KEY },
  });

  try {
    const amp = createAmpService(sandbox, sandbox.sandboxId);

    // Execute with streaming JSON for real-time monitoring
    const result = await amp.execute({
      prompt: 'Refactor the utils module to use async/await',
      streamJson: true,
      onStdout: (data) => {
        // Parse streaming JSON events
        for (const line of data.split('\n').filter(Boolean)) {
          try {
            const event = JSON.parse(line);
            
            if (event.type === 'assistant') {
              console.log(
                `[Assistant] Tokens: ${event.message.usage?.output_tokens}`
              );
            } else if (event.type === 'tool_call') {
              console.log(
                `[Tool] ${event.message.tool_call?.name}(${JSON.stringify(event.message.tool_call?.arguments)})`
              );
            } else if (event.type === 'thinking') {
              console.log(`[Thinking] ${event.message.content}`);
            } else if (event.type === 'result') {
              console.log(
                `[Done] ${event.message.subtype} in ${event.message.duration_ms}ms`
              );
            }
          } catch {
            // Not JSON, just log
            console.log(data);
          }
        }
      },
    });

    console.log('Final output:', result.stdout);
    console.log('Token usage:', result.usage);
  } finally {
    await sandbox.kill();
  }
}
```

### Thread Management

```typescript
async function multiStepTask() {
  const sandbox = await Sandbox.create('amp', {
    envs: { AMP_API_KEY: process.env.AMP_API_KEY },
    timeoutMs: 600000,
  });

  try {
    const amp = createAmpService(sandbox, sandbox.sandboxId);

    // Step 1: Initial analysis
    console.log('Step 1: Analyzing codebase...');
    const analysis = await amp.execute({
      prompt: 'Analyze the codebase and create a refactoring plan',
      workingDir: '/home/user/repo',
    });

    console.log('Analysis complete. Thread ID:', analysis.threadId);

    // Step 2: List threads
    const threads = await amp.threads.list();
    console.log(`Found ${threads.length} threads`);

    // Step 3: Continue thread with next task
    if (threads.length > 0) {
      console.log('Step 2: Implementing step 1...');
      const implementation = await amp.threads.continue(
        threads[0].id,
        'Now implement step 1 of the refactoring plan'
      );

      console.log('Implementation complete');

      // Step 4: Get git diff
      const diff = await amp.git.diff();
      console.log('Changes made:', diff);
    }
  } finally {
    await sandbox.kill();
  }
}
```

### Working with Git Repository

```typescript
async function workOnRepo() {
  const sandbox = await Sandbox.create('amp', {
    envs: {
      AMP_API_KEY: process.env.AMP_API_KEY,
      GITHUB_TOKEN: process.env.GITHUB_TOKEN,
    },
    timeoutMs: 600000,
  });

  try {
    const amp = createAmpService(sandbox, sandbox.sandboxId);

    // Clone repository
    console.log('Cloning repository...');
    await amp.git.clone('https://github.com/myorg/myrepo.git', {
      path: '/home/user/repo',
      username: 'x-access-token',
      password: process.env.GITHUB_TOKEN,
      depth: 50, // Deeper clone for better git history
    });

    // Run Amp on repository
    const result = await amp.execute({
      prompt: 'Add error handling to all API endpoints',
      workingDir: '/home/user/repo',
      streamJson: true,
    });

    // Get git diff
    const diff = await amp.git.diff();
    console.log('Changes:', diff);

    // Get git status
    const status = await amp.git.status();
    console.log('Status:', status);

  } finally {
    await sandbox.kill();
  }
}
```

---

## E2B Git Integration

### Clone Private Repository

```typescript
import { Sandbox } from '@e2b/code-interpreter';

async function clonePrivateRepo() {
  const sandbox = await Sandbox.create();

  try {
    // Clone with authentication
    await sandbox.git.clone('https://github.com/myorg/private-repo.git', {
      path: '/home/user/private-repo',
      username: 'x-access-token',
      password: process.env.GITHUB_TOKEN,
      depth: 1, // Shallow clone for speed
    });

    console.log('Repository cloned successfully');
  } finally {
    await sandbox.kill();
  }
}
```

### Git Operations

```typescript
async function gitWorkflow() {
  const sandbox = await Sandbox.create();

  try {
    // Clone
    await sandbox.git.clone('https://github.com/myorg/repo.git', {
      path: '/home/user/repo',
    });

    // Pull latest changes
    const pullResult = await sandbox.git.pull('/home/user/repo');
    console.log('Pull result:', pullResult.output);

    // Check status
    const status = await sandbox.git.status('/home/user/repo');
    console.log('Git status:', status.status);

    // Get diff
    const diff = await sandbox.git.diff('/home/user/repo');
    console.log('Changes:', diff.diff);

  } finally {
    await sandbox.kill();
  }
}
```

---

## MCP Client Enhancements

### Resource Subscription

```typescript
import { MCPClient } from '@/lib/mcp/client';
import { MCPResourceError } from '@/lib/mcp/types';

async function subscribeToResources() {
  const client = new MCPClient({
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '/home/user'],
  });

  try {
    await client.connect();

    // Subscribe to resource updates
    await client.subscribeResource('file:///home/user/config.json');
    await client.subscribeResource('file:///home/user/data.json');

    // Check subscriptions
    const subscribed = client.getSubscribedResources();
    console.log('Subscribed to:', subscribed);

    // Check if subscribed to specific resource
    const isSubscribed = client.isSubscribedToResource('file:///home/user/config.json');
    console.log('Is subscribed to config.json:', isSubscribed);

    // Listen for resource changes
    client.on('resource_registered', (event) => {
      console.log('New resource registered:', event);
    });

  } catch (error) {
    if (error instanceof MCPResourceError) {
      console.error('Resource error:', error.message, 'URI:', error.uri);
    }
    throw error;
  } finally {
    await client.disconnect();
  }
}
```

### Progress Tracking

```typescript
import { MCPClient } from '@/lib/mcp/client';
import { MCPProtocolError } from '@/lib/mcp/types';

async function longRunningOperation() {
  const client = new MCPClient({ /* config */ });
  await client.connect();

  try {
    // Start long-running tool call
    const toolCallPromise = client.callTool({
      name: 'process_large_file',
      arguments: { path: '/data/large.csv' },
    });

    // Send progress updates
    let progress = 0;
    const progressInterval = setInterval(() => {
      progress += 10;
      
      try {
        client.sendProgress('tool-call-id', progress, 100);
        console.log(`Progress: ${progress}%`);
      } catch (error) {
        if (error instanceof MCPProtocolError) {
          console.error('Progress error:', error.message);
        }
      }

      if (progress >= 100) {
        clearInterval(progressInterval);
      }
    }, 1000);

    await toolCallPromise;

  } finally {
    await client.disconnect();
  }
}
```

### Logging Configuration

```typescript
async function configureLogging() {
  const client = new MCPClient({ /* config */ });
  await client.connect();

  try {
    // Set log level
    await client.setLogLevel('debug');

    // Listen for log messages
    client.on('log', (event) => {
      const { level, logger, data, timestamp } = event.data;
      console.log(`[${timestamp}] [${logger}] [${level}]`, data);
    });

  } finally {
    await client.disconnect();
  }
}
```

### Request Cancellation

```typescript
import { MCPClient } from '@/lib/mcp/client';
import { MCPTimeoutError } from '@/lib/mcp/types';

async function cancellableOperation() {
  const client = new MCPClient({ /* config */ });
  await client.connect();

  const abortController = new AbortController();

  try {
    // Start operation
    const operationPromise = client.callTool({
      name: 'long_running_task',
      arguments: { duration: 60000 },
    });

    // Set timeout for cancellation
    const timeoutId = setTimeout(() => {
      // Cancel the request
      client.cancelRequest('request-id');
      abortController.abort();
    }, 30000); // 30 second timeout

    try {
      const result = await operationPromise;
      clearTimeout(timeoutId);
      return result;
    } catch (error) {
      if (error instanceof MCPTimeoutError) {
        console.log('Request timed out:', error.requestId);
      }
      throw error;
    }

  } finally {
    await client.disconnect();
  }
}
```

---

## Smithery Registry

### Search MCP Servers

```typescript
import { createSmitheryClient } from '@/lib/mcp/smithery-registry';

async function discoverServers() {
  const client = createSmitheryClient({
    apiKey: process.env.SMITHERY_API_KEY,
  });

  // Search for GitHub-related servers
  const results = await client.searchServers({
    q: 'github',
    verified: true,
    hasTools: true,
    page: 1,
    pageSize: 20,
  });

  console.log(`Found ${results.total} servers`);
  console.log(`Page ${results.page} of ${Math.ceil(results.total / results.pageSize)}`);

  for (const server of results.servers) {
    console.log(`- ${server.qualifiedName}: ${server.description}`);
  }

  // Get more pages
  if (results.hasMore) {
    const nextPage = await client.searchServers({
      q: 'github',
      page: results.page + 1,
    });
  }
}
```

### Create Connection

```typescript
async function setupMCPConnection() {
  const client = createSmitheryClient({
    apiKey: process.env.SMITHERY_API_KEY,
  });

  try {
    // Get server details
    const server = await client.getServer('github/mcp-server');
    console.log('Server:', server.name);
    console.log('MCP URL:', server.mcpUrl);

    // Create connection
    const connection = await client.createConnection('my-namespace', {
      mcpUrl: server.mcpUrl,
      metadata: {
        userId: 'user-123',
        purpose: 'code-assistant',
      },
    });

    console.log('Connection created:', connection.id);
    console.log('Status:', connection.status);

    return connection;
  } catch (error) {
    console.error('Failed to create connection:', error);
    throw error;
  }
}
```

### Download Bundle

```typescript
import { createSmitheryClient } from '@/lib/mcp/smithery-registry';
import { writeFile } from 'node:fs/promises';

async function downloadServerBundle() {
  const client = createSmitheryClient({
    apiKey: process.env.SMITHERY_API_KEY,
  });

  try {
    // Download MCPB bundle
    const bundle = await client.downloadBundle('github/mcp-server');
    
    // Save to file
    const buffer = Buffer.from(await bundle.arrayBuffer());
    await writeFile('./github-mcp-server.mcpb', buffer);
    
    console.log('Bundle downloaded successfully');
  } catch (error) {
    console.error('Failed to download bundle:', error);
    throw error;
  }
}
```

### Event Polling

```typescript
async function pollForEvents() {
  const client = createSmitheryClient({
    apiKey: process.env.SMITHERY_API_KEY,
  });

  const connectionId = 'connection-123';
  const namespace = 'my-namespace';

  // Poll for events
  const result = await client.pollEvents(namespace, connectionId);

  console.log('Events:', result.events);
  console.log('Done:', result.done);

  if (!result.done) {
    // More events available, poll again later
    setTimeout(() => pollForEvents(), 5000);
  }
}
```

---

## Composio Triggers

### Create Trigger

```typescript
import { createComposioTriggersService } from '@/lib/tools/composio-triggers';

async function setupTrigger() {
  const triggers = createComposioTriggersService({
    apiKey: process.env.COMPOSIO_API_KEY,
  });

  try {
    // Create GitHub issue trigger
    const trigger = await triggers.createTrigger({
      name: 'github-issue-created',
      toolkit: 'github',
      config: {
        repo: 'myorg/myrepo',
        event: 'issues.opened',
      },
      webhookUrl: 'https://myapp.com/webhooks/composio',
    });

    console.log('Trigger created:', trigger.id);
    console.log('Status:', trigger.status);

    return trigger;
  } catch (error) {
    console.error('Failed to create trigger:', error);
    throw error;
  }
}
```

### Subscribe to Events

```typescript
async function subscribeToTrigger() {
  const triggers = createComposioTriggersService();

  const triggerId = 'trigger-123';

  // Subscribe to trigger events (polling-based)
  const unsubscribe = await triggers.subscribe(
    triggerId,
    (event) => {
      console.log('Trigger fired!');
      console.log('Trigger:', event.triggerName);
      console.log('Payload:', event.payload);
      console.log('Received at:', event.receivedAt);
    },
    {
      pollIntervalMs: 5000, // Poll every 5 seconds
      onError: (error) => {
        console.error('Polling error:', error);
      },
    }
  );

  console.log('Subscribed to trigger events');

  // Later, unsubscribe
  // unsubscribe();
}
```

### Handle Webhook

```typescript
import express from 'express';
import { createComposioTriggersService } from '@/lib/tools/composio-triggers';

const app = express();
const triggers = createComposioTriggersService();

app.post('/webhooks/composio', express.json(), async (req, res) => {
  try {
    // Verify and parse webhook
    const event = await triggers.handleWebhook(req.body, req.headers);

    if (!event) {
      return res.status(400).json({ error: 'Invalid webhook' });
    }

    console.log('Webhook received:');
    console.log('- Trigger:', event.triggerName);
    console.log('- Toolkit:', event.toolkit);
    console.log('- Payload:', event.payload);

    // Process event
    switch (event.triggerName) {
      case 'github-issue-created':
        await handleIssueCreated(event.payload);
        break;
      case 'slack-message':
        await handleSlackMessage(event.payload);
        break;
    }

    res.json({ received: true });
  } catch (error: any) {
    console.error('Webhook error:', error.message);
    res.status(401).json({ error: 'Invalid signature' });
  }
});

async function handleIssueCreated(payload: any) {
  console.log('New issue:', payload.issue.number);
  // Process issue...
}

async function handleSlackMessage(payload: any) {
  console.log('New Slack message:', payload.message.text);
  // Process message...
}

app.listen(3000, () => {
  console.log('Webhook server listening on port 3000');
});
```

### Trigger Management

```typescript
async function manageTriggers() {
  const triggers = createComposioTriggersService();

  // List available triggers
  const available = await triggers.listAvailableTriggers({
    toolkit: 'github',
    limit: 10,
  });
  console.log('Available triggers:', available);

  // Get trigger details
  const trigger = await triggers.getTrigger('trigger-123');
  console.log('Trigger details:', trigger);

  // Update trigger
  await triggers.updateTrigger('trigger-123', {
    config: { repo: 'neworg/newrepo' },
  });

  // Activate trigger
  await triggers.activateTrigger('trigger-123');

  // Deactivate trigger
  await triggers.deactivateTrigger('trigger-123');

  // Get statistics
  const stats = await triggers.getStats('trigger-123');
  console.log('Total executions:', stats.totalExecutions);
  console.log('Success rate:', stats.successfulExecutions / stats.totalExecutions);

  // List executions
  const executions = await triggers.listExecutions('trigger-123', {
    limit: 10,
    status: 'failed',
  });

  // Retry failed execution
  if (executions.length > 0) {
    await triggers.retryExecution('trigger-123', executions[0].id);
  }

  // Delete trigger
  await triggers.deleteTrigger('trigger-123');
}
```

---

## Environment Variables

Add to `.env.local`:

```bash
# E2B Amp
AMP_API_KEY=your_amp_api_key_here

# E2B Git (for private repos)
GITHUB_TOKEN=your_github_token_here

# Smithery Registry
SMITHERY_API_KEY=your_smithery_api_key_here

# Composio Triggers
COMPOSIO_API_KEY=your_composio_api_key_here
COMPOSIO_WEBHOOK_SECRET=your_webhook_secret_for_signature_verification
```

---

**Document Status:** ✅ Complete  
**Last Updated:** 2026-02-27
