# Kilocode - Advanced AI-Powered Code Intelligence Platform

Kilocode is a comprehensive AI-powered code intelligence platform that integrates seamlessly with binG's agent ecosystem. It provides advanced code generation, analysis, refactoring, and collaborative development capabilities through multiple interfaces including REST API, CLI, and SDK integrations.

## 🚀 Key Features

- **Multi-Language AI Code Generation**: Generate production-ready code in JavaScript, TypeScript, Python, Java, C++, Go, Rust, and PHP
- **Intelligent Code Completion**: Context-aware code suggestions with real-time analysis
- **Advanced Code Analysis**: Comprehensive linting, complexity analysis, and quality metrics
- **AI-Powered Refactoring**: Automated code improvements and modernization
- **Collaborative Code Review**: Detailed feedback with actionable recommendations
- **Kilo AI Gateway Integration**: Access to multiple AI models through a unified OpenAI-compatible API
- **Streaming Responses**: Real-time code generation with progress updates
- **Multi-Framework SDK Support**: Native integrations with Vercel AI SDK, OpenAI SDK, LangChain, and more
- **Agent Ecosystem Integration**: Full MCP compatibility with binG's agent orchestration
- **Security First**: Input validation, rate limiting, and comprehensive error handling
- **Performance Optimized**: Intelligent caching, memory management, and scalable architecture

## Features

- 🚀 **Multi-Language Support**: JavaScript, TypeScript, Python, Java, C++, Go, Rust, PHP
- 🤖 **AI-Powered Generation**: Generate code from natural language descriptions
- ✨ **Intelligent Completion**: Context-aware code completion and suggestions
- 🔍 **Code Analysis**: Lint, format, refactor, and optimize code
- 📝 **Code Review**: Comprehensive code quality assessment
- 🎯 **Streaming Responses**: Real-time code generation with progress updates
- 🔒 **Security First**: Input validation, rate limiting, and authentication
- 🏗️ **Agent Integration**: Native support for binG's agent orchestration
- ⚡ **Performance Monitoring**: Built-in metrics and performance tracking

## Quick Start

### Starting the Server

```bash
# Using the CLI
npm install -g @bing/cli
kilocode health  # Check if server is running

# Or start programmatically
import { createKilocodeServer } from '@bing/kilocode';

const server = await createKilocodeServer({
  port: 3001,
  host: 'localhost',
  apiKey: 'your-api-key' // Optional
});

await server.start();
```

### Using the Client

```typescript
import { createKilocodeClient } from '@bing/kilocode';

const client = createKilocodeClient({
  host: 'localhost',
  port: 3001,
  apiKey: 'your-api-key'
});

// Generate code
const result = await client.generate({
  prompt: 'Create a React component for a todo list',
  language: 'typescript',
  options: {
    temperature: 0.7,
    style: 'documented'
  }
});

console.log(result.data); // Generated TypeScript code
```

### CLI Usage

```bash
# Generate code with advanced options
kilocode generate "Create a React authentication component" -l typescript --style documented --framework react

# Streaming code generation
kilocode generate "Build a Python data processing pipeline" -l python --stream

# Code completion with context
kilocode complete "function processData(data) {" -l javascript

# Advanced code analysis
kilocode analyze "async function fetchData() { return await api.get('/data'); }" -l javascript -t optimize

# Comprehensive code review
kilocode review "class UserService { constructor() { this.users = []; } }" -l javascript -f security,performance,maintainability

# Check server health and model availability
kilocode health
```

### Advanced CLI Features

```bash
# Specify custom model
kilocode generate "Optimize this algorithm" --model gpt-4

# Set temperature and token limits
kilocode generate "Write a creative story" --temperature 0.9 --max-tokens 2000

# Include test generation
kilocode generate "Create a sorting utility" --include-tests

# Multi-file context (read from files)
kilocode generate "Add error handling to this API" --context-file api.js --context-file utils.js
```

## API Reference

### Code Generation

```typescript
POST /api/generate
{
  "prompt": "Create a REST API endpoint",
  "language": "typescript",
  "context": {
    "files": [
      {
        "name": "types.ts",
        "content": "interface User { id: number; name: string; }"
      }
    ]
  },
  "options": {
    "temperature": 0.7,
    "maxTokens": 1000,
    "style": "documented",
    "framework": "express"
  }
}
```

### Code Completion

```typescript
POST /api/complete
{
  "prefix": "function calculateTotal(items) {",
  "language": "javascript",
  "context": {
    "cursor": { "line": 1, "column": 30 }
  }
}
```

### Code Analysis

```typescript
POST /api/analyze
{
  "code": "function test() { console.log('hello'); }",
  "language": "javascript",
  "analysisType": "lint"
}
```

### Code Refactoring

```typescript
POST /api/refactor
{
  "code": "function x(a,b) { return a+b; }",
  "language": "javascript",
  "refactorType": "rename-variable",
  "selection": { "start": 10, "end": 11 }
}
```

### Code Review

```typescript
POST /api/review
{
  "code": "const data = fetch('/api/data').then(r => r.json());",
  "language": "javascript",
  "focus": ["security", "performance"]
}
```

## Agent Integration

Kilocode integrates seamlessly with binG's agent system:

```typescript
import { createKilocodeAgent, kilocodeMCPTools } from '@bing/kilocode';

// Create agent with Kilocode capabilities
const agent = createKilocodeAgent('my-agent', {
  port: 3001,
  host: 'localhost'
}, ['generate', 'complete', 'analyze']);

// Use in agent workflows
const result = await agent.generateCode({
  prompt: 'Create a database connection utility',
  language: 'typescript'
});
```

## Configuration

