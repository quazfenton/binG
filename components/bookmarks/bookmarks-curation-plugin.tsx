/**
 * Bookmarks Curation Plugin
 * 
 * Features:
 * - Visual grid of bookmarked links with previews
 * - Click to open in new tab
 * - Thumbnail/preview images
 * - Title and metadata display
 * - Multiple input formats (text, JSON, file upload)
 * - Third-party integrations (Google Docs, bookmark exports)
 * - Automatic deduplication
 * - Sequential ordering (newest at bottom)
 */

"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { parseLinks, parseLinksFromFile, type ParsedLink } from "@/lib/bookmarks/link-parser";

import {
   Link,
   Upload,
   FileText,
   FileCode,
   ExternalLink,
   Trash2,
   RefreshCw,
   Search,
   Filter,
   Grid3X3,
   List,
   Plus,
   X,
   Image as ImageIcon,
   Globe,
   FolderArchive,
   FolderOpen,
   Bookmark,
   CheckCircle,
   AlertCircle,
   Loader2,
} from "lucide-react";

// ============================================================================
// Types
// ============================================================================

interface Bookmark extends ParsedLink {
  id: string;
  siteName?: string;
  tags?: string[];
  updatedAt?: number;
}

interface ThirdPartyIntegration {
  id: string;
  name: string;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
  onImport: () => Promise<string[] | ParsedLink[]>;
}

// ============================================================================
// Main Component
// ============================================================================

