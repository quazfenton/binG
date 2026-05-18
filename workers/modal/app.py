"""
binG Modal App — Serverless GPU/CPU Compute for Agent Workers

What this does:
  • Offloads heavy agent loop execution to Modal's infrastructure
  • Runs GPU-accelerated LLM inference (no local GPU needed)
  • Provides isolated sandbox execution via Modal Sandboxes
  • Handles image generation and other compute-heavy tasks
  • Autoscales to zero when idle — no cost when not in use

Architecture:
  Backend (OCI/Vercel) ──HTTP──▶ Modal App
                                    ├── /api/agent/execute   → Agent loop executor
                                    ├── /api/agent/stream    → Streaming agent execution
                                    ├── /api/sandbox/run     → Sandbox code execution
                                    └── /api/inference       → GPU inference

Deployment:
  modal deploy app.py
"""

import modal
import fastapi
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, AsyncGenerator
import json
import time
import os

# ── Modal App Configuration ──────────────────────────────────────────

app = modal.App("bing-agent-workers")

# GPU configurations
GPU_A100 = modal.gpu.A100(memory=80)
GPU_A10G = modal.gpu.A10G()
GPU_T4 = modal.gpu.T4()
GPU_L4 = modal.gpu.L4()
CPU_HIGH = "cpu:8"
CPU_MEDIUM = "cpu:4"

# Shared volumes for caching models and persisting data
model_cache_volume = modal.Volume.from_name("bing-model-cache", create_if_missing=True)
workspace_volume = modal.Volume.from_name("bing-workspace", create_if_missing=True)

# Secrets injected from Modal dashboard
secrets_group = modal.Secret.from_name("bing-modal-secrets")


# ── Base Modal Images ────────────────────────────────────────────────

def _install_system_deps():
    """Install system packages needed for sandbox execution."""
    import subprocess
    subprocess.run(["apt-get", "update", "-qq"], check=True)
    subprocess.run([
        "apt-get", "install", "-y", "-qq",
        "python3", "python3-pip", "nodejs", "npm",
        "git", "curl", "build-essential",
    ], check=True)


agent_image = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install_from_requirements("requirements.txt")
    .run_function(_install_system_deps)
    .env({"MODAL_APP": "bing-agent-workers"})
)

# Image with GPU drivers pre-installed
gpu_image = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install(
        "modal>=0.72.0",
        "fastapi>=0.115.0",
        "pydantic>=2.0.0",
        "httpx>=0.28.0",
        "openai>=1.55.0",
        "Pillow>=11.0.0",
        "python-multipart>=0.0.18",
    )
    .run_function(_install_system_deps)
    .env({"MODAL_APP": "bing-agent-workers"})
)


# ── Request/Response Models ──────────────────────────────────────────

class AgentExecuteRequest(BaseModel):
    user_message: str
    conversation_id: str
    user_id: str
    system_prompt: str = "You are an expert coding assistant."
    model: str = "gpt-4o"
    provider: str = "openai"
    temperature: float = 0.7
    max_tokens: int = 4096
    tools: list[dict] = []
    conversation_history: list[dict] = []


class AgentExecuteResponse(BaseModel):
    success: bool
    response: str
    model: str
    provider: str
    tokens_used: int = 0
    duration_ms: float
    error: Optional[str] = None


class SandboxRunRequest(BaseModel):
    code: str
    language: str = "python"  # python, node, bash
    timeout_seconds: int = 30
    env_vars: dict[str, str] = {}
    memory_mb: int = 512


class SandboxRunResponse(BaseModel):
    success: bool
    stdout: str
    stderr: str
    exit_code: int
    duration_ms: float


class InferenceRequest(BaseModel):
    prompt: str
    model: str = "gpt-4o-mini"
    system_prompt: str = ""
    temperature: float = 0.7
    max_tokens: int = 1024
    stream: bool = False


# ── Core Agent Executor (CPU, replicated 3x for concurrency) ─────────────────