```typescript
interface KilocodeConfig {
  port?: number;                    // Server port (default: 3001)
  host?: string;                    // Server host (default: 'localhost')
  apiKey?: string;                  // API key for authentication
  maxRequestsPerHour?: number;      // Rate limit (default: 1000)
  enableStreaming?: boolean;        // Enable streaming responses (default: true)
  supportedLanguages?: string[];    // Supported languages
  modelEndpoints?: Record<string, string>; // AI model endpoints
  timeout?: number;                 // Request timeout (default: 30000)
  enableCors?: boolean;             // Enable CORS (default: true)
  trustedOrigins?: string[];        // Trusted CORS origins
}
```

## Security

- **Authentication**: Bearer token authentication with configurable API keys
- **Rate Limiting**: Configurable requests per hour with exponential backoff
- **Input Validation**: Comprehensive validation of all inputs and parameters
- **CORS Protection**: Configurable trusted origins for cross-origin requests
- **Error Masking**: Sensitive information is automatically masked in responses

## Performance

- **Caching**: Intelligent caching of analysis results and completions
- **Streaming**: Real-time responses for long-running operations
- **Metrics**: Built-in performance monitoring and reporting
- **Optimization**: Lazy loading and efficient resource usage

## Development

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Run tests
npm test

# Generate documentation
npm run docs
```

## 🔧 SDK Integrations

Kilocode provides native integrations with popular AI SDKs and frameworks, maintaining full compatibility with existing codebases.

### Vercel AI SDK Integration

```typescript
import { streamText, tool } from "ai"
import { createKilocodeVercelSDK } from "@bing/kilocode"

const kilocode = createKilocodeVercelSDK({
  apiKey: process.env.KILO_API_KEY,
  baseURL: "https://api.kilo.ai/api/gateway"
})

const result = streamText({
  model: kilocode.createOpenAI().chat("anthropic/claude-sonnet-4.5"),
  prompt: "Generate a TypeScript React component for user authentication",
  tools: {
    generateCode: tool({
      description: "Generate code using Kilocode AI",
      parameters: z.object({
        prompt: z.string(),
        language: z.string(),
        framework: z.string().optional()
      }),
      execute: async ({ prompt, language, framework }) => {
        // Kilocode handles the actual code generation
        return { code: "generated code here" }
      }
    })
  }
})

for await (const textPart of result.textStream) {
  process.stdout.write(textPart)
}
```

### OpenAI SDK Integration

```typescript
import { createKilocodeOpenAISDK } from "@bing/kilocode"

const client = createKilocodeOpenAISDK({
  apiKey: process.env.KILO_API_KEY
})

// Non-streaming
const response = await client.createChatCompletion({
  model: "anthropic/claude-sonnet-4.5",
  messages: [
    { role: "system", content: "You are an expert TypeScript developer." },
    { role: "user", content: "Create a generic Result<T> type for error handling" }
  ],
  temperature: 0.7,
  max_tokens: 1000
})

console.log(response.choices[0].message.content)

// Streaming
const stream = await client.createChatCompletion({
  model: "anthropic/claude-sonnet-4.5",
  messages: [{ role: "user", content: "Write a comprehensive README for a Node.js project" }],
  stream: true
})

for await (const chunk of stream) {
  const content = chunk.choices[0]?.delta?.content
  if (content) process.stdout.write(content)
}
```

### LangChain Integration

```typescript
import { ChatPromptTemplate } from "@langchain/core/prompts"
import { createKilocodeLangChain } from "@bing/kilocode"

const langchain = createKilocodeLangChain({
  apiKey: process.env.KILO_API_KEY
})

const model = langchain.createChatOpenAI("anthropic/claude-sonnet-4.5", {
  temperature: 0.7,
  maxTokens: 2000
})

const prompt = ChatPromptTemplate.fromTemplate(`
Generate {language} code for: {task}

Requirements:
- Use modern {language} features
- Include error handling
- Add documentation
- Follow best practices
`)

const chain = prompt.pipe(model)

const result = await chain.invoke({
  language: "TypeScript",
  task: "Create a file upload utility with progress tracking"
})

console.log(result.content)
```

## 🤖 Agent Integration

Kilocode integrates deeply with binG's agent ecosystem, providing both basic and enhanced agent capabilities.

### Basic Agent Integration

```typescript
import { createKilocodeAgent, kilocodeMCPTools } from '@bing/kilocode';

const agent = createKilocodeAgent('code-assistant', {
  port: 3001,
  host: 'localhost'
}, ['generate', 'complete', 'analyze', 'refactor', 'review']);

const result = await agent.generateCode({
  prompt: 'Create a database connection utility with connection pooling',
  language: 'typescript',
  options: {
    framework: 'node-postgres',
    includeTests: true
  }
});
```

### Enhanced Agent Integration

```typescript
import { createEnhancedKilocodeAgent } from '@bing/kilocode';

const enhancedAgent = createEnhancedKilocodeAgent({
  gateway: {
    apiKey: process.env.KILO_API_KEY,
    baseURL: 'https://api.kilo.ai/api/gateway'
  },
  capabilities: ['generate', 'analyze', 'refactor', 'review', 'collaborate'],
  contextWindow: 50,
  enableMultiModal: true,
  systemPrompts: {
    generate: 'You are an expert full-stack developer specializing in modern, scalable applications.',
    review: 'You are a senior software engineer conducting thorough code reviews with security focus.'
  }
});

// Start collaborative coding session
await enhancedAgent.startCollaborativeSession('session-123', ['alice', 'bob']);

// Get real-time suggestions
const suggestions = await enhancedAgent.getCollaborativeSuggestions(
  'session-123',
  'function calculateTotal(items) {',
  { line: 1, column: 30 }
);
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Ensure all tests pass
5. Submit a pull request

## License

MIT License - see LICENSE file for details.