export function BookmarksCurationPlugin() {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [loading, setLoading] = useState(true);
  const [inputText, setInputText] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState("paste");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load bookmarks on mount
  useEffect(() => {
    loadBookmarks();
  }, []);

  const loadBookmarks = async () => {
    try {
      setLoading(true);
      const response = await fetch("/api/bookmarks?order=oldest-first");
      const data = await response.json();
      
      if (data.success) {
        setBookmarks(data.bookmarks);
      }
    } catch (error: any) {
      console.error("Failed to load bookmarks:", error);
      toast.error("Failed to load bookmarks");
    } finally {
      setLoading(false);
    }
  };

  const handleAddLinks = async () => {
    if (!inputText.trim()) {
      toast.error("Please enter some links");
      return;
    }

    try {
      setIsProcessing(true);
      
      // Parse links from input
      const parsedLinks = await parseLinks(inputText, {
        deduplicate: true,
        extractMetadata: true,
        existingLinks: bookmarks.map(b => b.url),
      });

      if (parsedLinks.length === 0) {
        toast.error("No valid links found");
        return;
      }

      // Add to API
      const response = await fetch("/api/bookmarks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookmarks: parsedLinks }),
      });

      const data = await response.json();
      
      if (data.success) {
        toast.success(`Added ${data.added} bookmark${data.added > 1 ? 's' : ''}`);
        setInputText("");
        await loadBookmarks();
      } else {
        toast.error(data.error || "Failed to add bookmarks");
      }
    } catch (error: any) {
      console.error("Failed to add links:", error);
      toast.error("Failed to add links");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      setIsProcessing(true);
      
      const parsedLinks = await parseLinksFromFile(file, {
        deduplicate: true,
        extractMetadata: true,
        existingLinks: bookmarks.map(b => b.url),
      });

      if (parsedLinks.length === 0) {
        toast.error("No valid links found in file");
        return;
      }

      const response = await fetch("/api/bookmarks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookmarks: parsedLinks }),
      });

      const data = await response.json();
      
      if (data.success) {
        toast.success(`Imported ${data.added} bookmark${data.added > 1 ? 's' : ''} from ${file.name}`);
        await loadBookmarks();
      }
    } catch (error: any) {
      console.error("Failed to import file:", error);
      toast.error("Failed to import file");
    } finally {
      setIsProcessing(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleDeleteBookmark = async (id: string) => {
    try {
      const response = await fetch(`/api/bookmarks?id=${id}`, {
        method: "DELETE",
      });

      const data = await response.json();
      
      if (data.success) {
        toast.success("Bookmark deleted");
        await loadBookmarks();
      }
    } catch (error: any) {
      console.error("Failed to delete bookmark:", error);
      toast.error("Failed to delete bookmark");
    }
  };

  const handleRefreshMetadata = async (bookmark: Bookmark) => {
    try {
      const response = await fetch("/api/bookmarks/metadata", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: bookmark.url }),
      });

      const metadata = await response.json();

      const updatedBookmarks = bookmarks.map(b =>
        b.id === bookmark.id
          ? { ...b, ...metadata, updatedAt: Date.now() }
          : b
      );

      setBookmarks(updatedBookmarks);
      
      // Save to API
      await fetch("/api/bookmarks", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: bookmark.id,
          ...metadata,
        }),
      });

      toast.success("Metadata refreshed");
    } catch (error: any) {
      console.error("Failed to refresh metadata:", error);
      toast.error("Failed to refresh metadata");
    }
  };

  // Filter bookmarks
  const filteredBookmarks = bookmarks.filter(bookmark => {
    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      const matchesSearch =
        bookmark.title?.toLowerCase().includes(query) ||
        bookmark.description?.toLowerCase().includes(query) ||
        bookmark.url.toLowerCase().includes(query) ||
        bookmark.siteName?.toLowerCase().includes(query);

      if (!matchesSearch) return false;
    }

    // Tag filter
    if (selectedTags.length > 0) {
      const hasTag = selectedTags.some(tag =>
        bookmark.tags?.includes(tag)
      );
      if (!hasTag) return false;
    }

    return true;
  });

  // Get all unique tags
  const allTags = Array.from(
    new Set(bookmarks.flatMap(b => b.tags || []))
  );

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-white/10 bg-white/5">
        <div>
          <h2 className="text-lg font-semibold text-white">Bookmarks</h2>
          <p className="text-xs text-white/60">
            {filteredBookmarks.length} of {bookmarks.length} bookmarks
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setViewMode(viewMode === "grid" ? "list" : "grid")}
            className="text-white/70 hover:text-white"
          >
            {viewMode === "grid" ? (
              <List className="w-4 h-4" />
            ) : (
              <Grid3X3 className="w-4 h-4" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={loadBookmarks}
            className="text-white/70 hover:text-white"
          >
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Add Bookmarks Section */}
      <div className="p-4 border-b border-white/10">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="bg-white/10">
            <TabsTrigger value="paste" className="data-[state=active]:bg-purple-500">
              <FileText className="w-4 h-4 mr-2" />
              Paste Links
            </TabsTrigger>
            <TabsTrigger value="upload" className="data-[state=active]:bg-purple-500">
              <Upload className="w-4 h-4 mr-2" />
              Upload File
            </TabsTrigger>
            <TabsTrigger value="integrations" className="data-[state=active]:bg-purple-500">
              <Globe className="w-4 h-4 mr-2" />
              Integrations
            </TabsTrigger>
          </TabsList>

          <TabsContent value="paste" className="mt-4">
            <div className="space-y-3">
              <Label>Paste your links below</Label>
              <Textarea
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder="Paste links here...&#10;&#10;Supports:&#10;- One link per line&#10;- Comma-separated: https://example.com, https://example.org&#10;- Markdown: [Title](https://example.com)&#10;- Mixed formats"
                className="min-h-[200px] bg-white/5 border-white/20 text-white"
              />
              <Button
                onClick={handleAddLinks}
                disabled={isProcessing || !inputText.trim()}
                className="w-full bg-purple-500 hover:bg-purple-600"
              >
                {isProcessing ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Plus className="w-4 h-4 mr-2" />
                )}
                Add Links
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="upload" className="mt-4">
            <div className="space-y-3">
              <Label>Upload bookmark file</Label>
              <div
                className="border-2 border-dashed border-white/20 rounded-lg p-8 text-center hover:border-white/40 transition-colors cursor-pointer"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="w-12 h-12 mx-auto text-white/40 mb-3" />
                <p className="text-sm text-white/60 mb-1">
                  Click to upload or drag and drop
                </p>
                <p className="text-xs text-white/40">
                  Supports: .txt, .json, .html, .md
                </p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".txt,.json,.html,.md,.markdown"
                onChange={handleFileUpload}
                className="hidden"
              />
            </div>
          </TabsContent>

          <TabsContent value="integrations" className="mt-4">
            <div className="space-y-3">
              <Label>Import from third-party services</Label>
              <div className="grid grid-cols-1 gap-3">
                 <IntegrationCard
                   name="Google Docs"
                   icon={GoogleDrive}
                   description="Import links from Google Docs"
                   onImport={async () => {
                     toast.info("Google Docs integration coming soon");
                     return [];
                   }}
                 />
                <IntegrationCard
                  name="Browser Bookmarks"
                  icon={Bookmark}
                  description="Import from browser bookmark export"
                  onImport={async () => {
                    toast.info("Browser import coming soon");
                    return [];
                  }}
                />
                <IntegrationCard
                  name="Pocket"
                  icon={Globe}
                  description="Import from Pocket"
                  onImport={async () => {
                    toast.info("Pocket integration coming soon");
                    return [];
                  }}
                />
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* Search and Filter */}
      {(bookmarks.length > 0) && (
        <div className="p-4 border-b border-white/10 space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search bookmarks..."
              className="pl-10 bg-white/5 border-white/20"
            />
          </div>
          
          {allTags.length > 0 && (
            <div className="flex flex-wrap gap-2">
              <Badge
                variant={selectedTags.length === 0 ? "default" : "outline"}
                className="cursor-pointer"
                onClick={() => setSelectedTags([])}
              >
                All
              </Badge>
              {allTags.map(tag => (
                <Badge
                  key={tag}
                  variant={selectedTags.includes(tag) ? "default" : "outline"}
                  className="cursor-pointer"
                  onClick={() => setSelectedTags(prev =>
                    prev.includes(tag)
                      ? prev.filter(t => t !== tag)
                      : [...prev, tag]
                  )}
                >
                  {tag}
                </Badge>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Bookmarks Grid/List */}
      <ScrollArea className="flex-1">
        <div className="p-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-purple-400" />
            </div>
          ) : filteredBookmarks.length === 0 ? (
            <div className="text-center py-12 text-white/60">
              <Bookmark className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>{bookmarks.length === 0 ? "No bookmarks yet" : "No bookmarks match your filters"}</p>
              {bookmarks.length === 0 && (
                <p className="text-sm mt-1">Paste links above to get started</p>
              )}
            </div>
          ) : (
            <div className={cn(
              "gap-4",
              viewMode === "grid" ? "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3" : "flex flex-col"
            )}>
              <AnimatePresence>
                {filteredBookmarks.map((bookmark) => (
                  <BookmarkCard
                    key={bookmark.id}
                    bookmark={bookmark}
                    viewMode={viewMode}
                    onDelete={handleDeleteBookmark}
                    onRefreshMetadata={handleRefreshMetadata}
                  />
                ))}
              </AnimatePresence>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

// ============================================================================
// Bookmark Card Component
// ============================================================================

function BookmarkCard({
  bookmark,
  viewMode,
  onDelete,
  onRefreshMetadata,
}: {
  bookmark: Bookmark;
  viewMode: "grid" | "list";
  onDelete: (id: string) => void;
  onRefreshMetadata: (bookmark: Bookmark) => void;
}) {
  const [imageError, setImageError] = useState(false);

  const handleImageClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    window.open(bookmark.url, "_blank", "noopener,noreferrer");
  };

  if (viewMode === "list") {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
        className="bg-white/5 border border-white/10 rounded-lg p-4 hover:bg-white/10 transition-colors"
      >
        <div className="flex items-center gap-4">
          {/* Thumbnail */}
          <div
            className="w-24 h-16 rounded overflow-hidden bg-white/10 flex items-center justify-center cursor-pointer flex-shrink-0"
            onClick={handleImageClick}
          >
            {bookmark.imageUrl && !imageError ? (
              <img
                src={bookmark.imageUrl}
                alt={bookmark.title || "Bookmark"}
                className="w-full h-full object-cover"
                onError={() => setImageError(true)}
              />
            ) : (
              <Globe className="w-8 h-8 text-white/40" />
            )}
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-white truncate">
              {bookmark.title || "Untitled"}
            </h3>
            {bookmark.description && (
              <p className="text-xs text-white/60 line-clamp-2 mt-1">
                {bookmark.description}
              </p>
            )}
            <div className="flex items-center gap-2 mt-2">
              <Badge variant="outline" className="text-[10px]">
                {new URL(bookmark.url).hostname}
              </Badge>
              {bookmark.tags?.map(tag => (
                <Badge key={tag} variant="outline" className="text-[10px]">
                  {tag}
                </Badge>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onRefreshMetadata(bookmark)}
              className="h-8 w-8 text-white/60 hover:text-white"
              title="Refresh metadata"
            >
              <RefreshCw className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onDelete(bookmark.id)}
              className="h-8 w-8 text-red-400 hover:text-red-300"
              title="Delete"
            >
              <Trash2 className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => window.open(bookmark.url, "_blank", "noopener,noreferrer")}
              className="h-8 w-8 text-white/60 hover:text-white"
              title="Open link"
            >
              <ExternalLink className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </motion.div>
    );
  }

  // Grid mode
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      className="bg-white/5 border border-white/10 rounded-lg overflow-hidden hover:bg-white/10 transition-colors group"
    >
      {/* Thumbnail */}
      <div
        className="relative aspect-video bg-white/10 cursor-pointer overflow-hidden"
        onClick={handleImageClick}
      >
        {bookmark.imageUrl && !imageError ? (
          <img
            src={bookmark.imageUrl}
            alt={bookmark.title || "Bookmark"}
            className="w-full h-full object-cover transition-transform group-hover:scale-105"
            onError={() => setImageError(true)}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Globe className="w-12 h-12 text-white/40" />
          </div>
        )}
        
        {/* Overlay actions */}
        <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button
            variant="secondary"
            size="icon"
            className="h-7 w-7"
            onClick={(e) => {
              e.stopPropagation();
              onRefreshMetadata(bookmark);
            }}
          >
            <RefreshCw className="w-3 h-3" />
          </Button>
          <Button
            variant="destructive"
            size="icon"
            className="h-7 w-7"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(bookmark.id);
            }}
          >
            <Trash2 className="w-3 h-3" />
          </Button>
        </div>
      </div>

      {/* Content */}
      <CardContent className="p-3 space-y-2">
        <h3 className="text-sm font-semibold text-white line-clamp-2">
          {bookmark.title || "Untitled"}
        </h3>
        
        {bookmark.description && (
          <p className="text-xs text-white/60 line-clamp-2">
            {bookmark.description}
          </p>
        )}

        <div className="flex items-center justify-between">
          <Badge variant="outline" className="text-[10px]">
            {new URL(bookmark.url).hostname}
          </Badge>
          
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-white/60 hover:text-white"
            onClick={() => window.open(bookmark.url, "_blank", "noopener,noreferrer")}
          >
            <ExternalLink className="w-3 h-3" />
          </Button>
        </div>

        {bookmark.tags && bookmark.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {bookmark.tags.map(tag => (
              <Badge key={tag} variant="secondary" className="text-[10px]">
                {tag}
              </Badge>
            ))}
          </div>
        )}
      </CardContent>
    </motion.div>
  );
}

// ============================================================================
// Integration Card Component
// ============================================================================

function IntegrationCard({
  name,
  icon: Icon,
  description,
  onImport,
}: {
  name: string;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
  onImport: () => Promise<any[]>;
}) {
  const [loading, setLoading] = useState(false);

  const handleImport = async () => {
    try {
      setLoading(true);
      await onImport();
    } catch (error: any) {
      console.error("Import failed:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="bg-white/5 border-white/10 hover:bg-white/10 transition-colors">
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center">
              <Icon className="w-5 h-5 text-purple-400" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white">{name}</h3>
              <p className="text-xs text-white/60">{description}</p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleImport}
            disabled={loading}
            className="border-white/20"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Upload className="w-4 h-4" />
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default BookmarksCurationPlugin;
