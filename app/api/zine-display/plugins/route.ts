/**
 * Zine Display Custom Plugin Registration API
 * 
 * Allows users to register custom data source plugins via JSON configuration.
 * 
 * Endpoints:
 * - POST / - Register a new custom plugin
 * - GET / - List all registered plugins (built-in + custom)
 * - GET /:id - Get specific plugin details
 * - DELETE /:id - Unregister a custom plugin
 * - POST /:id/test - Test a plugin configuration
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { pluginRegistry, type DataSourcePlugin, createFragment as engineCreateFragment } from '@/components/top-panel/plugins/zine-engine';

// In-memory store for custom plugins (in production, use database)
const customPlugins: Map<string, DataSourcePlugin & { isCustom: boolean; createdAt: string }> = new Map();

// ---------------------------------------------------------------------
// Plugin configuration schema for validation
// ---------------------------------------------------------------------

const pluginConfigSchema = z.object({
  id: z.string().min(1).max(64).regex(/^[a-z0-9-]+$/, 'ID must be lowercase alphanumeric with dashes'),
  name: z.string().min(1).max(64),
  icon: z.string().emoji().optional().default('📦'),
  version: z.string().regex(/^\d+\.\d+\.\d+$/).optional().default('1.0.0'),
  description: z.string().max(256).optional(),
  configSchema: z.record(z.object({
    type: z.enum(['string', 'number', 'boolean', 'object']),
    required: z.boolean().optional().default(false),
    default: z.unknown().optional(),
  })).optional(),
  // Fetch function as string (for simple plugins)
  fetchCode: z.string().optional(),
  // Test function as string (optional)
  testCode: z.string().optional(),
});

// ---------------------------------------------------------------------
// Helper: Parse and validate plugin configuration
// ---------------------------------------------------------------------

// SECURITY WARNING: Using new Function() to eval user code is inherently unsafe.
// In production, use vm2 or isolated-vm for sandboxing.
// Users can access browser APIs, make network requests, etc.

function createPluginFromConfig(config: z.infer<typeof pluginConfigSchema>): DataSourcePlugin & { isCustom: boolean; createdAt: string } {
  const basePlugin: DataSourcePlugin = {
    id: config.id,
    name: config.name,
    icon: config.icon,
    version: config.version,
    description: config.description || '',
    configSchema: config.configSchema,
    fetch: async (dsConfig, template) => {
      // Default fetch implementation - returns placeholder
      // In production, this could call an external handler
      return [];
    },
  };

  // If custom fetch code provided, create a fetch function
  if (config.fetchCode) {
    try {
      // SECURITY: In production, replace with vm2 or isolated-vm sandbox
      const fetchFn = new Function('config', 'template', 'fetch', 'createFragment', `
        try {
          ${config.fetchCode}
        } catch (e) {
          console.error('Custom plugin fetch error:', e);
          return [];
        }
      `).bind({});
      
      basePlugin.fetch = async (dsConfig, template) => {
        try {
          // Provide safe versions of required functions
          const safeFetch = (url: string, options?: RequestInit) => fetch(url, options);
          const safeCreateFragment = (content: string, type: string = 'text', source: string = 'custom') => 
            engineCreateFragment(content, type as any, source as any, 'fade-in', template);
          
          const result = fetchFn(dsConfig, template, safeFetch, safeCreateFragment);
          if (Array.isArray(result)) return result;
          if (result) return [result];
        } catch (err) {
          console.error(`[CustomPlugin:${config.id}] Fetch error:`, err);
        }
        return [];
      };
    } catch (err) {
      console.warn(`[CustomPlugin:${config.id}] Invalid fetchCode, using default`);
    }
  }

  // If custom test code provided, create a test function
  if (config.testCode) {
    try {
      const testFn = new Function('config', `
        try {
          ${config.testCode}
        } catch (e) {
          return false;
        }
      `);
      
      basePlugin.test = async (dsConfig) => {
        try {
          return Boolean(testFn(dsConfig));
        } catch {
          return false;
        }
      };
    } catch {
      console.warn(`[CustomPlugin:${config.id}] Invalid testCode`);
    }
  }

  return {
    ...basePlugin,
    isCustom: true,
    createdAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------
// GET /api/zine-display/plugins - List all plugins
// ---------------------------------------------------------------------

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const action = searchParams.get('action');
  const id = searchParams.get('id');

  // Get specific plugin by ID
  if (id) {
    // Check custom plugins first
    const custom = customPlugins.get(id);
    if (custom) {
      return NextResponse.json({
        success: true,
        plugin: custom,
      });
    }

    // Check built-in plugins
    const builtin = pluginRegistry.get(id);
    if (builtin) {
      return NextResponse.json({
        success: true,
        plugin: { ...builtin, isCustom: false },
      });
    }

    return NextResponse.json({
      success: false,
      error: 'Plugin not found',
    }, { status: 404 });
  }

  // List all plugins
  if (action === 'list' || !action) {
    const builtin = pluginRegistry.list().map(p => ({ ...p, isCustom: false }));
    const custom = Array.from(customPlugins.values());
    
    return NextResponse.json({
      success: true,
      plugins: [...builtin, ...custom],
      counts: {
        builtin: builtin.length,
        custom: custom.length,
        total: builtin.length + custom.length,
      },
    });
  }

  // List only custom plugins
  if (action === 'custom') {
    return NextResponse.json({
      success: true,
      plugins: Array.from(customPlugins.values()),
      count: customPlugins.size,
    });
  }

  // List only built-in plugins
  if (action === 'builtin') {
    return NextResponse.json({
      success: true,
      plugins: pluginRegistry.list().map(p => ({ ...p, isCustom: false })),
      count: pluginRegistry.list().length,
    });
  }

  return NextResponse.json({
    success: false,
    error: 'Invalid action. Use: list, custom, builtin, or provide an id parameter.',
  }, { status: 400 });
}

// ---------------------------------------------------------------------
// POST /api/zine-display/plugins - Register a new custom plugin
// ---------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const config = pluginConfigSchema.parse(body);

    // Check if plugin already exists (built-in or custom)
    if (pluginRegistry.get(config.id)) {
      return NextResponse.json({
        success: false,
        error: `Plugin "${config.id}" already exists as built-in. Use a different ID.`,
      }, { status: 409 });
    }

    if (customPlugins.has(config.id)) {
      return NextResponse.json({
        success: false,
        error: `Plugin "${config.id}" already registered. Use PUT to update or choose a different ID.`,
      }, { status: 409 });
    }

    // Create and register the plugin
    const plugin = createPluginFromConfig(config);
    customPlugins.set(config.id, plugin);

    // Also register with the global registry for use in UI
    pluginRegistry.register(plugin);

    console.log(`[Zine-Plugins] Registered custom plugin: ${config.id} v${config.version}`);

    return NextResponse.json({
      success: true,
      message: `Plugin "${config.name}" registered successfully`,
      plugin: {
        id: plugin.id,
        name: plugin.name,
        icon: plugin.icon,
        version: plugin.version,
        isCustom: true,
        createdAt: plugin.createdAt,
      },
    }, { status: 201 });

  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({
        success: false,
        error: 'Invalid plugin configuration',
        details: err.errors.map(e => ({
          field: e.path.join('.'),
          message: e.message,
        })),
      }, { status: 400 });
    }

    console.error('[Zine-Plugins] Registration error:', err);
    return NextResponse.json({
      success: false,
      error: 'Failed to register plugin',
    }, { status: 500 });
  }
}

// ---------------------------------------------------------------------
// PUT /api/zine-display/plugins - Update an existing custom plugin
// ---------------------------------------------------------------------

export async function PUT(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({
        success: false,
        error: 'Plugin ID required. Use ?id=plugin-id',
      }, { status: 400 });
    }

    const existing = customPlugins.get(id);
    if (!existing) {
      return NextResponse.json({
        success: false,
        error: `Custom plugin "${id}" not found. Use POST to create a new one.`,
      }, { status: 404 });
    }

    const body = await request.json();
    const config = pluginConfigSchema.parse({ ...body, id }); // Keep original ID

    // Create updated plugin
    const updatedPlugin = createPluginFromConfig(config);
    customPlugins.set(id, updatedPlugin);
    pluginRegistry.register(updatedPlugin);

    return NextResponse.json({
      success: true,
      message: `Plugin "${config.name}" updated successfully`,
      plugin: {
        id: updatedPlugin.id,
        name: updatedPlugin.name,
        icon: updatedPlugin.icon,
        version: updatedPlugin.version,
        isCustom: true,
      },
    });

  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({
        success: false,
        error: 'Invalid plugin configuration',
        details: err.errors.map(e => ({
          field: e.path.join('.'),
          message: e.message,
        })),
      }, { status: 400 });
    }

    console.error('[Zine-Plugins] Update error:', err);
    return NextResponse.json({
      success: false,
      error: 'Failed to update plugin',
    }, { status: 500 });
  }
}

// ---------------------------------------------------------------------
// DELETE /api/zine-display/plugins - Unregister a custom plugin
// ---------------------------------------------------------------------

export async function DELETE(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const id = searchParams.get('id');

  if (!id) {
    return NextResponse.json({
      success: false,
      error: 'Plugin ID required. Use ?id=plugin-id',
    }, { status: 400 });
  }

  const existing = customPlugins.get(id);
  if (!existing) {
    return NextResponse.json({
      success: false,
      error: `Custom plugin "${id}" not found`,
    }, { status: 404 });
  }

  // Remove from both stores
  customPlugins.delete(id);
  pluginRegistry.unregister(id);

  console.log(`[Zine-Plugins] Unregistered custom plugin: ${id}`);

  return NextResponse.json({
    success: true,
    message: `Plugin "${id}" unregistered successfully`,
  });
}