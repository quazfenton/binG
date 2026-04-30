/**
 * LiveKitVFSSync
 * 
 * Bridges VFS file events to LiveKit Data Channels for real-time collaboration.
 * 
 * Usage:
 * const bridge = new LiveKitVFSSync(livekitRoom, (mutation) => {
 *   // Handle remote mutation (e.g., apply to local VFS)
 *   virtualFilesystem.writeFile(mutation.userId, mutation.path, mutation.content);
 * });
 * 
 * // Send local mutation
 * bridge.sync({ type: 'write', path: 'index.ts', content: '...' });
 */

import { Room, RoomEvent } from 'livekit-client';
import { chatLogger } from '@/lib/chat/chat-logger';

export interface VFSMutation {
  type: 'write' | 'delete' | 'mkdir';
  path: string;
  content?: string;
  userId: string;
  sessionId: string;
}

export class LiveKitVFSSync {
  private room: Room;
  private onRemoteMutation: (mutation: VFSMutation) => void;

  constructor(room: Room, onRemoteMutation: (mutation: VFSMutation) => void) {
    this.room = room;
    this.onRemoteMutation = onRemoteMutation;

    // Listen for incoming data packets
    this.room.on(RoomEvent.DataReceived, this.handleDataReceived.bind(this));
  }

  private handleDataReceived(payload: Uint8Array, participant?: any) {
    try {
      const decoder = new TextDecoder();
      const message = JSON.parse(decoder.decode(payload));

      if (message.topic === 'VFS_SYNC') {
        chatLogger.debug('[LiveKitVFSSync] Received remote mutation', { 
          from: participant?.identity,
          path: message.path 
        });
        this.onRemoteMutation(message as VFSMutation);
      }
    } catch (e) {
      chatLogger.error('[LiveKitVFSSync] Failed to parse incoming VFS mutation', { error: e });
    }
  }

  /**
   * Sync a local mutation to all other participants in the room
   */
  public sync(mutation: VFSMutation) {
    if (this.room.state !== 'connected') return;

    const payload = JSON.stringify({
      topic: 'VFS_SYNC',
      ...mutation,
      timestamp: Date.now(),
    });

    const encoder = new TextEncoder();
    this.room.localParticipant.publishData(encoder.encode(payload), {
      reliable: true,
    });
  }
}
