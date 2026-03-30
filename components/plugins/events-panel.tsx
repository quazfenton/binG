/**
 * Events Panel - Real-time event monitoring UI
 *
 * Features:
 * - Live event stream
 * - Event statistics dashboard
 * - Event filtering and search
 * - Event details viewer
 * - Manual event emission
 * - Approval management
 *
 * @component
 */

"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Activity,
  Clock,
  CheckCircle,
  XCircle,
  AlertCircle,
  RefreshCw,
  Filter,
  Search,
  Play,
  Pause,
  Trash2,
  Eye,
  Zap,
  Calendar,
  User,
  Hash,
  ChevronRight,
  ChevronDown,
  Maximize2,
  Minimize2,
  Download,
  Share2,
  Copy,
  Terminal,
  Workflow,
  Bell,
  Settings,
  Check,
  X,
} from "lucide-react";
import { toast } from "sonner";

// Types
interface Event {
  id: string;
  type: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  payload: any;
  userId: string;
  sessionId?: string;
  retryCount: number;
  error?: string;
  createdAt: string;
  updatedAt?: string;
  completedAt?: string;
}

interface EventStats {
  total: number;
  pending: number;
  running: number;
  completed: number;
  failed: number;
  cancelled: number;
}

interface EventFilters {
  status?: string;
  type?: string;
  userId?: string;
  search?: string;
}

// Status badge colors
const statusColors: Record<string, string> = {
  pending: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
  running: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  completed: 'bg-green-500/20 text-green-300 border-green-500/30',
  failed: 'bg-red-500/20 text-red-300 border-red-500/30',
  cancelled: 'bg-gray-500/20 text-gray-300 border-gray-500/30',
};

// Type icons
const typeIcons: Record<string, any> = {
  SCHEDULED_TASK: Calendar,
  BACKGROUND_JOB: Workflow,
  ORCHESTRATION_STEP: Activity,
  WORKFLOW: Workflow,
  BASH_EXECUTION: Terminal,
  DAG_EXECUTION: Workflow,
  HUMAN_APPROVAL: User,
  SELF_HEALING: RefreshCw,
  NOTIFICATION: Bell,
  INTEGRATION: Zap,
};

