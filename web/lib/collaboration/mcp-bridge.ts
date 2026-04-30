/**
 * Workspace MCP Bridge
 * 
 * Uses LiveKit to broadcast Virtual Filesystem (VFS) mutations 
 * for real-time collaborative workspace synchronization.
 */

import { RoomEvent } from 'livekit-client';
import { chatLogger } from '@/lib/chat/chat-logger';

export class WorkspaceMCPBridge {
  private room: any;

  constructor(room: any) {
    this.room = room;
  }

  // Broadcast VFS mutation to peers
  broadcastMutation(mutation: { type: string; path: string; data: any }) {
    if (!this.room) return;
    
    const payload = JSON.stringify({
      topic: 'VFS_MUTATION',
      ...mutation,
      timestamp: Date.now(),
    });

    this.room.localParticipant.publishData(new TextEncoder().encode(payload), {
      reliable: true,
      kind: 1, // DataPacket_Kind.RELIABLE
    });
  }

  // Listen for remote mutations
  listen(onMutation: (mutation: any) => void) {
    if (!this.room) return;

    this.room.on(RoomEvent.DataReceived, (payload: Uint8Array, participant: any) => {
      try {
        const data = JSON.parse(new TextDecoder().decode(payload));
        if (data.topic === 'VFS_MUTATION') {
          onMutation(data);
        }
      } catch (e) {
        chatLogger.error('Failed to parse VFS mutation', { error: e });
      }
    });
  }
}
