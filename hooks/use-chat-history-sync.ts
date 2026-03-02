"use client"

import { useCallback, useEffect, useState } from "react"
import type { Message, ChatHistory } from "@/types"
import { v4 as uuidv4 } from 'uuid';
import { useAuth } from "@/contexts/auth-context";

const STORAGE_KEY = "ayooo_chat_chat_history"
const SYNC_DEBOUNCE_MS = 2000 // Sync to server after 2 seconds of inactivity

// Check if server-side chat storage is enabled (set at build time)
const SERVER_CHAT_STORAGE_ENABLED = process.env.NEXT_PUBLIC_ENABLE_SERVER_CHAT_STORAGE === 'true';

/**
 * Enhanced chat history hook that supports both localStorage and server-side storage
 * 
 * Behavior:
 * - ALWAYS saves to localStorage (primary storage)
 * - When ENABLE_SERVER_CHAT_STORAGE=true AND user is authenticated:
 *   - Also syncs to server database
 *   - Loads from server on initial mount
 * - When disabled or not authenticated:
 *   - Works purely with localStorage (current behavior)
 */
export function useChatHistorySync() {
  const { isAuthenticated } = useAuth();
  const [isServerSyncEnabled, setIsServerSyncEnabled] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [pendingSync, setPendingSync] = useState(false);

  // Check if server sync should be active
  useEffect(() => {
    setIsServerSyncEnabled(SERVER_CHAT_STORAGE_ENABLED && isAuthenticated);
  }, [isAuthenticated]);

  // Load chats from localStorage
  const getAllChats = useCallback((): ChatHistory[] => {
    const stored = localStorage.getItem(STORAGE_KEY);
    const isStoredEmpty = !stored;
    if (isStoredEmpty) return [];

    try {
      const chats: ChatHistory[] = JSON.parse(stored);
      
      // Ensure all messages have IDs for backward compatibility
      return chats.map((chat: ChatHistory) => ({
        ...chat,
        messages: chat.messages.map((message: Message) => ({
          ...message,
          id: message.id || uuidv4()
        }))
      }));
    } catch (error) {
      console.error("[useChatHistorySync] Error parsing chat history, clearing invalid data:", error);
      localStorage.removeItem(STORAGE_KEY);
      return [];
    }
  }, []);

  // Sync to server
  const syncToServer = useCallback(async (chat: ChatHistory) => {
    if (!isServerSyncEnabled) return;

    try {
      const response = await fetch('/api/chat/history', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include', // Include session cookie
        body: JSON.stringify({
          id: chat.id,
          title: chat.title,
          messages: chat.messages,
        }),
      });

      if (response.ok) {
        setLastSyncedAt(new Date());
        console.log("[useChatHistorySync] Synced chat to server:", chat.id);
      } else if (response.status === 403) {
        // Server storage disabled, that's fine
        console.log("[useChatHistorySync] Server storage disabled, using localStorage only");
      } else {
        console.error("[useChatHistorySync] Failed to sync to server:", await response.text());
      }
    } catch (error) {
      console.error("[useChatHistorySync] Error syncing to server:", error);
    }
  }, [isServerSyncEnabled]);

  // Load from server on initial mount (only when server sync is enabled)
  useEffect(() => {
    if (!isServerSyncEnabled) return;

    const loadFromServer = async () => {
      try {
        const response = await fetch('/api/chat/history', {
          credentials: 'include',
        });

        if (response.ok) {
          const data = await response.json();
          
          if (data.chats && data.chats.length > 0) {
            // Merge server chats with localStorage (server takes precedence)
            const localChats = getAllChats();
            const serverChatIds = new Set(data.chats.map((c: ChatHistory) => c.id));
            
            // Keep local chats that aren't on server
            const localOnlyChats = localChats.filter(chat => !serverChatIds.has(chat.id));
            
            // Merge: server chats + local-only chats
            const mergedChats = [...data.chats, ...localOnlyChats]
              .sort((a, b) => b.timestamp - a.timestamp)
              .slice(0, 50);
            
            localStorage.setItem(STORAGE_KEY, JSON.stringify(mergedChats));
            console.log("[useChatHistorySync] Loaded and merged chats from server");
          }
        }
      } catch (error) {
        console.error("[useChatHistorySync] Error loading from server:", error);
      }
    };

    loadFromServer();
  }, [isServerSyncEnabled, getAllChats]);

  // Debounced sync helper
  const debouncedSync = useCallback((chat: ChatHistory) => {
    if (!isServerSyncEnabled) return;

    setPendingSync(true);
    
    // Clear any existing timeout
    const existingTimeout = (window as any).__chatSyncTimeout;
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    // Set new timeout
    (window as any).__chatSyncTimeout = setTimeout(() => {
      syncToServer(chat);
      setPendingSync(false);
    }, SYNC_DEBOUNCE_MS);
  }, [isServerSyncEnabled, syncToServer]);

  const saveCurrentChat = useCallback((messages: Message[], chatIdToUpdate?: string): string => {
    const isEmpty = messages.length === 0;
    if (isEmpty) return chatIdToUpdate || "";

    const existingChats = getAllChats();

    let updatedChats: ChatHistory[];
    let finalChatId: string;
    let savedChat: ChatHistory;

    if (chatIdToUpdate) {
      const chatIndex = existingChats.findIndex((chat: ChatHistory) => chat.id === chatIdToUpdate);

      if (chatIndex !== -1) {
        savedChat = {
          id: chatIdToUpdate,
          title: messages[0]?.content ? messages[0].content.slice(0, 50) + (messages[0].content.length > 50 ? "..." : "") : "Untitled Chat",
          messages,
          timestamp: Date.now(),
        };

        updatedChats = [...existingChats];
        updatedChats[chatIndex] = savedChat;
        updatedChats = [savedChat, ...updatedChats.filter((chat: ChatHistory) => chat.id !== chatIdToUpdate)];
        finalChatId = chatIdToUpdate;
      } else {
        console.warn(`[useChatHistorySync] Chat with ID ${chatIdToUpdate} not found for update. Saving as new.`);
        const newChatId = uuidv4();
        savedChat = {
          id: newChatId,
          title: messages[0]?.content ? messages[0].content.slice(0, 50) + (messages[0].content.length > 50 ? "..." : "") : "Untitled Chat",
          messages,
          timestamp: Date.now(),
        };
        updatedChats = [savedChat, ...existingChats];
        finalChatId = newChatId;
      }
    } else {
      const isDuplicate = existingChats.some((chat: ChatHistory) =>
        chat.messages.length === messages.length &&
        chat.messages.every((existingMsg: Message, index: number) =>
          existingMsg.content === messages[index].content &&
          existingMsg.role === messages[index].role
        )
      );

      if (isDuplicate) {
        console.log("[useChatHistorySync] Duplicate chat content detected. Not saving.");
        return existingChats[0]?.id || "";
      }

      const newChatId = uuidv4();
      savedChat = {
        id: newChatId,
        title: messages[0]?.content ? messages[0].content.slice(0, 50) + (messages[0].content.length > 50 ? "..." : "") : "Untitled Chat",
        messages,
        timestamp: Date.now(),
      };
      updatedChats = [savedChat, ...existingChats];
      finalChatId = newChatId;
    }

    // Always save to localStorage
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedChats.slice(0, 50)));
    
    // Sync to server if enabled (debounced)
    debouncedSync(savedChat);
    
    return finalChatId;
  }, [getAllChats, debouncedSync]);

  const loadChat = useCallback(
    (chatId: string): ChatHistory | null => {
      const chats = getAllChats()
      return chats.find((chat: ChatHistory) => chat.id === chatId) || null
    },
    [getAllChats]
  );

  const deleteChat = useCallback(
    async (chatId: string) => {
      // Delete from localStorage
      const chats = getAllChats()
      const updatedChats = chats.filter((chat: ChatHistory) => chat.id !== chatId)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedChats));

      // Delete from server if enabled
      if (isServerSyncEnabled) {
        try {
          const response = await fetch(`/api/chat/history?id=${chatId}`, {
            method: 'DELETE',
            credentials: 'include',
          });

          if (!response.ok && response.status !== 403) {
            console.error("[useChatHistorySync] Failed to delete from server:", await response.text());
          }
        } catch (error) {
          console.error("[useChatHistorySync] Error deleting from server:", error);
        }
      }
    },
    [getAllChats, isServerSyncEnabled]
  );

  const downloadAllHistory = useCallback(() => {
    const chats = getAllChats()
    const allText = chats
      .map((chat: ChatHistory) => {
        const chatText = chat.messages
          .map((msg: Message) => `${msg.role === "user" ? "You" : "AI"}: ${msg.content}`)
          .join("\n\n")
        return `=== ${chat.title} (${new Date(chat.timestamp).toLocaleString()}) ===\n\n${chatText}`
      })
      .join("\n\n" + "=".repeat(50) + "\n\n")

    const blob = new Blob([allText], { type: "text/plain" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `ayooo_chat_chat_history_${new Date().toISOString().split("T")[0]}.txt`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [getAllChats]);

  return {
    saveCurrentChat,
    getAllChats,
    loadChat,
    deleteChat,
    downloadAllHistory,
    isServerSyncEnabled,
    lastSyncedAt,
    pendingSync,
  }
}