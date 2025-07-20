"use client"

import { useState } from "react" // Added a comment to trigger re-evaluation
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import type { ChatHistory } from "@/types"
import { X, Download, Copy, Trash2, Search, MessageSquare, Calendar } from "lucide-react"

interface ChatHistoryModalProps {
  onClose: () => void
  onLoadChat: (chatId: string) => void
  onDeleteChat: (chatId: string) => void
  onDownloadAll: () => void
  chats: ChatHistory[]
}

export default function ChatHistoryModal({
  onClose,
  onLoadChat,
  onDeleteChat,
  onDownloadAll,
  chats,
}: ChatHistoryModalProps) {
  const [searchTerm, setSearchTerm] = useState("")

  const filteredChats = chats.filter(
    (chat) =>
      chat.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      chat.messages.some((msg) => msg.content.toLowerCase().includes(searchTerm.toLowerCase())),
  )

  const handleCopyChat = (chat: ChatHistory) => {
    const chatText = chat.messages.map((msg) => `${msg.role === "user" ? "You" : "AI"}: ${msg.content}`).join("\n\n")

    navigator.clipboard.writeText(chatText)
  }

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  }

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-black/90 border border-white/20 rounded-lg w-full max-w-2xl max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-white/10">
          <div className="flex items-center gap-3">
            <MessageSquare className="h-5 w-5 text-purple-400" />
            <h2 className="text-xl font-bold">Chat History</h2>
            <span className="text-sm text-white/60">({chats.length} chats)</span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onDownloadAll}>
              <Download className="h-4 w-4 mr-2" />
              Download All
            </Button>
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Search */}
        <div className="p-4 border-b border-white/10">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-white/40" />
            <Input
              placeholder="Search chats..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 bg-black/40 border-white/20"
            />
          </div>
        </div>

        {/* Chat List */}
        <ScrollArea className="flex-1 p-4">
          {filteredChats.length === 0 ? (
            <div className="text-center py-8 text-white/60">
              {searchTerm ? "No chats found matching your search." : "No chat history yet."}
            </div>
          ) : (
            <div className="space-y-3">
              {filteredChats.map((chat) => (
                <div
                  key={chat.id}
                  className="bg-black/40 rounded-lg p-4 border border-white/10 hover:border-white/20 transition-all duration-200 group"
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-medium text-white truncate">{chat.title}</h3>
                      <div className="flex items-center gap-2 mt-1">
                        <Calendar className="h-3 w-3 text-white/40" />
                        <span className="text-xs text-white/60">{formatDate(chat.timestamp)}</span>
                        <span className="text-xs text-white/40">•</span>
                        <span className="text-xs text-white/60">{chat.messages.length} messages</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => handleCopyChat(chat)}
                        title="Copy chat"
                      >
                        <Copy className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-red-400 hover:text-red-300"
                        onClick={() => onDeleteChat(chat.id)}
                        title="Delete chat"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>

                  {/* Preview */}
                  <div className="text-sm text-white/70 mb-3 line-clamp-2">
                    {chat.messages[0]?.content || "Empty chat"}
                  </div>

                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => onLoadChat(chat.id)}
                    className="w-full bg-purple-500/20 hover:bg-purple-500/30 text-purple-300"
                  >
                    Load Chat
                  </Button>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </div>
    </div>
  )
}
