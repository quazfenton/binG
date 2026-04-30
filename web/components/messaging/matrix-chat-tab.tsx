import React, { useState, useEffect } from 'react';
import { MessagingService } from '@/lib/messaging/messaging-service';

export function MatrixChatTab() {
  const [messages, setMessages] = useState<any[]>([]);
  const [input, setInput] = useState('');
  const [user, setUser] = useState<{username: string} | null>(null);

  useEffect(() => {
    // Simulate auto-login on mount
    MessagingService.connect('user@example.com').then(setUser);
  }, []);

  const sendMessage = () => {
    if (!input) return;
    setMessages([...messages, { id: Date.now().toString(), sender: user?.username || 'me', content: input, timestamp: Date.now() }]);
    setInput('');
  };

  return (
    <div className="flex flex-col h-full bg-slate-950 text-white p-4">
      <div className="flex-1 overflow-y-auto space-y-4 mb-4">
        {messages.map((msg) => (
          <div key={msg.id} className="p-2 bg-slate-800 rounded">
            <span className="font-bold text-blue-400">{msg.sender.replace(/[&<>"']/g, "")}: </span>
            {msg.content.replace(/[&<>"']/g, "")}
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <input 
          className="flex-1 bg-slate-900 border border-slate-700 p-2 rounded"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Send a message..."
        />
        <button onClick={sendMessage} className="bg-blue-600 px-4 py-2 rounded">Send</button>
      </div>
    </div>
  );
}
