---
id: >-
  sdk-trigger-llms.md-claude-agent-github-wiki-github-repository-analyzer-agent-using-claude-and-trigger-dev
title: GitHub repository analyzer agent using Claude and Trigger.dev
aliases:
  - README
  - README.md
  - github-repository-analyzer-agent-using-claude-and-trigger-dev
  - github-repository-analyzer-agent-using-claude-and-trigger-dev.md
tags:
  - agent
  - spawn
layer: core
summary: "# GitHub repository analyzer agent using Claude and Trigger.dev\r\n\r\nAsk questions about any public GitHub repository and get AI-powered analysis using the Claude Agent SDK for agentic exploration and Trigger.dev for real-time streaming to the frontend.\r\n\r\n## Tech stack\r\n\r\n- **[Next.js](https://nextjs"
anchors:
  - Tech stack
  - Demo video
  - Running the project locally
  - Features
  - Relevant files
relations:
  - type: implements
    id: >-
      sdk-trigger-llms.md-changelog-generator-changelog-generator-using-the-claude-agent-sdk-and-trigger-dev
    title: Changelog generator using the Claude Agent SDK and Trigger.dev
    path: >-
      sdk/trigger-llms.md/changelog-generator/changelog-generator-using-the-claude-agent-sdk-and-trigger-dev.md
    confidence: 0.326
    classified_score: 0.313
    auto_generated: true
    generator: apply-classified-suggestions
---
# GitHub repository analyzer agent using Claude and Trigger.dev

Ask questions about any public GitHub repository and get AI-powered analysis using the Claude Agent SDK for agentic exploration and Trigger.dev for real-time streaming to the frontend.

## Tech stack

- **[Next.js](https://nextjs.org/)** – React framework with App Router for the frontend
- **[Claude Agent SDK](https://platform.claude.com/docs/en/agent-sdk/overview)** – Anthropic's SDK for building AI agents with file system and search tools
- **[Trigger.dev](https://trigger.dev/)** – Background task orchestration with real-time streaming to the frontend, observability, and deployment

## Demo video

https://github.com/user-attachments/assets/ff89ae41-0488-4d1c-aa7d-4dad15cefc12

## Running the project locally

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Configure environment variables**

   ```bash
   cp .env.example .env
   ```

   - `TRIGGER_SECRET_KEY` – From [Trigger.dev dashboard](https://cloud.trigger.dev/)
   - `TRIGGER_PROJECT_REF` – Your project ref (starts with `proj_`)
   - `ANTHROPIC_API_KEY` – From [Anthropic Console](https://console.anthropic.com/)

3. **Start development servers**

   ```bash
   # Terminal 1: Next.js
   npm run dev

   # Terminal 2: Trigger.dev
   npx trigger.dev@latest dev
   ```

4. Open [http://localhost:3000](http://localhost:3000) in your browser

## Features

- **Ask anything about any public repo** – Architecture, security vulnerabilities, API endpoints, testing strategies, etc.
- **Claude Agent SDK exploration** – Claude explores the codebase using Grep and Read tools to provide detailed answers
- **Cancel anytime** – Abort long-running tasks with proper cleanup
- **Trigger.dev Realtime streaming** – Watch Claude's analysis stream in as it's generated
- **Progress tracking** – See clone status, analysis progress, and repo size via Trigger.dev metadata

## Relevant files

- [`trigger/analyze-repo.ts`](trigger/analyze-repo.ts) – Main task that clones repo, runs Claude agent, and streams response
- [`trigger/agent-stream.ts`](trigger/agent-stream.ts) – Typed stream definition for real-time text responses
- [`app/api/analyze-repo/route.ts`](app/api/analyze-repo/route.ts) – API endpoint that triggers the task and returns a public access token
- [`app/response/[runId]/page.tsx`](app/response/[runId]/page.tsx) – Real-time streaming display with progress
- [`trigger.config.ts`](trigger.config.ts) – Project config with external SDK bundle
