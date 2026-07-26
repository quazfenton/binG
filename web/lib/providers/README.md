# Provider Model Fetcher

Tools for fetching and managing AI model lists from various providers with support for filtering free models.

## Overview

This repository contains:
- `providers_model_fetcher.py`: Core Python library with abstract provider interface
- `update_model_snapshot.sh`: Bash CLI wrapper for easy usage

## Features

- **Provider Abstraction**: Easy to add new providers by extending `ModelProvider` base class
- **Free Model Filtering**: Providers can implement custom logic to identify free models
- **Flexible Output**: JSON, ID lists, or raw model data
- **Snapshot Management**: Automatic timestamped file generation
- **Zero Dependencies**: Uses only Python standard library

## Supported Providers

### OpenRouter
- **Endpoint**: `https://openrouter.ai/api/v1/models`
- **Auth**: None required (public endpoint)
- **Free Detection**: Models where `pricing.prompt == 0.0`
- **Docs**: https://openrouter.ai

### NVIDIA NIM
- **Endpoint**: `https://integrate.api.nvidia.com/v1/models`
- **Auth**: Requires `NVIDIA_API_KEY` environment variable
- **Free Detection**: Not reliably determinable via API alone (returns all models)
- **Alternative**: Free/preview models listed at https://build.nvidia.com/models?filters=nimType%3Anim_type_preview
- **Docs**: https://docs.api.nvidia.com/

## Installation

No installation required - just copy the scripts to your project:

```bash
cp providers_model_fetcher.py update_model_snapshot.sh /path/to/your/project/
chmod +x update_model_snapshot.sh
```

## Usage

### Python Library

```python
from providers_model_fetcher import OpenRouterProvider, NVIDIAProvider

# Get free OpenRouter models
or_provider = OpenRouterProvider()
all_models = or_provider.fetch()
free_models = or_provider.filter_free(all_models)
free_model_ids = or_provider.extract_ids(free_models)

# Get NVIDIA models (requires env var)
import os
os.environ['NVIDIA_API_KEY'] = 'your-key-here'
nv_provider = NVIDIAProvider()
all_models = nv_provider.fetch()
model_ids = nv_provider.extract_ids(all_models)
```

### Command Line

```bash
# Get help
./update_model_snapshot.sh

# Get free OpenRouter models (saved to ./snapshots/)
./update_model_snapshot.sh openrouter free

# Get all model IDs from NVIDIA (requires NVIDIA_API_KEY)
export NVIDIA_API_KEY="your-key-here"
./update_model_snapshot.sh nvidia ids

# Get JSON output to specific file
./update_model_snapshot.sh openrouter json ./openrouter-models.json

# Get all models with timestamped filename (default)
./update_model_snapshot.sh nvidia
```

### Environment Variables

- `NVIDIA_API_KEY`: Required for NVIDIA provider access
- `OUT_DIR`: Output directory for snapshots (default: `./snapshots`)

## Output Formats

### JSON Output (default)
```json
{
  "provider": "openrouter",
  "count": 127,
  "models": [
    {
      "id": "openai/gpt-oss-20b:free",
      "name": "OpenAI GPT-OSS 20B Free",
      "pricing": {
        "prompt": "0",
        "completion": "0"
      },
      // ... other fields
    }
  ]
}
```

### ID List Output (--ids)
```
openai/gpt-oss-20b:free
google/gemma-4-31b-it:free
nvidia/nemotron-3-super-120b-a12b:free
// ... one ID per line
```

## Adding New Providers

To add a new provider, create a class that inherits from `ModelProvider` and implement:

1. `fetch()` - Retrieve raw model data from provider's API
2. `extract_ids(models)` - Extract string IDs from model objects  
3. `filter_free(models)` - (Optional) Override to implement free model detection

Then register it in `PROVIDER_REGISTRY` or use it directly.

## Examples

See the scripts themselves for usage examples, or run:
```bash
./update_model_snapshot.sh  # Shows help with examples
```

## Requirements

- Python 3.6+
- No external dependencies (uses only standard library)
- bash 3.0+ (for the wrapper script)

## License

MIT