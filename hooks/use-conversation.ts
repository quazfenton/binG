"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type { Message, ConversationContext, ConversationMood } from "@/types";

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
    provider: "openai",
    model: "gpt-4",
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
  const handleStreamingResponse = useCallback(async (response: Response) => {
    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let fullContent = "";

    setIsStreaming(true);
    setStreamingContent("");

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6);

            if (data === "[DONE]") {
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
                setStreamingContent(fullContent);
              }

              if (parsed.isComplete) {
                setIsStreaming(false);
                return fullContent;
              }
            } catch (parseError) {
              console.warn("Failed to parse streaming data:", parseError);
            }
          }
        }
      }
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

        let aiContent = "";

        if (
          settings.streamingEnabled &&
          response.headers.get("content-type")?.includes("text/event-stream")
        ) {
          aiContent = await handleStreamingResponse(response);
        } else {
          const data = await response.json();
          if (!data.success) {
            throw new Error(data.error || "Failed to generate response");
          }
          aiContent = data.data.content;
        }

        // Add AI response to messages
        const aiMessage: Message = {
          role: "assistant",
          content: aiContent,
        };

        setMessages((prev) => [...prev, aiMessage]);
        updateConversationMood(
          messages[messages.length - 1].content,
          aiContent,
        );

        // Text-to-speech if enabled
        if (settings.voiceEnabled && "speechSynthesis" in window) {
          const utterance = new SpeechSynthesisUtterance(aiContent);
          utterance.rate = 0.9;
          utterance.pitch = 1;
          utterance.volume = 0.8;
          speechSynthesis.speak(utterance);
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
          role: "assistant",
          content: `I encountered an error: ${error.message}. Please try again or check your API configuration.`,
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
    async (message: Message, shouldRespond = true) => {
      setMessages((prev) => [...prev, message]);

      // If it's a user message and we should respond, generate AI response
      if (message.role === "user" && shouldRespond) {
        const allMessages = [...messages, message];
        await generateResponse(allMessages);
      }
    },
    [messages, generateResponse],
  );

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

  // Get current streaming content for display
  const getCurrentStreamingMessage = useCallback((): Message | null => {
    if (isStreaming && streamingContent) {
      return {
        role: "assistant",
        content: streamingContent,
      };
    }
    return null;
  }, [isStreaming, streamingContent]);

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
    getCurrentStreamingMessage,

    // Computed properties
    hasMessages: messages.length > 0,
    lastMessage: messages[messages.length - 1] || null,
    messageCount: messages.length,

    // Provider management
    availableProviders: [], // Will be populated by the component
  };
}
