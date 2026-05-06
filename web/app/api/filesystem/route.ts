import { NextRequest, NextResponse } from 'next/server';

// Import all existing handlers
import { POST as readPOST } from './read/route';
import { POST as writePOST } from './write/route';
import { POST as deletePOST } from './delete/route';
import { GET as listGET } from './list/route';
import { POST as mkdirPOST } from './mkdir/route';
import { POST as movePOST } from './move/route';
import { POST as renamePOST } from './rename/route';
import { POST as createFilePOST } from './create-file/route';
import { GET as searchGET } from './search/route';
import { POST as rollbackPOST } from './rollback/route';
import { GET as snapshotGET } from './snapshot/route';
import { POST as snapshotRestorePOST } from './snapshot/restore/route';
import { GET as diffsGET } from './diffs/route';
import { POST as diffsApplyPOST } from './diffs/apply/route';
import { POST as editsAcceptPOST } from './edits/accept/route';
import { POST as editsDenyPOST } from './edits/deny/route';
import { GET as eventsPushGET, POST as eventsPushPOST } from './events/push/route';
import { GET as importGET, POST as importPOST } from './import/route';
import { GET as commitsGET } from './commits/route';
import { GET as contextPackGET, POST as contextPackPOST } from './context-pack/route';

/**
 * Consolidated filesystem route
 * Dispatches to individual handlers based on action query param
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  switch (action) {
    case 'list':
      return listGET(request);
    case 'search':
      return searchGET(request);
    case 'snapshot':
      return snapshotGET(request);
    case 'diffs':
      return diffsGET(request);
    case 'commits':
      return commitsGET(request);
    case 'events-push':
      return eventsPushGET(request);
    case 'import':
      return importGET(request);
    case 'context-pack':
      return contextPackGET(request);
    default:
      return NextResponse.json(
        { error: 'Invalid action. Use ?action=list|search|snapshot|diffs|commits|events-push|import|context-pack' },
        { status: 400 }
      );
  }
}

export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  switch (action) {
    case 'read':
      return readPOST(request);
    case 'write':
      return writePOST(request);
    case 'delete':
      return deletePOST(request);
    case 'mkdir':
      return mkdirPOST(request);
    case 'move':
      return movePOST(request);
    case 'rename':
      return renamePOST(request);
    case 'create-file':
      return createFilePOST(request);
    case 'rollback':
      return rollbackPOST(request);
    case 'snapshot-restore':
      return snapshotRestorePOST(request);
    case 'diffs-apply':
      return diffsApplyPOST(request);
    case 'edits-accept':
      return editsAcceptPOST(request);
    case 'edits-deny':
      return editsDenyPOST(request);
    case 'events-push':
      return eventsPushPOST(request);
    case 'import':
      return importPOST(request);
    case 'context-pack':
      return contextPackPOST(request);
    default:
      return NextResponse.json(
        { error: 'Invalid action. Use ?action=read|write|delete|mkdir|move|rename|create-file|rollback|snapshot-restore|diffs-apply|edits-accept|edits-deny|events-push|import|context-pack' },
        { status: 400 }
      );
  }
}