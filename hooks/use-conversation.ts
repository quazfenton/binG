"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { v4 as uuidv4 } from 'uuid';

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  isStreaming?: boolean;
  isComplete?: boolean;
  isError?: boolean;
}

interface ConversationSettings {
  provider: string;
  model: string;
  temperature: number;
  maxTokens: number;
  streamingEnabled: boolean;
  voiceEnabled: boolean;
}

const DEFAULT_SETTINGS: ConversationSettings = {
  provider: 'openrouter',
  model: '',
  temperature: 0.7,
  maxTokens: 80000,
  streamingEnabled: true,
  voiceEnabled: false,
};

export function useConversation() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<ConversationSettings>(DEFAULT_SETTINGS);
  const abortControllerRef = useRef<AbortController | null>(null);
  const messagesRef = useRef<Message[]>(messages); // Create a ref for messages

  // Update the ref whenever messages state changes
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  
  // Load settings from localStorage on mount
  useEffect(() => {
    try {
      const savedSettings = localStorage.getItem('conversationSettings');
      if (savedSettings) {
        setSettings(JSON.parse(savedSettings));
      }
    } catch (err) {
      console.error('Failed to load settings:', err);
    }
  }, []);
  
  // Save settings to localStorage when they change
  useEffect(() => {
    try {
      localStorage.setItem('conversationSettings', JSON.stringify(settings));
    } catch (err) {
      console.error('Failed to save settings:', err);
    }
  }, [settings]);
  
  // Handle streaming response
  const handleStreamingResponse = useCallback(async (
    response: Response,
    messageId: string,
    retryCount = 0
  ) => {
    const MAX_RETRIES = 3;
    const RETRY_DELAY = 1000; // 1 second
    
    if (!response.body) {
      throw new Error("No response body available");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullContent = "";
    let buffer = "";
    let isComplete = false;
    
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;
        
        // Process complete lines
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        
        for (const line of lines) {
          if (!line.trim() || !line.startsWith('data: ')) continue;
          
          const data = line.slice(6).trim();
          if (data === '[DONE]') {
            isComplete = true;
            break;
          }
          
          try {
            const parsed = JSON.parse(data);
            if (parsed.choices?.[0]?.delta?.content) {
              fullContent += parsed.choices[0].delta.content;
              setMessages(prev => {
                const existing = prev.find(m => m.id === messageId);
                if (existing) {
                  return prev.map(m => 
                    m.id === messageId 
                      ? { ...m, content: fullContent }
                      : m
                  );
                }
                return [...prev, {
                  id: messageId,
                  role: 'assistant',
                  content: fullContent,
                  timestamp: new Date().toISOString(),
                }];
              });
            }
          } catch (e) {
            console.error('Error parsing chunk:', e);
          }
        }
        
        if (isComplete) break;
      }
    } catch (error) {
      if (retryCount < MAX_RETRIES) {
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * (retryCount + 1)));
        return handleStreamingResponse(response, messageId, retryCount + 1);
      }
      throw error;
    } finally {
      if (isComplete) {
        setMessages(prev => prev.map(m => 
          m.id === messageId 
            ? { ...m, isComplete: true }
            : m
        ));
      }
    }
  }, []);
  
  // Send a message and get a response
  const sendMessage = useCallback(async (content: string) => {
    if (!content.trim()) return;
    
    const userMessage: Message = {
      id: uuidv4(),
      role: 'user',
      content: content.trim(),
      timestamp: new Date().toISOString(),
    };
    
    setMessages(prev => [...prev, userMessage]);
    setIsProcessing(true);
    setError(null);
    
    const messageId = uuidv4();
    const assistantMessage: Message = {
      id: messageId,
      role: 'assistant',
      content: '',
      isStreaming: true,
      timestamp: new Date().toISOString(),
    };
    
    setMessages(prev => [...prev, assistantMessage]);
    
    try {
      abortControllerRef.current = new AbortController();
      
      const requestBody = {
        messages: [...messagesRef.current, userMessage].map(({ role, content }) => ({
          role,
          content,
        })),
        ...settings,
      };
      
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: abortControllerRef.current?.signal,
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          errorData.message || `HTTP error! status: ${response.status}`
        );
      }
      
      if (settings.streamingEnabled && response.body) {
        await handleStreamingResponse(response, messageId);
      } else {
        const data = await response.json();
        setMessages(prev => prev.map(msg => 
          msg.id === messageId
            ? { 
                ...msg, 
                content: data.choices?.[0]?.message?.content || 'No response',
                isStreaming: false,
                isComplete: true 
              }
            : msg
        ));
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to send message';
      setError(errorMessage);
      
      // Update the assistant message with the error
      setMessages(prev => prev.map(msg => 
        msg.id === messageId
          ? { 
              ...msg, 
              content: `Error: ${errorMessage}`,
              isError: true,
              isStreaming: false 
            }
          : msg
      ));
    } finally {
      setIsProcessing(false);
      abortControllerRef.current = null;
    }
  }, [settings, handleStreamingResponse]);
  
  // Clear all messages and reset the conversation
  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
  }, []);
  
  // Update conversation settings
  const updateSettings = useCallback((updates: Partial<ConversationSettings>) => {
    setSettings(prev => ({
      ...prev,
      ...updates,
      temperature: Math.max(0, Math.min(1, updates.temperature ?? prev.temperature)),
      maxTokens: Math.max(100, Math.min(4000, updates.maxTokens ?? prev.maxTokens)),
    }));
  }, []);
  
  // Clean up any pending requests when the component unmounts
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);
  
  // Calculate isStreaming based on current state
  const isStreaming = isProcessing && messages.some(msg => msg.isStreaming);

  // Return the public API
  return {
    messages,
    isProcessing,
    error,
    settings,
    sendMessage,
    clearMessages,
    updateSettings,
    messageCount: messages.length,
    isStreaming,
  };
}
