---
id: sdk-opensandbox-examples-agent-sandbox-agent-sandbox-example
title: Agent-Sandbox Example
aliases:
  - README
  - README.md
  - agent-sandbox-example
  - agent-sandbox-example.md
tags:
  - agent
  - spawn
layer: example
summary: "# Agent-Sandbox Example\r\n\r\nThis example creates a sandbox backed by `kubernetes-sigs/agent-sandbox` and\r\nexecutes `echo hello world` via the OpenSandbox Python SDK.\r\n\r\n## Prerequisites\r\n\r\n- A Kubernetes cluster with the agent-sandbox controller and CRDs installed.\r\n- OpenSandbox server configured wi"
anchors:
  - Prerequisites
  - Start OpenSandbox server
  - Run the example
  - Expected output
---
# Agent-Sandbox Example

This example creates a sandbox backed by `kubernetes-sigs/agent-sandbox` and
executes `echo hello world` via the OpenSandbox Python SDK.

## Prerequisites

- A Kubernetes cluster with the agent-sandbox controller and CRDs installed.
- OpenSandbox server configured with Kubernetes runtime and `workload_provider = "agent-sandbox"`.
- Sandbox image should include `bash` (default example uses `ubuntu:22.04`).

## Start OpenSandbox server

1. Install the server package and fetch the example config for agent-sandbox:

```shell
uv pip install opensandbox-server
opensandbox-server init-config ~/.sandbox.toml --example docker
```

2. Update `~/.sandbox.toml` with the following sections:

```toml
[runtime]
type = "kubernetes"
execd_image = "opensandbox/execd:v1.0.6"

[kubernetes]
namespace = "default"
# kubeconfig_path = "/absolute/path/to/kubeconfig"  # optional if running in-cluster
workload_provider = "agent-sandbox"

[agent_sandbox]
shutdown_policy = "Delete"
```

3. Start the server:

```shell
opensandbox-server
```

## Run the example

```shell
uv pip install opensandbox
uv run python examples/agent-sandbox/main.py
```

## Expected output

```text
command output: hello world
```
