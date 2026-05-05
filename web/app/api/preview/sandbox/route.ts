/**
 * POST /api/preview/sandbox   — Deploy files to OpenSandbox and return preview URL
 * PUT  /api/preview/sandbox   — Update files in an existing preview sandbox
 * DELETE /api/preview/sandbox — Destroy a preview sandbox
 * GET  /api/preview/sandbox   — List active preview sessions
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  openSandboxPreviewService,
  type PreviewDeployRequest,
} from '@/lib/sandbox/local/opensandbox-preview-service'

export const runtime = 'edge'
export const maxDuration = 120 // 2 minutes for install + start

/**
 * POST: Deploy project files to an OpenSandbox preview container
 *
 * Body: { files: Record<string, string>, framework?, installCommand?, startCommand?, port?, sandboxId? }
 * Returns: { success, previewUrl, sandboxId, logs, duration }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    if (!body.files || typeof body.files !== 'object' || Object.keys(body.files).length === 0) {
      return NextResponse.json(
        { error: 'files is required and must be a non-empty object' },
        { status: 400 },
      )
    }

    const deployRequest: PreviewDeployRequest = {
      files: body.files,
      framework: body.framework,
      installCommand: body.installCommand,
      startCommand: body.startCommand,
      port: body.port,
      userId: body.userId,
      sandboxId: body.sandboxId,
    }

    const result = await openSandboxPreviewService.deploy(deployRequest)

    return NextResponse.json(result, { status: result.success ? 200 : 500 })
  } catch (error: any) {
    console.error('[API:preview/sandbox] POST error:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 },
    )
  }
}

/**
 * PUT: Update files in an existing preview sandbox (hot reload)
 *
 * Body: { sandboxId: string, files: Record<string, string> }
 */
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json()

    if (!body.sandboxId || !body.files) {
      return NextResponse.json(
        { error: 'sandboxId and files are required' },
        { status: 400 },
      )
    }

    const result = await openSandboxPreviewService.updateFiles(body.sandboxId, body.files)
    return NextResponse.json(result, { status: result.success ? 200 : 404 })
  } catch (error: any) {
    console.error('[API:preview/sandbox] PUT error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

/**
 * DELETE: Destroy a preview sandbox
 *
 * Query: ?sandboxId=osb-preview-xxx
 */
export async function DELETE(req: NextRequest) {
  try {
    const sandboxId = req.nextUrl.searchParams.get('sandboxId')

    if (!sandboxId) {
      return NextResponse.json({ error: 'sandboxId query param is required' }, { status: 400 })
    }

    await openSandboxPreviewService.destroy(sandboxId)
    return NextResponse.json({ success: true, sandboxId })
  } catch (error: any) {
    console.error('[API:preview/sandbox] DELETE error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

/**
 * GET: List active preview sessions
 */
export async function GET() {
  try {
    const sessions = openSandboxPreviewService.listSessions()
    return NextResponse.json({ sessions })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