export default function EventsPanel() {
  // State
  const [events, setEvents] = useState<Event[]>([]);
  const [stats, setStats] = useState<EventStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshInterval, setRefreshInterval] = useState(5000);
  const [filters, setFilters] = useState<EventFilters>({});
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [useSSE, setUseSSE] = useState(true);
  const eventSourceRef = useRef<EventSource | null>(null);

  // SSE connection for real-time updates
  useEffect(() => {
    if (!useSSE) return;

    try {
      const eventSource = new EventSource('/api/events/stream');
      eventSourceRef.current = eventSource;

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          if (data.type === 'connected') {
            console.log('[EventsPanel] SSE connected');
          } else if (data.type === 'event') {
            // Add new event to list
            setEvents((prev) => {
              const exists = prev.find((e) => e.id === data.event.id);
              if (exists) {
                // Update existing event
                return prev.map((e) => (e.id === data.event.id ? data.event : e));
              }
              // Add new event
              return [data.event, ...prev].slice(0, 100);
            });
            
            // Update stats
            fetchStats();
          }
        } catch (error) {
          console.error('SSE message error:', error);
        }
      };

      eventSource.onerror = (error) => {
        console.error('SSE error:', error);
        eventSource.close();
        eventSourceRef.current = null;
        setUseSSE(false);
        toast.error('Real-time updates disconnected');
      };

      return () => {
        if (eventSourceRef.current) {
          eventSourceRef.current.close();
        }
      };
    } catch (error) {
      console.error('Failed to connect SSE:', error);
      setUseSSE(false);
    }
  }, [useSSE]);

  const scrollRef = useRef<HTMLDivElement>(null);

  // Fetch events
  const fetchEvents = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (filters.status) params.set('status', filters.status);
      if (filters.type) params.set('type', filters.type);
      params.set('limit', '50');

      const response = await fetch(`/api/events?${params}`);
      const data = await response.json();

      if (data.success) {
        setEvents(data.events);
      }
    } catch (error: any) {
      console.error('Failed to fetch events:', error);
      toast.error('Failed to fetch events');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  // Fetch stats
  const fetchStats = useCallback(async () => {
    try {
      const response = await fetch('/api/events/stats');
      const data = await response.json();

      if (data.success) {
        setStats(data.stats);
      }
    } catch (error: any) {
      console.error('Failed to fetch stats:', error);
    }
  }, []);

  // Auto-refresh
  useEffect(() => {
    if (!autoRefresh) return;

    fetchEvents();
    fetchStats();

    const interval = setInterval(() => {
      fetchEvents();
      fetchStats();
    }, refreshInterval);

    return () => clearInterval(interval);
  }, [autoRefresh, refreshInterval, fetchEvents, fetchStats]);

  // Initial load
  useEffect(() => {
    fetchEvents();
    fetchStats();
  }, []);

  // Filter events
  const filteredEvents = events.filter((event) => {
    if (filters.status && event.status !== filters.status) return false;
    if (filters.type && event.type !== filters.type) return false;
    if (filters.userId && event.userId !== filters.userId) return false;
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      return (
        event.type.toLowerCase().includes(query) ||
        event.id.toLowerCase().includes(query) ||
        JSON.stringify(event.payload).toLowerCase().includes(query)
      );
    }
    return true;
  });

  // Format time
  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString();
  };

  // Format relative time
  const formatRelative = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (seconds < 60) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };

  // Get unique event types
  const eventTypes = Array.from(new Set(events.map((e) => e.type)));

  // Get unique statuses
  const statuses = ['pending', 'running', 'completed', 'failed', 'cancelled'];

  return (
    <div className={`h-full flex flex-col ${isFullscreen ? 'fixed inset-0 z-[9999] bg-black/95' : ''}`}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-white/10">
        <div className="flex items-center gap-3">
          <Activity className="w-5 h-5 text-purple-400" />
          <h3 className="text-lg font-semibold text-white">Events</h3>
          {stats && (
            <Badge variant="outline" className="text-[10px] border-white/20">
              {stats.total} total
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button
            onClick={() => setUseSSE(!useSSE)}
            variant="ghost"
            size="icon"
            className={useSSE ? 'text-green-400' : 'text-white/60'}
            title={useSSE ? 'Real-time updates on' : 'Real-time updates off'}
          >
            <Zap className={`w-4 h-4 ${useSSE ? 'fill-current' : ''}`} />
          </Button>
          <Button
            onClick={() => setAutoRefresh(!autoRefresh)}
            variant="ghost"
            size="icon"
            className={autoRefresh ? 'text-green-400' : 'text-white/60'}
          >
            {autoRefresh ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          </Button>
          <Button onClick={fetchEvents} variant="ghost" size="icon" className="text-white/60">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
          <Button onClick={() => setShowFilters(!showFilters)} variant="ghost" size="icon" className="text-white/60">
            <Filter className="w-4 h-4" />
          </Button>
          <Button onClick={() => setIsFullscreen(!isFullscreen)} variant="ghost" size="icon" className="text-white/60">
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </Button>
        </div>
      </div>

      {/* Stats Bar */}
      {stats && (
        <div className="flex items-center gap-2 p-3 border-b border-white/10">
          <Badge className="bg-yellow-500/20 text-yellow-300 border-yellow-500/30">
            {stats.pending} pending
          </Badge>
          <Badge className="bg-blue-500/20 text-blue-300 border-blue-500/30">
            {stats.running} running
          </Badge>
          <Badge className="bg-green-500/20 text-green-300 border-green-500/30">
            {stats.completed} completed
          </Badge>
          <Badge className="bg-red-500/20 text-red-300 border-red-500/30">
            {stats.failed} failed
          </Badge>
        </div>
      )}

      {/* Filters */}
      <AnimatePresence>
        {showFilters && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-b border-white/10 overflow-hidden"
          >
            <div className="p-3 space-y-3">
              {/* Search */}
              <div className="flex items-center gap-2">
                <Search className="w-4 h-4 text-white/40" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search events..."
                  className="flex-1 bg-white/5 border border-white/10 rounded px-3 py-1 text-sm text-white placeholder:text-white/30"
                />
              </div>

              {/* Filter controls */}
              <div className="flex gap-2 flex-wrap">
                <select
                  value={filters.status || ''}
                  onChange={(e) => setFilters({ ...filters, status: e.target.value || undefined })}
                  className="bg-white/5 border border-white/10 rounded px-2 py-1 text-sm text-white"
                >
                  <option value="">All Status</option>
                  {statuses.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>

                <select
                  value={filters.type || ''}
                  onChange={(e) => setFilters({ ...filters, type: e.target.value || undefined })}
                  className="bg-white/5 border border-white/10 rounded px-2 py-1 text-sm text-white"
                >
                  <option value="">All Types</option>
                  {eventTypes.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>

                <Button
                  onClick={() => setFilters({})}
                  variant="ghost"
                  size="sm"
                  className="text-white/60"
                >
                  Clear
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Events List */}
      <ScrollArea ref={scrollRef} className="flex-1">
        <div className="p-2 space-y-1">
          {filteredEvents.length === 0 ? (
            <div className="text-center py-8 text-white/40">
              <Activity className="w-12 h-12 mx-auto mb-2 opacity-20" />
              <p>No events found</p>
            </div>
          ) : (
            filteredEvents.map((event) => {
              const TypeIcon = typeIcons[event.type] || Activity;
              const isSelected = selectedEvent?.id === event.id;

              return (
                <motion.div
                  key={event.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  className={`p-3 rounded-lg cursor-pointer transition-all ${
                    isSelected
                      ? 'bg-purple-500/20 border-purple-500/30'
                      : 'bg-white/5 border-white/10 hover:bg-white/10'
                  } border`}
                  onClick={() => setSelectedEvent(isSelected ? null : event)}
                >
                  <div className="flex items-center gap-3">
                    {/* Status indicator */}
                    <div className={`w-2 h-2 rounded-full ${
                      event.status === 'completed' ? 'bg-green-400' :
                      event.status === 'failed' ? 'bg-red-400' :
                      event.status === 'running' ? 'bg-blue-400 animate-pulse' :
                      'bg-yellow-400'
                    }`} />

                    {/* Type icon */}
                    <TypeIcon className="w-4 h-4 text-white/60" />

                    {/* Event info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-white truncate">
                          {event.type}
                        </span>
                        <Badge className={`text-[10px] ${statusColors[event.status]}`}>
                          {event.status}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-white/40">
                        <span>{formatRelative(event.createdAt)}</span>
                        {event.retryCount > 0 && (
                          <span className="flex items-center gap-1">
                            <RefreshCw className="w-3 h-3" />
                            {event.retryCount} retries
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Expand indicator */}
                    {isSelected ? (
                      <ChevronDown className="w-4 h-4 text-white/40" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-white/40" />
                    )}
                  </div>

                  {/* Expanded details */}
                  <AnimatePresence>
                    {isSelected && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="mt-3 pt-3 border-t border-white/10 overflow-hidden"
                      >
                        <div className="space-y-2 text-xs">
                          <div className="flex items-center gap-2">
                            <Hash className="w-3 h-3 text-white/40" />
                            <span className="text-white/60 font-mono">{event.id}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <User className="w-3 h-3 text-white/40" />
                            <span className="text-white/60">{event.userId}</span>
                          </div>
                          {event.sessionId && (
                            <div className="flex items-center gap-2">
                              <Clock className="w-3 h-3 text-white/40" />
                              <span className="text-white/60 font-mono">{event.sessionId}</span>
                            </div>
                          )}
                          {event.error && (
                            <div className="flex items-start gap-2 text-red-400">
                              <AlertCircle className="w-3 h-3 mt-0.5" />
                              <span className="font-mono">{event.error}</span>
                            </div>
                          )}
                          <div className="bg-black/40 rounded p-2 font-mono text-white/60 overflow-auto max-h-32">
                            <pre>{JSON.stringify(event.payload, null, 2)}</pre>
                          </div>
                          <div className="flex items-center gap-2 text-white/40">
                            <Clock className="w-3 h-3" />
                            <span>Created: {formatTime(event.createdAt)}</span>
                            {event.completedAt && (
                              <>
                                <CheckCircle className="w-3 h-3 text-green-400" />
                                <span>Completed: {formatTime(event.completedAt)}</span>
                              </>
                            )}
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
            })
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
