/**
 * Zine Engine Config API
 * GET /api/zine/config - Get configuration
 * POST /api/zine/config - Save configuration
 */

import { NextRequest, NextResponse } from "next/server";



// ============================================================================
// Types
// ============================================================================

interface StoredConfig {
  dataSources: any[];
  templates: any[];
  settings: {
    autoRotateTemplates?: boolean;
    rotationInterval?: number;
    maxItems?: number;
    enableNotifications?: boolean;
  };
}

// ============================================================================
// In-memory storage (use database in production)
// ============================================================================

const configStore: Map<string, StoredConfig> = new Map();

// ============================================================================
// GET /api/zine/config - Get configuration
// ============================================================================

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const key = searchParams.get("key") || "default";
    
    const config = configStore.get(key) || {
      dataSources: [],
      templates: [],
      settings: {
        autoRotateTemplates: true,
        rotationInterval: 30000,
        maxItems: 10,
        enableNotifications: true,
      },
    };
    
    return NextResponse.json({ config, key });
  } catch (error) {
    console.error("Error fetching zine config:", error);
    return NextResponse.json(
      { error: "Failed to fetch config", details: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

// ============================================================================
// POST /api/zine/config - Save configuration
// ============================================================================

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const key = body.key || "default";
    
    // Validate required fields
    if (!body.dataSources || !body.templates) {
      return NextResponse.json(
        { error: "Missing required fields", required: ["dataSources", "templates"] },
        { status: 400 }
      );
    }
    
    const config: StoredConfig = {
      dataSources: body.dataSources || [],
      templates: body.templates || [],
      settings: body.settings || {
        autoRotateTemplates: true,
        rotationInterval: 30000,
        maxItems: 10,
        enableNotifications: true,
      },
    };
    
    configStore.set(key, config);
    
    return NextResponse.json({ 
      success: true, 
      config,
      key,
      message: "Configuration saved successfully"
    });
  } catch (error) {
    console.error("Error saving zine config:", error);
    return NextResponse.json(
      { error: "Failed to save config", details: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
