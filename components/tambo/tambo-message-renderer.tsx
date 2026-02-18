"use client";

import { useTamboContext } from '@/contexts/tambo-context';
import { MessageBubble } from '@/components/message-bubble';
import type { Message } from '@/types';

interface TamboMessageRendererProps {
  message: Message;
  isStreaming?: boolean;
  onStreamingComplete?: () => void;
}

export function TamboMessageRenderer({ 
  message, 
  isStreaming,
  onStreamingComplete 
}: TamboMessageRendererProps) {
  const { enabled } = useTamboContext();

  // Check if message has Tambo metadata
  const hasTamboComponents = message.metadata?.tamboComponents ||
                             message.metadata?.useTambo ||
                             (message as any).components?.length > 0;

  // If Tambo not enabled or no Tambo components, use standard MessageBubble
  if (!enabled || !hasTamboComponents) {
    return (
      <MessageBubble 
        message={message} 
        isStreaming={isStreaming}
        onStreamingComplete={onStreamingComplete}
      />
    );
  }

  // Render with Tambo enhancement
  return (
    <div className="tambo-message-wrapper">
      <MessageBubble 
        message={message} 
        isStreaming={isStreaming}
        onStreamingComplete={onStreamingComplete}
      />
      {(message as any).components && (
        <div className="tambo-components mt-2 space-y-2">
          {/* Tambo SDK renders dynamic components here */}
        </div>
      )}
    </div>
  );
}
