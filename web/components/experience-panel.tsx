"use client";

import React, { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  Brain,
  Sparkles,
  Zap,
  TrendingUp,
  Clock,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Search,
  Lightbulb,
  Target,
  BarChart3,
  Filter,
  X,
  CheckCircle2,
  AlertCircle,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";

interface AgentExperience {
  id: string;
  lesson: string;
  category: string;
  tags: string[];
  createdAt: number;
  lastUsedAt?: number;
  usageCount: number;
  successRate: number;
  contextHint?: string;
  priority: number;
}

interface ExperienceStats {
  totalExperiences: number;
  byCategory: Record<string, number>;
  averageSuccessRate: number;
  oldestExperience: number | null;
  newestExperience: number | null;
}

interface ExperiencePanelProps {
  onClose?: () => void;
}

const CATEGORY_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  security: Zap,
  patterns: Target,
  performance: TrendingUp,
  general: Lightbulb,
};

const CATEGORY_COLORS: Record<string, string> = {
  security: 'bg-red-500/20 text-red-300 border-red-500/30',
  patterns: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  performance: 'bg-green-500/20 text-green-300 border-green-500/30',
  general: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
};

export function ExperiencePanel({ onClose }: ExperiencePanelProps) {
  const [experiences, setExperiences] = useState<AgentExperience[]>([]);
  const [stats, setStats] = useState<ExperienceStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [expandedExpId, setExpandedExpId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchExperiences = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (selectedCategory) params.set('category', selectedCategory);
      if (searchQuery) params.set('query', searchQuery);

      const response = await fetch(`/api/memory/experiences?action=search&${params}`);
      const data = await response.json();

      if (data.success) {
        setExperiences(data.experiences || []);
      }
    } catch (err) {
      console.error('[ExperiencePanel] Failed to fetch experiences:', err);
    }
  }, [selectedCategory, searchQuery]);

  const fetchStats = useCallback(async () => {
    try {
      const response = await fetch('/api/memory/experiences?action=stats');
      const data = await response.json();

      if (data.success) {
        setStats(data.stats);
      }
    } catch (err) {
      console.error('[ExperiencePanel] Failed to fetch stats:', err);
    }
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    await Promise.all([fetchExperiences(), fetchStats()]);
    setLoading(false);
  }, [fetchExperiences, fetchStats]);

  // Fetch experiences when search or category filter changes
  useEffect(() => {
    const debounceTimer = setTimeout(() => {
      fetchExperiences();
    }, 300); // Debounce search
    return () => clearTimeout(debounceTimer);
  }, [fetchExperiences, searchQuery, selectedCategory]);

  // Fetch data on mount (this also clears loading)
  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
    toast.success('Experience data refreshed');
  };

  const handleCategoryFilter = (category: string | null) => {
    setSelectedCategory(category);
  };

  const getCategoryIcon = (category: string) => {
    const Icon = CATEGORY_ICONS[category] || Lightbulb;
    return <Icon className="h-3 w-3" />;
  };

  const formatSuccessRate = (rate: number) => {
    return `${(rate * 100).toFixed(0)}%`;
  };

  const formatTimeAgo = (timestamp: number) => {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(timestamp).toLocaleDateString();
  };

  const getSuccessColor = (rate: number) => {
    if (rate >= 0.7) return 'text-green-400';
    if (rate >= 0.5) return 'text-yellow-400';
    return 'text-red-400';
  };

  const categories = stats ? Object.keys(stats.byCategory) : [];

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-6 w-6 text-purple-400 animate-spin mx-auto mb-2" />
          <p className="text-sm text-white/60">Loading experiences...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center p-4">
        <div className="text-center">
          <AlertCircle className="h-8 w-8 text-red-400 mx-auto mb-2" />
          <p className="text-sm text-red-300 mb-3">{error}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={loadData}
            className="border-white/20 text-white/70 hover:bg-white/10"
          >
            <RefreshCw className="h-3 w-3 mr-2" />
            Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-white/10 bg-gradient-to-r from-purple-500/10 to-blue-500/10">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-500/20 rounded-lg border border-purple-500/30">
              <Brain className="h-5 w-5 text-purple-400" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white/90">Agent Experiences</h3>
              <p className="text-[10px] text-white/50">Real-time learned insights</p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleRefresh}
            disabled={refreshing}
            className="h-8 w-8 text-white/60 hover:text-white hover:bg-white/10"
            title="Refresh"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          </Button>
        </div>

        {/* Search */}
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-white/40" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search experiences..."
            className="pl-9 h-8 bg-white/5 border-white/20 text-xs"
          />
        </div>

        {/* Stats Summary */}
        {stats && (
          <div className="flex items-center gap-4 text-xs">
            <div className="flex items-center gap-1.5">
              <Sparkles className="h-3 w-3 text-purple-400" />
              <span className="text-white/60">{stats.totalExperiences} total</span>
            </div>
            <div className="flex items-center gap-1.5">
              <TrendingUp className={`h-3 w-3 ${getSuccessColor(stats.averageSuccessRate)}`} />
              <span className="text-white/60">{formatSuccessRate(stats.averageSuccessRate)} avg success</span>
            </div>
          </div>
        )}
      </div>

      {/* Category Filters */}
      {categories.length > 0 && (
        <div className="px-4 py-2 border-b border-white/10">
          <div className="flex items-center gap-2 overflow-x-auto scrollbar-none">
            <Button
              size="sm"
              variant={selectedCategory === null ? 'secondary' : 'ghost'}
              onClick={() => handleCategoryFilter(null)}
              className={`h-6 text-[10px] shrink-0 ${selectedCategory === null ? 'bg-white/20' : ''}`}
            >
              All
            </Button>
            {categories.map((cat) => (
              <Button
                key={cat}
                size="sm"
                variant={selectedCategory === cat ? 'secondary' : 'ghost'}
                onClick={() => handleCategoryFilter(cat)}
                className={`h-6 text-[10px] shrink-0 ${selectedCategory === cat ? 'bg-white/20' : ''}`}
              >
                {getCategoryIcon(cat)}
                <span className="ml-1">{cat}</span>
                <Badge variant="secondary" className="ml-1.5 h-4 text-[8px] bg-white/10">
                  {stats?.byCategory[cat]}
                </Badge>
              </Button>
            ))}
          </div>
        </div>
      )}

      {/* Experience List */}
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-2">
          {experiences.length === 0 ? (
            <div className="text-center py-8">
              <Lightbulb className="h-8 w-8 text-white/30 mx-auto mb-2" />
              <p className="text-sm text-white/50">No experiences yet</p>
              <p className="text-[10px] text-white/40 mt-1">
                Agent learning experiences will appear here
              </p>
            </div>
          ) : (
            experiences.map((exp, idx) => {
              const isExpanded = expandedExpId === exp.id;
              return (
                <motion.div
                  key={exp.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.05 }}
                >
                  <div
                    onClick={() => setExpandedExpId(isExpanded ? null : exp.id)}
                    className={`p-3 rounded-lg border transition-all cursor-pointer ${
                      isExpanded
                        ? 'bg-white/10 border-white/20'
                        : 'bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/15'
                    }`}
                  >
                    {/* Header Row */}
                    <div className="flex items-start gap-3">
                      <div className={`p-1.5 rounded ${CATEGORY_COLORS[exp.category] || CATEGORY_COLORS.general}`}>
                        {getCategoryIcon(exp.category)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-white/90 line-clamp-2">{exp.lesson}</p>
                        <div className="flex items-center gap-2 mt-1.5">
                          <Badge variant="secondary" className={`text-[8px] ${CATEGORY_COLORS[exp.category] || CATEGORY_COLORS.general}`}>
                            {exp.category}
                          </Badge>
                          <span className={`text-[10px] font-medium ${getSuccessColor(exp.successRate)}`}>
                            {formatSuccessRate(exp.successRate)}
                          </span>
                          <span className="text-[10px] text-white/40">
                            {exp.usageCount} uses
                          </span>
                        </div>
                      </div>
                      {isExpanded ? (
                        <ChevronDown className="h-4 w-4 text-white/40 shrink-0" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-white/40 shrink-0" />
                      )}
                    </div>

                    {/* Expanded Content */}
                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2 }}
                          className="overflow-hidden"
                        >
                          <div className="mt-3 pt-3 border-t border-white/10 space-y-2">
                            {/* Tags */}
                            {exp.tags.length > 0 && (
                              <div className="flex flex-wrap gap-1">
                                {exp.tags.map((tag) => (
                                  <Badge key={tag} variant="secondary" className="text-[8px] bg-white/5">
                                    {tag}
                                  </Badge>
                                ))}
                              </div>
                            )}

                            {/* Context Hint */}
                            {exp.contextHint && (
                              <div className="text-xs text-white/60">
                                <span className="font-medium">Context:</span> {exp.contextHint}
                              </div>
                            )}

                            {/* Stats */}
                            <div className="flex items-center gap-4 text-[10px] text-white/50">
                              <span className="flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                Created {formatTimeAgo(exp.createdAt)}
                              </span>
                              {exp.lastUsedAt && (
                                <span>Last used {formatTimeAgo(exp.lastUsedAt)}</span>
                              )}
                              <span>Priority: {exp.priority}</span>
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </motion.div>
              );
            })
          )}
        </div>
      </ScrollArea>

      {/* Footer with Quick Actions */}
      <div className="p-3 border-t border-white/10 bg-white/5">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-white/40">
            {experiences.length} experiences shown
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => toast.info('Mem0 integration active')}
            className="h-6 text-[10px] text-white/50 hover:text-white"
          >
            <BarChart3 className="h-3 w-3 mr-1" />
            View Full Stats
          </Button>
        </div>
      </div>
    </div>
  );
}

export default ExperiencePanel;
