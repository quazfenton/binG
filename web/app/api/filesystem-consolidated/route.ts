import { NextRequest, NextResponse } from 'next/server';

// Import all existing handlers
import { GET as readGET, POST as readPOST } from './read/route';
import { POST as writePOST } from './write/route';
import { DELETE as deleteDELETE } from './delete/route';
import { GET as listGET } from './list/route';
import { POST as mkdirPOST } from './mkdir/route';
import { POST as movePOST } from './move/route';
import { POST as renamePOST } from './rename/route';
import { POST as createFilePOST } from './create-file/route';
import { POST as searchPOST } from './search/route';
import { POST as rollbackPOST } from './rollback/route';
import { GET as snapshotGET, POST as snapshotPOST } from './snapshot/route';
import { POST as snapshotRestorePOST } from './snapshot/restore/route';
import { GET as diffsGET } from './diffs/route';
import { POST as diffsApplyPOST } from './diffs/apply/route';
import { POST as editsAcceptPOST } from './edits/accept/route';
import { POST as editsDenyPOST } from './edits/deny/route';
import { POST as eventsPushPOST } from './events/push/route';
import { POST as importPOST } from './import/route';
import { GET as commitsGET } from './commits/route';
import { POST as contextPackPOST } from './context-pack/route';

/**
 * Consolidated filesystem route
 * Dispatches to individual handlers based on action query param
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  switch (action) {
    case 'read':
      return readGET(request);
    case 'list':
      return listGET(request);
    case 'snapshot':
      return snapshotGET(request);
    case 'diffs':
      return diffsGET(request);
    case 'commits':
      return commitsGET(request);
    default:
      return NextResponse.json(
        { error: 'Invalid action. Use ?action=read|list|snapshot|diffs|commits' },
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
    case 'mkdir':
      return mkdirPOST(request);
    case 'move':
      return movePOST(request);
    case 'rename':
      return renamePOST(request);
    case 'create-file':
      return createFilePOST(request);
    case 'search':
      return searchPOST(request);
    case 'rollback':
      return rollbackPOST(request);
    case 'snapshot':
      return snapshotPOST(request);
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
        { error: 'Invalid action. Use ?action=write|mkdir|move|rename|create-file|search|rollback|snapshot|snapshot-restore|diffs-apply|edits-accept|edits-deny|events-push|import|context-pack' },
        { status: 400 }
      );
  }
}

export async function DELETE(request: NextRequest) {
  return deleteDELETE(request);
}