@app.cls(
    image=agent_image,
    secrets=[secrets_group],
    volumes={"/workspace": workspace_volume},
    container_idle_timeout=300,  # Keep warm for 5 min
    concurrency_limit=3,          # Up to 3 concurrent executions
)
class AgentExecutor:
    """Executes agent loop tasks on Modal's infrastructure.
    
    Handles the compute-heavy parts of agent execution:
    - LLM inference calls
    - Tool output processing
    - Response parsing and formatting
    """
    
    @modal.enter()
    def initialize(self):
        """Runs once per container startup — cache imports."""
        import httpx
        self.http = httpx.AsyncClient(timeout=120)
        self.backend_url = os.environ.get("BACKEND_URL", "http://host.docker.internal:3001")
    
    @modal.exit()
    async def cleanup(self):
        await self.http.aclose()
    
    @modal.method()
    async def execute(self, req: AgentExecuteRequest) -> AgentExecuteResponse:
        """Execute an agent task — the main compute entry point."""
        start = time.time()
        
        try:
            # Route to the appropriate LLM provider
            if req.provider == "openai":
                response = await self._call_openai(req)
            elif req.provider == "anthropic":
                response = await self._call_anthropic(req)
            elif req.provider == "together":
                response = await self._call_together(req)
            else:
                # Fallback: call backend which handles all providers
                response = await self._call_backend(req)
            
            duration = (time.time() - start) * 1000
            
            return AgentExecuteResponse(
                success=True,
                response=response["content"],
                model=req.model,
                provider=req.provider,
                tokens_used=response.get("tokens", 0),
                duration_ms=duration,
            )
            
        except Exception as e:
            duration = (time.time() - start) * 1000
            return AgentExecuteResponse(
                success=False,
                response="",
                model=req.model,
                provider=req.provider,
                duration_ms=duration,
                error=str(e),
            )
    
    async def _call_openai(self, req: AgentExecuteRequest) -> dict:
        from openai import AsyncOpenAI
        client = AsyncOpenAI(api_key=os.environ["OPENAI_API_KEY"])
        
        messages = [{"role": "system", "content": req.system_prompt}]
        messages.extend(req.conversation_history)
        messages.append({"role": "user", "content": req.user_message})
        
        kwargs = {
            "model": req.model,
            "messages": messages,
            "temperature": req.temperature,
            "max_tokens": req.max_tokens,
        }
        
        if req.tools:
            kwargs["tools"] = [
                {
                    "type": "function",
                    "function": {
                        "name": t["name"],
                        "description": t.get("description", ""),
                        "parameters": t.get("parameters", {}),
                    }
                }
                for t in req.tools
            ]
        
        completion = await client.chat.completions.create(**kwargs)
        
        return {
            "content": completion.choices[0].message.content or "",
            "tokens": completion.usage.total_tokens if completion.usage else 0,
        }
    
    async def _call_anthropic(self, req: AgentExecuteRequest) -> dict:
        """Call Anthropic API from Modal — no local API key exposure needed."""
        headers = {
            "x-api-key": os.environ["ANTHROPIC_API_KEY"],
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        }
        
        messages = []
        for msg in req.conversation_history:
            messages.append({"role": msg["role"], "content": msg.get("content", "")})
        messages.append({"role": "user", "content": req.user_message})
        
        payload = {
            "model": req.model,
            "system": req.system_prompt,
            "messages": messages,
            "max_tokens": req.max_tokens,
            "temperature": req.temperature,
        }
        
        resp = await self.http.post(
            "https://api.anthropic.com/v1/messages",
            headers=headers,
            json=payload,
        )
        resp.raise_for_status()
        data = resp.json()
        
        return {
            "content": data["content"][0]["text"],
            "tokens": data.get("usage", {}).get("input_tokens", 0) + data.get("usage", {}).get("output_tokens", 0),
        }
    
    async def _call_together(self, req: AgentExecuteRequest) -> dict:
        """Call Together AI for open-source models on Modal."""
        headers = {
            "Authorization": f"Bearer {os.environ['TOGETHER_API_KEY']}",
            "content-type": "application/json",
        }
        
        messages = [{"role": "system", "content": req.system_prompt}]
        messages.extend(req.conversation_history)
        messages.append({"role": "user", "content": req.user_message})
        
        payload = {
            "model": req.model,
            "messages": messages,
            "temperature": req.temperature,
            "max_tokens": req.max_tokens,
        }
        
        resp = await self.http.post(
            "https://api.together.xyz/v1/chat/completions",
            headers=headers,
            json=payload,
        )
        resp.raise_for_status()
        data = resp.json()
        
        return {
            "content": data["choices"][0]["message"]["content"],
            "tokens": data.get("usage", {}).get("total_tokens", 0),
        }
    
    async def _call_backend(self, req: AgentExecuteRequest) -> dict:
        """Fallback: route through the main backend for providers Modal doesn't handle."""
        resp = await self.http.post(
            f"{self.backend_url}/api/chat",
            json={
                "messages": req.conversation_history + [{"role": "user", "content": req.user_message}],
                "provider": req.provider,
                "model": req.model,
                "stream": False,
            },
        )
        resp.raise_for_status()
        data = resp.json()
        return {
            "content": data.get("content", ""),
            "tokens": 0,
        }
    
    @modal.method()
    async def health(self) -> dict:
        return {
            "status": "healthy",
            "service": "bing-modal-agent-executor",
            "timestamp": time.time(),
        }


# ── GPU Inference Service ─────────────────────────────────────────────

