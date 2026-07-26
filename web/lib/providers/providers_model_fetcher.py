#!/usr/bin/env python3
"""
Unified provider model fetcher for OpenRouter, NVIDIA, and other AI providers.
Supports fetching model lists and filtering for free models where possible.

Usage:
    # Import and use programmatically
    from providers_model_fetcher import OpenRouterProvider, NVIDIAProvider
    
    # OpenRouter free models
    or_provider = OpenRouterProvider()
    free_models = or_provider.filter_free(or_provider.fetch())
    
    # NVIDIA models (no free filtering available via API)
    nv_provider = NVIDIA_API_KEY="...")  # Set env var
    all_models = nv_provider.fetch()
    model_ids = nv_provider.extract_ids(all_models)
    
    # CLI usage
    python providers_model_fetcher.py openrouter --free
    python providers_model_fetcher.py nvidia --ids
"""

import json
import os
import sys
import abc
from typing import List, Dict, Any, Optional
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError


class ModelProvider(abc.ABC):
    """Abstract base class for AI model providers."""
    
    def __init__(self):
        self.name = self.__class__.__name__.replace('Provider', '').lower()
    
    @abc.abstractmethod
    def fetch(self) -> List[Dict[str, Any]]:
        """
        Fetch raw model data from the provider's API.
        
        Returns:
            List of model objects (format varies by provider)
        """
        pass
    
    def filter_free(self, models: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Filter models to only free ones. Override in subclasses if free filtering is possible.
        
        Args:
            models: Raw model list from fetch()
            
        Returns:
            Filtered list of free models (returns all models if not implemented)
        """
        # Default implementation returns all models
        return models
    
    @abc.abstractmethod
    def extract_ids(self, models: List[Dict[str, Any]]) -> List[str]:
        """
        Extract model IDs from model objects.
        
        Args:
            models: List of model objects
            
        Returns:
            List of model ID strings
        """
        pass
    
    def _http_get(self, url: str, headers: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """
        Perform HTTP GET request and return parsed JSON.
        
        Args:
            url: URL to fetch
            headers: Optional HTTP headers
            
        Returns:
            Parsed JSON response
            
        Raises:
            Exception: On HTTP errors or invalid JSON
        """
        if headers is None:
            headers = {}
            
        req = Request(url, headers=headers)
        
        try:
            with urlopen(req) as response:
                data = response.read().decode('utf-8')
                return json.loads(data)
        except HTTPError as e:
            error_body = e.read().decode('utf-8') if e.read() else 'Unknown error'
            raise Exception(f"HTTP {e.code} error fetching {url}: {error_body}")
        except URLError as e:
            raise Exception(f"URL error fetching {url}: {e.reason}")
        except json.JSONDecodeError as e:
            raise Exception(f"Invalid JSON response from {url}: {e}")


class OpenRouterProvider(ModelProvider):
    """OpenRouter model provider."""
    
    def __init__(self):
        super().__init__()
        self.api_url = "https://openrouter.ai/api/v1/models"
    
    def fetch(self) -> List[Dict[str, Any]]:
        """Fetch models from OpenRouter API."""
        data = self._http_get(self.api_url)
        return data.get('data', [])
    
    def filter_free(self, models: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Filter OpenRouter models to only free ones.
        
        Free models have pricing.prompt == 0.0
        """
        free_models = []
        for model in models:
            pricing = model.get('pricing', {})
            prompt_price = float(pricing.get('prompt', 0))
            if prompt_price == 0.0:
                free_models.append(model)
        return free_models
    
    def extract_ids(self, models: List[Dict[str, Any]]) -> List[str]:
        """Extract model IDs from OpenRouter model objects."""
        return [model.get('id', '') for model in models if model.get('id')]


class NVIDIAProvider(ModelProvider):
    """NVIDIA NIM model provider."""
    
    def __init__(self):
        super().__init__()
        self.api_url = "https://integrate.api.nvidia.com/v1/models"
        self.api_key = os.environ.get('NVIDIA_API_KEY')
        if not self.api_key:
            print("Warning: NVIDIA_API_KEY environment variable not set", file=sys.stderr)
    
    def fetch(self) -> List[Dict[str, Any]]:
        """Fetch models from NVIDIA API."""
        if not self.api_key:
            raise Exception("NVIDIA_API_KEY environment variable is required")
        
        headers = {
            'Authorization': f'Bearer {self.api_key}',
            'Accept': 'application/json'
        }
        
        data = self._http_get(self.api_url, headers)
        return data.get('data', [])
    
    def extract_ids(self, models: List[Dict[str, Any]]) -> List[str]:
        """Extract model IDs from NVIDIA model objects."""
        return [model.get('id', '') for model in models if model.get('id')]


# Provider registry for easy lookup
PROVIDER_REGISTRY = {
    'openrouter': OpenRouterProvider,
    'nvidia': NVIDIAProvider,
}


def get_provider(name: str) -> ModelProvider:
    """
    Get a provider instance by name.
    
    Args:
        name: Provider name (case-insensitive)
        
    Returns:
        ModelProvider instance
        
    Raises:
        ValueError: If provider not found
    """
    provider_class = PROVIDER_REGISTRY.get(name.lower())
    if not provider_class:
        available = ', '.join(PROVIDER_REGISTRY.keys())
        raise ValueError(f"Unknown provider '{name}'. Available: {available}")
    return provider_class()


def main():
    """CLI entry point."""
    import argparse
    
    parser = argparse.ArgumentParser(
        description='Fetch model lists from AI providers',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog='''
Examples:
  # Get all OpenRouter models
  python providers_model_fetcher.py openrouter
  
  # Get only free OpenRouter models
  python providers_model_fetcher.py openrouter --free
  
  # Get NVIDIA model IDs (requires NVIDIA_API_KEY)
  python providers_model_fetcher.py nvidia --ids
  
  # Get full JSON output
  python providers_model_fetcher.py openrouter --json
        '''
    )
    
    parser.add_argument(
        'provider',
        choices=list(PROVIDER_REGISTRY.keys()),
        help='Provider to fetch models from'
    )
    
    parser.add_argument(
        '--free',
        action='store_true',
        help='Filter to only free models (if supported by provider)'
    )
    
    parser.add_argument(
        '--ids',
        action='store_true',
        help='Output only model IDs (one per line)'
    )
    
    parser.add_argument(
        '--json',
        action='store_true',
        help='Output full JSON (default if neither --ids nor --free)'
    )
    
    args = parser.parse_args()
    
    try:
        provider = get_provider(args.provider)
        models = provider.fetch()
        
        if args.free:
            models = provider.filter_free(models)
        
        if args.ids:
            model_ids = provider.extract_ids(models)
            for model_id in model_ids:
                if model_id:  # Skip empty IDs
                    print(model_id)
        else:
            # Default to JSON output
            if args.json or not args.ids:
                if args.free:
                    # Add provider metadata to output
                    output = {
                        'provider': provider.name,
                        'filtered_free': True,
                        'count': len(models),
                        'models': models
                    }
                else:
                    output = {
                        'provider': provider.name,
                        'count': len(models),
                        'models': models
                    }
                print(json.dumps(output, indent=2))
    
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()