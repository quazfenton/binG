import type { IntegrationProvider, ToolProvider } from './types';

export class ToolProviderRegistry {
  private readonly entries = new Map<IntegrationProvider, ToolProvider>();

  register(provider: ToolProvider): void {
    this.entries.set(provider.name, provider);
  }

  list(): ToolProvider[] {
    return Array.from(this.entries.values());
  }

  get(name: IntegrationProvider): ToolProvider | undefined {
    return this.entries.get(name);
  }
}