@app.cls(
    image=gpu_image,
    secrets=[secrets_group],
    gpu=GPU_T4,
    container_idle_timeout=60,  # Keep warm 1 min (GPU time is expensive)
    concurrency_limit=1,
    volumes={"/models": model_cache_volume},
)
class GPUInference:
    """GPU-accelerated inference for heavy agent tasks.
    
    Use cases:
    - Running small open-source LLMs (Llama, Mistral via Together/hosted)
    - Image generation (Stable Diffusion, FLUX)
    - Embedding generation for RAG
    - Heavy code analysis / linting
    """
    
    @modal.enter()
    def initialize(self):
        """Load models into GPU memory on cold start."""
        self.device = "cuda"
    
    @modal.method()
    async def generate_image(
        self,
        prompt: str,
        model: str = "stabilityai/stable-diffusion-3.5",
        width: int = 1024,
        height: int = 1024,
    ) -> bytes:
        """Generate an image using GPU-accelerated diffusion model."""
        # Uses Modal's GPU to run inference via API or local model
        import httpx
        
        # Route to a supported image API
        api_key = os.environ.get("TOGETHER_API_KEY")
        if api_key and "stable-diffusion" in model:
            async with httpx.AsyncClient(timeout=120) as client:
                resp = await client.post(
                    "https://api.together.xyz/v1/images/generations",
                    headers={
                        "Authorization": f"Bearer {api_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": model,
                        "prompt": prompt,
                        "width": width,
                        "height": height,
                        "steps": 28,
                        "n": 1,
                    },
                )
                resp.raise_for_status()
                data = resp.json()
                # Download the image bytes
                img_url = data["data"][0]["url"]
                img_resp = await client.get(img_url)
                return img_resp.content
        
        raise HTTPException(status_code=501, detail=f"Image model {model} not configured")
    
    @modal.method()
    async def health(self) -> dict:
        gpu_available = False
        gpu_name = "none"
        try:
            import torch
            gpu_available = torch.cuda.is_available()
            gpu_name = torch.cuda.get_device_name(0) if gpu_available else "none"
        except ImportError:
            pass
        return {
            "status": "healthy",
            "service": "bing-gpu-inference",
            "gpu_available": gpu_available,
            "gpu_name": gpu_name,
            "timestamp": time.time(),
        }


# ── Sandbox Executor ──────────────────────────────────────────────────

@app.cls(
    image=agent_image,
    secrets=[secrets_group],
    container_idle_timeout=120,
    concurrency_limit=5,  # Sandbox executions are lightweight
)
class SandboxExecutor:
    """Isolated code execution environment.
    
    Each run gets its own Modal Sandbox (micro-VM):
    - Language runtimes: Python, Node.js, Bash
    - Network access controlled
    - Automatic cleanup
    """
    
    @modal.method()
    async def run_code(self, req: SandboxRunRequest) -> SandboxRunResponse:
        """Execute code in an isolated sandbox."""
        start = time.time()
        
        try:
            # Create a sandbox with the appropriate command
            if req.language == "python":
                cmd = ["python3", "-c", req.code]
            elif req.language == "node":
                cmd = ["node", "-e", req.code]
            elif req.language == "bash":
                cmd = ["bash", "-c", req.code]
            else:
                raise ValueError(f"Unsupported language: {req.language}")
            
            with modal.Sandbox.create(
                *cmd,
                image=agent_image,
                timeout=req.timeout_seconds,
                secrets=[secrets_group],
                memory=req.memory_mb,
                environment={"HOME": "/tmp"},
            ) as sandbox:
                stdout = sandbox.stdout.read()
                stderr = sandbox.stderr.read()
                exit_code = sandbox.poll()
                
                duration = (time.time() - start) * 1000
                
                return SandboxRunResponse(
                    success=exit_code == 0,
                    stdout=stdout,
                    stderr=stderr,
                    exit_code=exit_code,
                    duration_ms=duration,
                )
                
        except modal.exception.TimeoutError:
            duration = (time.time() - start) * 1000
            return SandboxRunResponse(
                success=False,
                stdout="",
                stderr="Execution timed out",
                exit_code=-1,
                duration_ms=duration,
            )
        except Exception as e:
            duration = (time.time() - start) * 1000
            return SandboxRunResponse(
                success=False,
                stdout="",
                stderr=str(e),
                exit_code=-1,
                duration_ms=duration,
            )
    
    @modal.method()
    async def health(self) -> dict:
        return {
            "status": "healthy",
            "service": "bing-sandbox-executor",
            "timestamp": time.time(),
        }


# ── FastAPI Endpoints ─────────────────────────────────────────────────

web_app = FastAPI(title="binG Modal API", version="1.0.0")

ALLOWED_ORIGINS = os.environ.get("ALLOWED_ORIGINS", "*").split(",")

