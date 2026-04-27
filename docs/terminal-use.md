---
id: terminal-use
title: Terminal Use
aliases:
  - terminaluse-llms
  - terminaluse-llms.md
tags:
  - terminal
layer: core
summary: "# Terminal Use\r\n\r\n> Platform for building and deploying AI agents with persistent filesystems and sandboxed compute.\r\n\r\n## Get Started\r\n\r\n- [What is Terminal Use?](https://docs.terminaluse.com/introduction/what-is-terminaluse): A platform for deploying agents that need tasks, state, and filesystems"
anchors:
  - Get Started
  - Core Concepts
  - Build Agents
  - Deploy & Operate
  - Security & Access
  - API
  - Namespaces
  - Projects
  - Agents
  - Branches
  - Versions
  - Tasks
  - Messages
  - State
  - Events
  - Filesystems
  - API Keys
  - Webhook Keys
  - Groups
  - Common Questions
  - Can I run Claude Agent SDK / Anthropic agents on Terminal Use?
  - How do I persist files between task executions?
  - What's the container cold start time?
  - Can I run arbitrary shell commands or subprocesses?
  - How do concurrent writes to the same filesystem work?
  - How do I stream responses to a frontend?
  - What model providers are supported?
  - Optional
relations:
  - type: implements
    id: terminaluse-integration
    title: TerminalUse Integration
    path: terminaluse-integration.md
    confidence: 0.32
    classified_score: 0.33
    auto_generated: true
    generator: apply-classified-suggestions
---
# Terminal Use

> Platform for building and deploying AI agents with persistent filesystems and sandboxed compute.

## Get Started

