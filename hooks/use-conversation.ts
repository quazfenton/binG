"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type { Message, ConversationContext, ConversationMood } from "@/types";
import { v4 as uuidv4 } from 'uuid';

export interface ConversationSettings {
  provider: string;
  model: string;
  temperature: number;
  maxTokens: number;
  streamingEnabled: boolean;
  voiceEnabled: boolean;
}

export function useConversation() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [streamingContent, setStreamingContent] = useState<string>("");
  const [isStreaming, setIsStreaming] = useState(false);

  const [settings, setSettings] = useState<ConversationSettings>({
    provider: "openrouter",
    model: "deepseek/deepseek-r1-0528:free",
    temperature: 0.7,
    maxTokens: 2000,
    streamingEnabled: true,
    voiceEnabled: false,
  });

  const [thoughtProcess, setThoughtProcess] = useState<string[]>([]);
  const [conversationContext, setConversationContext] =
    useState<ConversationContext>({
      creativity: 0.7,
      depth: 0.5,
      mood: "Neutral",
      topics: [],
    });

  const [conversationMood, setConversationMood] = useState<ConversationMood>({
    color: "#6366f1",
    energy: 1,
    tempo: 1,
  });

  const abortControllerRef = useRef<AbortController | null>(null);

  // Load settings from localStorage on mount
  useEffect(() => {
    const savedSettings = localStorage.getItem("conversation-settings");
    if (savedSettings) {
      try {
        const parsed = JSON.parse(savedSettings);
        setSettings((prev) => ({ ...prev, ...parsed }));
      } catch (error) {
        console.warn("Failed to load conversation settings:", error);
      }
    }
  }, []);

  // Save settings to localStorage when they change
  useEffect(() => {
    localStorage.setItem("conversation-settings", JSON.stringify(settings));
  }, [settings]);

  // Clear all messages
  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
    setStreamingContent("");
    setIsStreaming(false);
    setConversationContext({
      creativity: 0.7,
      depth: 0.5,
      mood: "Neutral",
      topics: [],
    });
    setConversationMood({
      color: "#6366f1",
      energy: 1,
      tempo: 1,
    });
    setThoughtProcess([]);
  }, []);

  // Update conversation settings
  const updateSettings = useCallback(
    (newSettings: Partial<ConversationSettings>) => {
      setSettings((prev) => ({ ...prev, ...newSettings }));
    },
    [],
  );

  // Stop current generation
  const stopGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsProcessing(false);
    setIsStreaming(false);
    setStreamingContent("");
  }, []);

  // Handle streaming response
  const handleStreamingResponse = useCallback(async (response: Response, messageId: string) => {
    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let fullContent = "";
    let buffer = '';

    setIsStreaming(true);

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() || '';

        for (const event of events) {
          if (event.startsWith('data: ')) {
            const data = event.slice(6).trim();
            
            if (data === '[DONE]') {
              setIsStreaming(false);
              return fullContent;
            }

            try {
              const parsed = JSON.parse(data);

              if (parsed.error) {
                throw new Error(parsed.error);
              }

              if (parsed.content) {
                fullContent += parsed.content;
                setMessages(prev => prev.map(msg =>
                  msg.id === messageId ? { ...msg, content: fullContent } : msg
                ));
              }

              if (parsed.isComplete) {
                setIsStreaming(false);
                return fullContent;
              }
            } catch (parseError) {
              console.warn('Failed to parse streaming data:', parseError, data);
            }
          }
        }
      }

      // Process any remaining buffer
      if (buffer.startsWith('data: ')) {
        const data = buffer.slice(6).trim();
        if (data === '[DONE]') {
          setIsStreaming(false);
          return fullContent;
        }
        try {
          const parsed = JSON.parse(data);
          if (parsed.content) {
            fullContent += parsed.content;
            setMessages(prev => prev.map(msg =>
              msg.id === messageId ? { ...msg, content: fullContent } : msg
            ));
          }
        } catch (parseError) {
          console.warn('Failed to parse final chunk:', parseError, data);
        }
      }
    } catch (error: any) {
      console.error('Streaming error:', error);
      const errorData = JSON.stringify({
        error: error instanceof Error ? error.message : 'Streaming error occurred',
        isComplete: true
      });
      setMessages(prev => prev.map(msg =>
        msg.id === messageId ? { ...msg, content: `I encountered an error: ${error.message || 'Unknown error'}. Please try again.` } : msg
      ));
    } finally {
      reader.releaseLock();
      setIsStreaming(false);
    }

    return fullContent;
  }, []);

  // Generate AI response
  const generateResponse = useCallback(
    async (messages: Message[]) => {
      abortControllerRef.current = new AbortController();
      setError(null);
      setIsProcessing(true);

      // Show thinking process
      const thoughts = [
        "Connecting to AI provider...",
        "Analyzing your message...",
        "Generating thoughtful response...",
        "Optimizing for clarity...",
        "Finalizing response...",
      ];

      // Display thinking process with delays
      for (let i = 0; i < thoughts.length; i++) {
        if (abortControllerRef.current?.signal.aborted) return;

        setThoughtProcess((prev) => [...prev.slice(-3), thoughts[i]]);
        await new Promise((resolve) => setTimeout(resolve, 400));
      }

      try {
        const requestBody = {
          messages: messages.map((msg) => ({
            role: msg.role,
            content: msg.content,
          })),
          provider: settings.provider,
          model: settings.model,
          temperature: settings.temperature,
          maxTokens: settings.maxTokens,
          stream: settings.streamingEnabled,
        };

        const response = await fetch("/api/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(requestBody),
          signal: abortControllerRef.current.signal,
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || `HTTP ${response.status}`);
        }

        if (
          settings.streamingEnabled &&
          response.headers.get("content-type")?.includes("text/event-stream")
        ) {
          const messageId = uuidv4();
          const initialMessage: Message = {
            id: messageId,
            role: "assistant",
            content: "",
          };
          setMessages((prev) => [...prev, initialMessage]);
          await handleStreamingResponse(response, messageId);
        } else {
          const data = await response.json();
          if (!data.success) {
            throw new Error(data.error || "Failed to generate response");
          }
          const aiMessage: Message = {
            id: uuidv4(),
            role: "assistant",
            content: data.data.content,
          };
          setMessages((prev) => [...prev, aiMessage]);
        }
        // This is now handled in the streaming response
        // updateConversationMood(
        //   messages[messages.length - 1].content,
        //   aiContent,
        // );

        if (settings.voiceEnabled && "speechSynthesis" in window) {
          const lastMessage = messages[messages.length - 1];
          if (lastMessage && lastMessage.role === 'assistant') {
            const utterance = new SpeechSynthesisUtterance(lastMessage.content);
            utterance.rate = 0.9;
            utterance.pitch = 1;
            utterance.volume = 0.8;
            speechSynthesis.speak(utterance);
          }
        }
      } catch (error: any) {
        if (error.name === "AbortError") {
          console.log("Request aborted");
          return;
        }

        console.error("Error generating response:", error);
        setError(error.message || "Failed to generate response");

        // Add error message
        const errorMessage: Message = {
          id: uuidv4(),
          role: "assistant",
          content: `I encountered an error: ${error.message}. Please try again or check your API configuration.`,
          isError: true,
        };
        setMessages((prev) => [...prev, errorMessage]);
      } finally {
        setIsProcessing(false);
        setStreamingContent("");
        setThoughtProcess([]);
        abortControllerRef.current = null;
      }
    },
    [settings, handleStreamingResponse],
  );

  // Add a new message to the conversation
  const addMessage = useCallback(
    async (message: Partial<Message>, shouldRespond = true) => {
      const newMessage = { ...message, id: message.id || uuidv4() } as Message;
      setMessages((prev) => [...prev, newMessage]);

      // If it's a user message and we should respond, generate AI response
      if (newMessage.role === "user" && shouldRespond) {
        const allMessages = [...messages, newMessage];
        await generateResponse(allMessages);
      }
    },
    [messages, generateResponse],
  );

  const retryRequest = useCallback(async (messageId: string) => {
    const errorIndex = messages.findIndex(msg => msg.id === messageId && msg.isError);
    if (errorIndex === -1) return;

    const userMessageIndex = errorIndex -1;
    if (userMessageIndex < 0 || messages[userMessageIndex].role !== 'user') return;

    const messagesToRetry = messages.slice(0, userMessageIndex + 1);
    setMessages(messagesToRetry);
    await generateResponse(messagesToRetry);

  }, [messages, generateResponse]);

  // Update conversation mood based on content analysis
  const updateConversationMood = useCallback(
    (userMessage: string, aiResponse: string) => {
      // Simple sentiment analysis
      const positiveWords = [
        "good",
        "great",
        "happy",
        "excellent",
        "wonderful",
        "amazing",
        "love",
        "like",
        "fantastic",
      ];
      const negativeWords = [
        "bad",
        "sad",
        "terrible",
        "awful",
        "hate",
        "dislike",
        "problem",
        "issue",
        "error",
      ];
      const complexWords = [
        "complex",
        "difficult",
        "analyze",
        "explain",
        "understand",
        "why",
        "how",
        "what",
      ];

      const userLower = userMessage.toLowerCase();
      const isPositive = positiveWords.some((word) => userLower.includes(word));
      const isNegative = negativeWords.some((word) => userLower.includes(word));
      const isComplex =
        complexWords.some((word) => userLower.includes(word)) ||
        userMessage.length > 100;

      // Update mood color
      let newColor = "#6366f1"; // Default purple
      if (isPositive) newColor = "#10b981"; // Green
      if (isNegative) newColor = "#ef4444"; // Red
      if (isComplex) newColor = "#f59e0b"; // Amber

      // Update energy and tempo based on message characteristics
      const newEnergy = isComplex
        ? 0.5
        : isPositive
          ? 1.5
          : isNegative
            ? 0.3
            : 1;
      const newTempo = isNegative ? 0.7 : isPositive ? 1.3 : 1;

      setConversationMood({
        color: newColor,
        energy: newEnergy,
        tempo: newTempo,
      });

      // Update conversation context
      setConversationContext((prev) => ({
        ...prev,
        mood: isPositive ? "Positive" : isNegative ? "Negative" : "Neutral",
        creativity: isComplex
          ? Math.min(prev.creativity + 0.1, 1)
          : prev.creativity,
        depth:
          userMessage.length > 200 ? Math.min(prev.depth + 0.1, 1) : prev.depth,
        topics: [...new Set([...prev.topics, ...extractTopics(userMessage)])],
      }));
    },
    [],
  );

  // Extract potential topics from user message
  const extractTopics = useCallback((message: string): string[] => {
    const words = message.toLowerCase().split(/\W+/);
    const commonWords = new Set([
      "the",
      "and",
      "is",
      "in",
      "to",
      "of",
      "a",
      "that",
      "it",
      "with",
      "for",
      "as",
      "was",
      "on",
      "are",
      "you",
      "can",
      "have",
      "this",
      "be",
      "an",
      "or",
      "will",
      "my",
      "one",
      "all",
      "would",
      "there",
      "their",
    ]);

    return words
      .filter((word) => word.length > 3 && !commonWords.has(word))
      .slice(0, 5);
  }, []);

  const getCurrentStreamingMessage = useCallback((): Message | null => {
    return null;
  }, []);

  return {
    messages,
    addMessage,
    clearMessages,
    isProcessing,
    isStreaming,
    error,
    thoughtProcess,
    conversationContext,
    conversationMood,
    settings,
    updateSettings,
    stopGeneration,
    retryRequest,
    getCurrentStreamingMessage: () => null,

    // Computed properties
    hasMessages: messages.length > 0,
    lastMessage: messages[messages.length - 1] || null,
    messageCount: messages.length,

    // Provider management
    availableProviders: [], // Will be populated by the component
  };
}
