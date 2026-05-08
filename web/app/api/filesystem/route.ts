import { NextRequest, NextResponse } from 'next/server';

import { POST as readPOST } from './read/gateway';
import { POST as writePOST } from './write/gateway';
import { POST as deletePOST } from './delete/gateway';
import { GET as listGET } from './list/gateway';
import { POST as mkdirPOST } from './mkdir/gateway';
import { POST as movePOST } from './move/gateway';
import { POST as renamePOST } from './rename/gateway';
import { POST as createFilePOST } from './create-file/gateway';
import { GET as searchGET } from './search/gateway';
import { POST as rollbackPOST } from './rollback/gateway';
import { GET as snapshotGET } from './snapshot/gateway';
import { POST as snapshotRestorePOST } from './snapshot/restore/gateway';
import { GET as diffsGET } from './diffs/gateway';
import { POST as diffsApplyPOST } from './diffs/apply/gateway';
import { POST as editsAcceptPOST } from './edits/accept/gateway';
import { POST as editsDenyPOST } from './edits/deny/gateway';
import { GET as eventsPushGET, POST as eventsPushPOST } from './events/push/gateway';
import { GET as importGET, POST as importPOST } from './import/gateway';
import { GET as commitsGET } from './commits/gateway';
import { GET as contextPackGET, POST as contextPackPOST } from './context-pack/gateway';

// GET /api/filesystem/list | /api/filesystem/search | /api/filesystem/snapshot | /api/filesystem/diffs | /api/filesystem/commits | /api/filesystem/events-push | /api/filesystem/import | /api/filesystem/context-pack
export async function GET(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const segments = path.split('/').filter(Boolean);

  if (segments.length < 3 || segments.length > 4) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Strip query string from last segment (e.g. "list?path=project" → "list")
  // 4-segment paths like /api/filesystem/events/push → action = "events-push"
  const action = segments.length === 4
    ? `${segments[2]}-${segments[3]?.split('?')[0] ?? ''}`
    : segments[2]?.split('?')[0] ?? '';

  switch (action) {
    case 'list': return listGET(request);
    case 'search': return searchGET(request);
    case 'snapshot': return snapshotGET(request);
    case 'diffs': return diffsGET(request);
    case 'commits': return commitsGET(request);
    case 'events-push': return eventsPushGET(request);
    case 'import': return importGET(request);
    case 'context-pack': return contextPackGET(request);
    default:
      return NextResponse.json({ error: 'Not found. Use /filesystem/list|search|snapshot|diffs|commits|events-push|import|context-pack' }, { status: 404 });
  }
}

// POST /api/filesystem/read | /api/filesystem/write | /api/filesystem/delete | /api/filesystem/mkdir | /api/filesystem/move | /api/filesystem/rename | /api/filesystem/create-file | /api/filesystem/rollback | /api/filesystem/snapshot-restore | /api/filesystem/diffs-apply | /api/filesystem/edits-accept | /api/filesystem/edits-deny | /api/filesystem/events-push | /api/filesystem/import | /api/filesystem/context-pack
export async function POST(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const segments = path.split('/').filter(Boolean);

  if (segments.length < 3 || segments.length > 4) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Strip query string from last segment
  // 4-segment paths like /api/filesystem/diffs/apply → action = "diffs-apply"
  const action = segments.length === 4
    ? `${segments[2]}-${segments[3]?.split('?')[0] ?? ''}`
    : segments[2]?.split('?')[0] ?? '';

  switch (action) {
    case 'read': return readPOST(request);
    case 'write': return writePOST(request);
    case 'delete': return deletePOST(request);
    case 'mkdir': return mkdirPOST(request);
    case 'move': return movePOST(request);
    case 'rename': return renamePOST(request);
    case 'create-file': return createFilePOST(request);
    case 'rollback': return rollbackPOST(request);
    case 'snapshot-restore': return snapshotRestorePOST(request);
    case 'diffs-apply': return diffsApplyPOST(request);
    case 'edits-accept': return editsAcceptPOST(request);
    case 'edits-deny': return editsDenyPOST(request);
    case 'events-push': return eventsPushPOST(request);
    case 'import': return importPOST(request);
    case 'context-pack': return contextPackPOST(request);
    default:
      return NextResponse.json({ error: 'Not found. Use /filesystem/read|write|delete|mkdir|move|rename|create-file|rollback|snapshot-restore|diffs-apply|edits-accept|edits-deny|events-push|import|context-pack' }, { status: 404 });
  }
}