- [What is Terminal Use?](https://docs.terminaluse.com/introduction/what-is-terminaluse): A platform for deploying agents that need tasks, state, and filesystems
- [Quick Start](https://docs.terminaluse.com/introduction/quickstart): Create, deploy, and run your first Terminal Use agent

## Core Concepts

- [Product Surfaces](https://docs.terminaluse.com/concepts/product-surfaces): Which Terminal Use surface to use for agent code, app code, CLI workflows, and API operations
- [Core Model](https://docs.terminaluse.com/concepts/core-model): The primitives you work with in Terminal Use
- [Task Lifecycle](https://docs.terminaluse.com/concepts/task-lifecycle): How tasks are created, routed, and updated
- [Deployments](https://docs.terminaluse.com/concepts/deployments): Branches, environments, versions, and rollback
- [Workspaces and Filesystems](https://docs.terminaluse.com/concepts/workspaces-and-filesystems): How `/workspace`, persistent filesystems, archive sync, and single-file operations fit together

## Build Agents

- [Building Agents](https://docs.terminaluse.com/introduction/building-agents): The public Python runtime model for Terminal Use agents
- [Using Agents](https://docs.terminaluse.com/introduction/using-agents): Call deployed agents from your app with the SDKs
- [Frontend Integration](https://docs.terminaluse.com/introduction/frontend-integration): Build chat interfaces with Terminal Use agents using the Vercel AI SDK
- [Filesystem Sync](https://docs.terminaluse.com/advanced/filesystem-sync): Python runtime sync for /workspace and task system folders
- [ADK Reference](https://docs.terminaluse.com/api-reference/adk): Agent Development Kit modules for building agents

## Deploy & Operate

- [Deploying Agents](https://docs.terminaluse.com/introduction/deploying): How deploys resolve to environments, branches, and versions
- [CLI Reference](https://docs.terminaluse.com/api-reference/cli): Verified commands and flags for the tu CLI

## Security & Access

- [Access Control](https://docs.terminaluse.com/concepts/access-control): How agent access, filesystem access, and task access interact
- [Sandboxing](https://docs.terminaluse.com/concepts/sandboxing): What the runtime can access inside a task
- [Keys and Secrets](https://docs.terminaluse.com/concepts/keys-and-secrets): API keys, webhook keys, and environment secrets

## API

- [Authentication](https://docs.terminaluse.com/api-reference/authentication): API authentication
- [Errors](https://docs.terminaluse.com/api-reference/errors): API error handling

### Namespaces
- [List Namespaces](https://docs.terminaluse.com/api-reference/namespaces/list)
- [Create Namespace](https://docs.terminaluse.com/api-reference/namespaces/create)
- [Get Namespace](https://docs.terminaluse.com/api-reference/namespaces/get)
- [Get Namespace by Slug](https://docs.terminaluse.com/api-reference/namespaces/get-by-slug)
- [Check Slug Availability](https://docs.terminaluse.com/api-reference/namespaces/check-slug-availability)
- [Update Namespace](https://docs.terminaluse.com/api-reference/namespaces/update)
- [Delete Namespace](https://docs.terminaluse.com/api-reference/namespaces/delete)
- [Retry Namespace Provisioning](https://docs.terminaluse.com/api-reference/namespaces/retry-provisioning)


### Projects
- [List Projects](https://docs.terminaluse.com/api-reference/projects/list)
- [Create Project](https://docs.terminaluse.com/api-reference/projects/create)
- [Get Project](https://docs.terminaluse.com/api-reference/projects/get)
- [Update Project](https://docs.terminaluse.com/api-reference/projects/update)
- [Delete Project](https://docs.terminaluse.com/api-reference/projects/delete)
- [List Project Collaborators](https://docs.terminaluse.com/api-reference/projects/list-collaborators)
- [Set Project Collaborator Role](https://docs.terminaluse.com/api-reference/projects/set-collaborator)
- [Remove Project Collaborator](https://docs.terminaluse.com/api-reference/projects/remove-collaborator)


### Agents
- [List Agents](https://docs.terminaluse.com/api-reference/agents/list)
- [Get Agent](https://docs.terminaluse.com/api-reference/agents/retrieve)
- [Get Agent by Name](https://docs.terminaluse.com/api-reference/agents/retrieve-by-name)
- [Deploy Agent](https://docs.terminaluse.com/api-reference/agents/deploy)
- [Delete Agent](https://docs.terminaluse.com/api-reference/agents/delete)
- [Delete Agent by Name](https://docs.terminaluse.com/api-reference/agents/delete-by-name)


### Branches
- [List Branches](https://docs.terminaluse.com/api-reference/branches-list)
- [List Environment Branches](https://docs.terminaluse.com/api-reference/branches-list-for-environment)
- [Get Branch](https://docs.terminaluse.com/api-reference/branches-get)
- [List Branch Versions](https://docs.terminaluse.com/api-reference/branches-list-versions)
- [List Branch Events](https://docs.terminaluse.com/api-reference/branches-list-events)
- [Redeploy Branch](https://docs.terminaluse.com/api-reference/branches-redeploy)
- [Rollback Branch](https://docs.terminaluse.com/api-reference/branches-rollback)
- [Rollback Named Branch](https://docs.terminaluse.com/api-reference/branches-rollback-by-name)


### Versions
- [List Versions](https://docs.terminaluse.com/api-reference/versions-list)
- [Get Version](https://docs.terminaluse.com/api-reference/versions-get)


### Tasks
- [List Tasks](https://docs.terminaluse.com/api-reference/tasks/list)
- [Create Task](https://docs.terminaluse.com/api-reference/tasks/create)
- [Retrieve Task](https://docs.terminaluse.com/api-reference/tasks/retrieve)
- [Update Task](https://docs.terminaluse.com/api-reference/tasks/update)
- [Delete Task](https://docs.terminaluse.com/api-reference/tasks/delete)
- [Cancel Task](https://docs.terminaluse.com/api-reference/tasks/cancel)
- [Send Event](https://docs.terminaluse.com/api-reference/tasks/send-event)
- [Stream Events](https://docs.terminaluse.com/api-reference/tasks/stream)
- [Migrate Tasks](https://docs.terminaluse.com/api-reference/tasks/migrate)


### Messages
- [List Messages](https://docs.terminaluse.com/api-reference/messages-list)
- [Get Message](https://docs.terminaluse.com/api-reference/messages-get)


### State
- [List States](https://docs.terminaluse.com/api-reference/states-list)
- [Create State](https://docs.terminaluse.com/api-reference/states-create)
- [Get State](https://docs.terminaluse.com/api-reference/states-get)
- [Update State](https://docs.terminaluse.com/api-reference/states-update)
- [Delete State](https://docs.terminaluse.com/api-reference/states-delete)


### Events
- [List Events](https://docs.terminaluse.com/api-reference/events-list)
- [Get Event](https://docs.terminaluse.com/api-reference/events-get)


### Filesystems
- [Create Filesystem](https://docs.terminaluse.com/api-reference/filesystems/create)
- [List Filesystems](https://docs.terminaluse.com/api-reference/filesystems/list)
- [Get Filesystem](https://docs.terminaluse.com/api-reference/filesystems/retrieve)
- [List Files](https://docs.terminaluse.com/api-reference/filesystems/list-files)
- [Get File](https://docs.terminaluse.com/api-reference/filesystems/get-file)
- [Single-File Download](https://docs.terminaluse.com/api-reference/filesystems/file-download)
- [Upload File](https://docs.terminaluse.com/api-reference/filesystems/upload-file)
- [Get Upload URL](https://docs.terminaluse.com/api-reference/filesystems/get-upload-url)
- [Get Download URL](https://docs.terminaluse.com/api-reference/filesystems/get-download-url)
- [Complete Sync Operation](https://docs.terminaluse.com/api-reference/filesystems/sync-complete)


### API Keys
- [List API Keys](https://docs.terminaluse.com/api-reference/api-keys/list)
- [Create API Key](https://docs.terminaluse.com/api-reference/api-keys/create)
- [Get API Key](https://docs.terminaluse.com/api-reference/api-keys/get)
- [Revoke API Key](https://docs.terminaluse.com/api-reference/api-keys/revoke)
- [Update API Key Scopes](https://docs.terminaluse.com/api-reference/api-keys/update-scopes)
- [Update API Key Sharing Groups](https://docs.terminaluse.com/api-reference/api-keys/update-sharing-groups)


### Webhook Keys
- [List Webhook Keys](https://docs.terminaluse.com/api-reference/webhook-keys-list)
- [Create Webhook Key](https://docs.terminaluse.com/api-reference/webhook-keys-create)
- [Get Webhook Key](https://docs.terminaluse.com/api-reference/webhook-keys-get)
- [Get Webhook Key By Name](https://docs.terminaluse.com/api-reference/webhook-keys-get-by-name)
- [Delete Webhook Key](https://docs.terminaluse.com/api-reference/webhook-keys-delete)
- [Delete Webhook Key By Name](https://docs.terminaluse.com/api-reference/webhook-keys-delete-by-name)


### Groups
- [List Groups](https://docs.terminaluse.com/api-reference/groups/list)
- [Create Group](https://docs.terminaluse.com/api-reference/groups/create)
- [Get Group](https://docs.terminaluse.com/api-reference/groups/get)
- [Update Group](https://docs.terminaluse.com/api-reference/groups/update)
- [Delete Group](https://docs.terminaluse.com/api-reference/groups/delete)
- [List Group Members](https://docs.terminaluse.com/api-reference/groups/list-members)
- [Add Group Member](https://docs.terminaluse.com/api-reference/groups/add-member)
- [Remove Group Member](https://docs.terminaluse.com/api-reference/groups/remove-member)
- [List Group Managers](https://docs.terminaluse.com/api-reference/groups/list-managers)
- [Add Group Manager](https://docs.terminaluse.com/api-reference/groups/add-manager)
- [Remove Group Manager](https://docs.terminaluse.com/api-reference/groups/remove-manager)
- [List Group Visible Orgs](https://docs.terminaluse.com/api-reference/groups/list-visible-orgs)
- [Add Group Visible Org](https://docs.terminaluse.com/api-reference/groups/add-visible-org)
- [Remove Group Visible Org](https://docs.terminaluse.com/api-reference/groups/remove-visible-org)

## Common Questions

### Can I run Claude Agent SDK / Anthropic agents on Terminal Use?
Yes. Terminal Use provides sandboxed compute environments where you can run any Python code, including Claude Agent SDK. Your agent code runs in isolated containers with filesystem access. See [Building Agents](https://docs.terminaluse.com/introduction/building-agents) for the ADK patterns.

### How do I persist files between task executions?
Use Filesystems. Create a filesystem linked to a project, then use archive upload/download, single-file APIs, or runtime sync depending on the flow you need. See [Workspaces and Filesystems](https://docs.terminaluse.com/concepts/workspaces-and-filesystems) and [Filesystem Sync](https://docs.terminaluse.com/advanced/filesystem-sync).

### What's the container cold start time?
Startup time depends on your image, deployment state, and workload. For latency-sensitive flows, keep tasks alive between events instead of creating a new task for every turn.

### Can I run arbitrary shell commands or subprocesses?
Yes. Agent code can run shell commands and subprocesses inside the task sandbox, subject to the runtime and mounted filesystem permissions. See [Sandboxing](https://docs.terminaluse.com/concepts/sandboxing).

### How do concurrent writes to the same filesystem work?
Filesystem sync uses manifest-based tracking. The last `sync_up()` call wins. For concurrent access patterns, use separate filesystems per task or implement application-level locking.

### How do I stream responses to a frontend?
Use SSE streaming via `GET /tasks/{id}/stream`. The [Frontend Integration](https://docs.terminaluse.com/introduction/frontend-integration) guide shows how to use the Vercel AI SDK provider for React integration.

### What model providers are supported?
Terminal Use is model-agnostic. Your agent code can call any LLM API (Anthropic, OpenAI, local models, etc.). The platform provides the compute and state management, not the model.

## Optional

- [Platform](https://app.terminaluse.com)