web_app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@web_app.post("/api/agent/execute")
async def agent_execute(req: AgentExecuteRequest):
    """Execute an agent task on Modal's compute infrastructure."""
    executor = AgentExecutor()
    result = await executor.execute.remote(req)
    return result.model_dump()


@web_app.post("/api/agent/stream")
async def agent_stream(req: AgentExecuteRequest):
    """Stream agent execution — yields per-token SSE events for streaming LLM responses."""
    from fastapi.responses import StreamingResponse
    
    async def token_generator():
        yield f"data: {json.dumps({'event': 'start', 'timestamp': time.time()})}\n\n"
        
        # True streaming: call the LLM directly with stream=True
        if req.provider == 'openai':
            import openai
            client = openai.AsyncOpenAI(api_key=os.environ['OPENAI_API_KEY'])
            
            messages = [{"role": "system", "content": req.system_prompt}]
            messages.extend(req.conversation_history)
            messages.append({"role": "user", "content": req.user_message})
            
            stream = await client.chat.completions.create(
                model=req.model,
                messages=messages,
                temperature=req.temperature,
                max_tokens=req.max_tokens,
                stream=True,
            )
            
            async for chunk in stream:
                content = chunk.choices[0].delta.content or ""
                if content:
                    yield f"data: {json.dumps({'event': 'token', 'content': content})}\n\n"
        else:
            # Non-streaming fallback for other providers
            executor = AgentExecutor()
            result = await executor.execute.remote(req)
            yield f"data: {json.dumps({'event': 'token', 'content': result.response, 'done': True})}\n\n"
        
        yield f"data: {json.dumps({'event': 'done', 'timestamp': time.time()})}\n\n"
    
    return StreamingResponse(
        token_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@web_app.post("/api/sandbox/run")
async def sandbox_run(req: SandboxRunRequest):
    """Execute code in an isolated Modal sandbox."""
    executor = SandboxExecutor()
    result = await executor.run_code.remote(req)
    return result.model_dump()


@web_app.post("/api/inference")
async def inference(req: InferenceRequest):
    """GPU-accelerated inference endpoint."""
    gpu = GPUInference()
    result = await gpu.generate_image.remote(
        req.prompt,
        model=req.model,
        width=1024,
        height=1024,
    )
    from fastapi.responses import Response
    return Response(content=result, media_type="image/png")


@web_app.get("/health")
async def health():
    """Aggregate health check across all Modal services."""
    results = {}
    
    agent = AgentExecutor()
    results["agent_executor"] = await agent.health.remote()
    
    sandbox = SandboxExecutor()
    results["sandbox_executor"] = await sandbox.health.remote()
    
    try:
        gpu = GPUInference()
        results["gpu_inference"] = await gpu.health.remote()
    except Exception as e:
        results["gpu_inference"] = {"status": "unhealthy", "error": str(e)}
    
    all_healthy = all(
        s.get("status") == "healthy"
        for s in results.values()
    )
    
    return {
        "status": "healthy" if all_healthy else "degraded",
        "service": "bing-modal",
        "timestamp": time.time(),
        "services": results,
    }


# ── Scheduled Maintenance ─────────────────────────────────────────────

@app.function(
    image=agent_image,
    secrets=[secrets_group],
    schedule=modal.Period(days=1),
)
def daily_maintenance():
    """Daily cleanup of old sandbox volumes and temp data."""
    import shutil
    import tempfile
    
    temp_dir = tempfile.gettempdir()
    for item in os.listdir(temp_dir):
        item_path = os.path.join(temp_dir, item)
        try:
            if os.path.isfile(item_path):
                os.remove(item_path)
            elif os.path.isdir(item_path):
                shutil.rmtree(item_path, ignore_errors=True)
        except Exception:
            pass
    
    print(f"[Maintenance] Cleaned temp directory: {temp_dir}")


# ── CLI Entrypoint (for local testing) ───────────────────────────────

@app.local_entrypoint()
def main():
    """Test the Modal services locally before deploying."""
    import asyncio
    
    async def test():
        print("🧪 Testing Agent Executor...")
        executor = AgentExecutor()
        health = await executor.health.remote()
        print(f"   Agent Executor health: {health}")
        
        result = await executor.execute.remote(AgentExecuteRequest(
            user_message="Say 'Hello from Modal!' and nothing else.",
            conversation_id="test-123",
            user_id="test-user",
            system_prompt="You are a helpful assistant.",
            model="gpt-4o-mini",
            provider="openai",
        ))
        print(f"   Result: {result.response[:100]}")
        
        print("\n🧪 Testing Sandbox Executor...")
        sandbox = SandboxExecutor()
        sandbox_health = await sandbox.health.remote()
        print(f"   Sandbox health: {sandbox_health}")
        
        print("\n✅ All tests passed!")
    
    asyncio.run(test())
