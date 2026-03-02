"use client"

import React, { useCallback } from "react"
import type { Message, ChatHistory } from "@/types"
import { v4 as uuidv4 } from 'uuid';

const STORAGE_KEY = "ayooo_chat_chat_history"

export function useChatHistory() {
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
      console.error("[useChatHistory] Error parsing chat history, clearing invalid data:", error);
      localStorage.removeItem(STORAGE_KEY);
      return [];
    }
  }, []);

  const saveCurrentChat = useCallback((messages: Message[], chatIdToUpdate?: string): string => {
    const isEmpty = messages.length === 0;
    if (isEmpty) return chatIdToUpdate || ""; // Return existing ID or empty if no messages

    const existingChats = getAllChats();

    let updatedChats: ChatHistory[];
    let finalChatId: string;

    if (chatIdToUpdate) {
      // Try to find and update the existing chat
      const chatIndex = existingChats.findIndex((chat: ChatHistory) => chat.id === chatIdToUpdate);

      if (chatIndex !== -1) {
        // Chat found, update it
        const updatedChat: ChatHistory = {
          id: chatIdToUpdate, // Keep the original ID
          title: messages[0]?.content ? messages[0].content.slice(0, 50) + (messages[0].content.length > 50 ? "..." : "") : "Untitled Chat",
          messages,
          timestamp: Date.now(), // Update timestamp
        };

        // Replace the old chat with the updated one
        updatedChats = [...existingChats];
        updatedChats[chatIndex] = updatedChat;

        // Reorder to keep the most recently updated chat at the top
        // Filter out the old version and add the new one at the beginning
        updatedChats = [updatedChat, ...updatedChats.filter((chat: ChatHistory) => chat.id !== chatIdToUpdate)];
        finalChatId = chatIdToUpdate;

      } else {
        // Chat not found, save as a new chat
        console.warn(`[useChatHistory] Chat with ID ${chatIdToUpdate} not found for update. Saving as new.`);
        const newChatId = uuidv4(); // Use uuid for new chats
        const chatHistory: ChatHistory = {
          id: newChatId,
          title: messages[0]?.content ? messages[0].content.slice(0, 50) + (messages[0].content.length > 50 ? "..." : "") : "Untitled Chat",
          messages,
          timestamp: Date.now(),
        };
        updatedChats = [chatHistory, ...existingChats];
        finalChatId = newChatId;
      }
    } else {
      // Save as a new chat
      // Check for exact duplicates based on messages content to prevent duplication
      const isDuplicate = existingChats.some((chat: ChatHistory) =>
        chat.messages.length === messages.length &&
        chat.messages.every((existingMsg: Message, index: number) =>
          existingMsg.content === messages[index].content &&
          existingMsg.role === messages[index].role
        )
      );

      if (isDuplicate) {
        console.log("[useChatHistory] Duplicate chat content detected. Not saving.");
        return existingChats[0]?.id || ""; // Return the ID of the existing duplicate, or empty
      }

      const newChatId = uuidv4(); // Use uuid for new chats
      const chatHistory: ChatHistory = {
        id: newChatId,
        title: messages[0]?.content ? messages[0].content.slice(0, 50) + (messages[0].content.length > 50 ? "..." : "") : "Untitled Chat",
        messages,
        timestamp: Date.now(),
      };
      updatedChats = [chatHistory, ...existingChats];
      finalChatId = newChatId;
    }

    // Limit to 50 chats and save
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedChats.slice(0, 50)));
    return finalChatId;
  }, [getAllChats]);

  const loadChat = useCallback(
    (chatId: string): ChatHistory | null => {
      const chats = getAllChats()
      return chats.find((chat: ChatHistory) => chat.id === chatId) || null
    },
    [getAllChats],
  )

  const deleteChat = useCallback(
    (chatId: string) => {
      const chats = getAllChats()
      const updatedChats = chats.filter((chat: ChatHistory) => chat.id !== chatId)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedChats))
    },
    [getAllChats],
  )

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
  }, [getAllChats])

  return {
    saveCurrentChat,
    getAllChats,
    loadChat,
    deleteChat,
    downloadAllHistory,
  }
}
