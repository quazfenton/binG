"use client";

import { useTamboContext } from '@/contexts/tambo-context';
import { MessageBubble } from '@/components/message-bubble';
import type { Message } from '@/types';

interface TamboMessageRendererProps {
  message: Message;
}

export function TamboMessageRenderer({ message }: TamboMessageRendererProps) {
  const { enabled } = useTamboContext();

  const hasTamboComponents = message.metadata?.tamboComponents || 
                             message.metadata?.useTambo ||
                             (message as any).components?.length > 0;

  if (!enabled || !hasTamboComponents) {
    return <MessageBubble message={message} />;
  }

  return (
    <div className="tambo-message-wrapper">
      <MessageBubble message={message} />
      {(message as any).components && (
        <div className="tambo-components mt-2 space-y-2">
          {/* Tambo SDK renders components here */}
        </div>
      )}
    </div>
  );
}
