"use client";

import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Clock,
  Play,
  Pause,
  Trash2,
  Plus,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Lock,
  Zap,
  Calendar,
  Terminal,
  Globe,
  Server,
  Loader2,
  ExternalLink,
  ChevronRight,
  Activity,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/auth-context";

// Cron job types matching the scheduler service
type CronJobType = 
  | "sandbox-command" 
  | "nullclaw-agent" 
  | "http-webhook" 
  | "workspace-index" 
  | "sandbox-cleanup" 
  | "health-check" 
  | "custom";

interface CronJob {
  id: string;
  name: string;
  type: CronJobType;
  schedule: string;
  timezone?: string;
  payload: Record<string, any>;
  enabled: boolean;
  createdAt: number;
  lastRunAt?: number;
  nextRunAt?: number;
  runCount: number;
  lastResult?: {
    success: boolean;
    output?: string;
    error?: string;
    duration: number;
  };
  maxRetries?: number;
  timeout?: number;
  ownerId?: string;
  tags?: string[];
}

// Common cron presets
const CRON_PRESETS = [
  { label: "Every minute", value: "* * * * *" },
  { label: "Every 5 minutes", value: "*/5 * * * *" },
  { label: "Every 15 minutes", value: "*/15 * * * *" },
  { label: "Every 30 minutes", value: "*/30 * * * *" },
  { label: "Every hour", value: "0 * * * *" },
  { label: "Every day at midnight", value: "0 0 * * *" },
  { label: "Every day at noon", value: "0 12 * * *" },
  { label: "Every Sunday", value: "0 0 * * 0" },
  { label: "Every month", value: "0 0 1 * *" },
];

// Task type options
const TASK_TYPES: { value: CronJobType; label: string; icon: React.ElementType; description: string }[] = [
  { value: "http-webhook", label: "HTTP Webhook", icon: Globe, description: "Fire an external HTTP request" },
  { value: "sandbox-command", label: "Sandbox Command", icon: Terminal, description: "Execute a command inside a sandbox" },
  { value: "nullclaw-agent", label: "AI Agent", icon: Zap, description: "Call the nullclaw agent endpoint" },
  { value: "workspace-index", label: "Workspace Index", icon: Server, description: "Trigger workspace re-indexing" },
  { value: "custom", label: "Custom Event", icon: Activity, description: "Publish event to Redis for handlers" },
];

// User quota - 1 task per authenticated user
const MAX_USER_TASKS = 1;

export function CronJobsPanel({ onClose }: { onClose?: () => void }) {
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    type: "http-webhook" as CronJobType,
    schedule: "*/5 * * * *",
    payload: {
      url: "",
      method: "POST",
      body: "",
      headers: {},
    },
    enabled: true,
  });
  const [submitting, setSubmitting] = useState(false);

  // Fetch user's cron jobs on mount
  useEffect(() => {
    if (isAuthenticated && user?.id) {
      fetchJobs();
    }
  }, [isAuthenticated, user?.id]);

  const fetchJobs = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/cron-jobs", {
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        setJobs(data.jobs || []);
      }
    } catch (error) {
      console.error("Failed to fetch cron jobs:", error);
    } finally {
      setLoading(false);
    }
  };

  const createJob = async () => {
    if (!formData.name.trim()) {
      toast.error("Please enter a job name");
      return;
    }

    // Check quota
    if (jobs.length >= MAX_USER_TASKS) {
      toast.error(`You can only have ${MAX_USER_TASKS} cron job. Delete an existing one to create a new one.`);
      return;
    }

    try {
      setSubmitting(true);
      const res = await fetch("/api/cron-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.name,
          type: formData.type,
          schedule: formData.schedule,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          payload: formData.payload,
          enabled: formData.enabled,
        }),
        credentials: "include",
      });

      if (res.ok) {
        const newJob = await res.json();
        setJobs([...jobs, newJob]);
        setShowCreateForm(false);
        setFormData({
          name: "",
          type: "http-webhook",
          schedule: "*/5 * * * *",
          payload: { url: "", method: "POST", body: "", headers: {} },
          enabled: true,
        });
        toast.success("Cron job created successfully!");
      } else {
        const err = await res.json();
        toast.error(err.error || "Failed to create cron job");
      }
    } catch (error) {
      console.error("Failed to create cron job:", error);
      toast.error("Failed to create cron job");
    } finally {
      setSubmitting(false);
    }
  };

  const toggleJob = async (jobId: string, enabled: boolean) => {
    try {
      const res = await fetch(`/api/cron-jobs/${jobId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
        credentials: "include",
      });

      if (res.ok) {
        setJobs(jobs.map(j => j.id === jobId ? { ...j, enabled } : j));
        toast.success(enabled ? "Cron job enabled" : "Cron job paused");
      }
    } catch (error) {
      console.error("Failed to toggle cron job:", error);
      toast.error("Failed to update cron job");
    }
  };

  const deleteJob = async (jobId: string) => {
    try {
      const res = await fetch(`/api/cron-jobs/${jobId}`, {
        method: "DELETE",
        credentials: "include",
      });

      if (res.ok) {
        setJobs(jobs.filter(j => j.id !== jobId));
        toast.success("Cron job deleted");
      }
    } catch (error) {
      console.error("Failed to delete cron job:", error);
      toast.error("Failed to delete cron job");
    }
  };

  const triggerJob = async (jobId: string) => {
    try {
      const res = await fetch(`/api/cron-jobs/${jobId}/trigger`, {
        method: "POST",
        credentials: "include",
      });

      if (res.ok) {
        const result = await res.json();
        toast.success(result.success ? "Job executed successfully!" : `Job failed: ${result.error}`);
        fetchJobs(); // Refresh to get updated lastRunAt
      }
    } catch (error) {
      console.error("Failed to trigger cron job:", error);
      toast.error("Failed to trigger cron job");
    }
  };

  // Not authenticated state
  if (!authLoading && !isAuthenticated) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center">
        <div className="w-16 h-16 rounded-full bg-white/10 flex items-center justify-center mb-4">
          <Lock className="w-8 h-8 text-white/60" />
        </div>
        <h3 className="text-lg font-semibold text-white mb-2">Login Required</h3>
        <p className="text-white/60 text-sm mb-4">
          You must be logged in to create and manage cron jobs.
        </p>
        <Button 
          onClick={() => window.location.href = "/login"}
          className="bg-white/10 hover:bg-white/20 text-white border border-white/20"
        >
          Sign In
        </Button>
      </div>
    );
  }

  // Loading state
  if (authLoading || loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 text-white/40 animate-spin" />
      </div>
    );
  }

  const activeJobs = jobs.filter(j => j.enabled).length;
  const canCreateMore = jobs.length < MAX_USER_TASKS;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-orange-500/20 to-amber-500/20 flex items-center justify-center">
            <Clock className="w-5 h-5 text-orange-400" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-white">Cron Jobs</h2>
            <p className="text-xs text-white/50">
              {jobs.length}/{MAX_USER_TASKS} jobs • {activeJobs} active
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={fetchJobs}
            className="h-8 w-8 text-white/60 hover:text-white"
          >
            <RefreshCw className="w-4 h-4" />
          </Button>
          {canCreateMore && (
            <Button
              onClick={() => setShowCreateForm(true)}
              className="h-8 px-3 text-xs bg-orange-500/20 hover:bg-orange-500/30 text-orange-400 border border-orange-500/30"
            >
              <Plus className="w-4 h-4 mr-1" />
              New Job
            </Button>
          )}
        </div>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          {/* Create Form Modal */}
          <AnimatePresence>
            {showCreateForm && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <Card className="bg-white/5 border-white/10">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm text-white">Create Cron Job</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* Job Name */}
                    <div className="space-y-2">
                      <Label className="text-xs text-white/70">Job Name</Label>
                      <Input
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        placeholder="My scheduled task"
                        className="bg-white/5 border-white/10 text-white text-sm"
                      />
                    </div>

                    {/* Task Type */}
                    <div className="space-y-2">
                      <Label className="text-xs text-white/70">Task Type</Label>
                      <div className="grid grid-cols-2 gap-2">
                        {TASK_TYPES.map((type) => (
                          <button
                            key={type.value}
                            onClick={() => setFormData({ ...formData, type: type.value })}
                            className={`p-2 rounded-lg border text-left transition-all ${
                              formData.type === type.value
                                ? "bg-orange-500/20 border-orange-500/40"
                                : "bg-white/5 border-white/10 hover:bg-white/10"
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              <type.icon className="w-4 h-4 text-orange-400" />
                              <span className="text-xs text-white">{type.label}</span>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Schedule */}
                    <div className="space-y-2">
                      <Label className="text-xs text-white/70">Schedule (Cron Expression)</Label>
                      <Input
                        value={formData.schedule}
                        onChange={(e) => setFormData({ ...formData, schedule: e.target.value })}
                        placeholder="*/5 * * * *"
                        className="bg-white/5 border-white/10 text-white text-sm font-mono"
                      />
                      <div className="flex flex-wrap gap-1 mt-2">
                        {CRON_PRESETS.slice(0, 5).map((preset) => (
                          <button
                            key={preset.value}
                            onClick={() => setFormData({ ...formData, schedule: preset.value })}
                            className={`px-2 py-1 rounded text-xs transition-all ${
                              formData.schedule === preset.value
                                ? "bg-orange-500/20 text-orange-400"
                                : "bg-white/5 text-white/60 hover:text-white"
                            }`}
                          >
                            {preset.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* HTTP Webhook Payload */}
                    {formData.type === "http-webhook" && (
                      <div className="space-y-2">
                        <Label className="text-xs text-white/70">Webhook URL</Label>
                        <Input
                          value={formData.payload.url || ""}
                          onChange={(e) => setFormData({ 
                            ...formData, 
                            payload: { ...formData.payload, url: e.target.value } 
                          })}
                          placeholder="https://api.example.com/webhook"
                          className="bg-white/5 border-white/10 text-white text-sm"
                        />
                        <div className="grid grid-cols-2 gap-2 mt-2">
                          <div>
                            <Label className="text-xs text-white/50">Method</Label>
                            <select
                              value={formData.payload.method || "POST"}
                              onChange={(e) => setFormData({ 
                                ...formData, 
                                payload: { ...formData.payload, method: e.target.value } 
                              })}
                              className="w-full mt-1 px-2 py-1.5 rounded bg-white/5 border border-white/10 text-white text-sm"
                            >
                              <option value="GET">GET</option>
                              <option value="POST">POST</option>
                              <option value="PUT">PUT</option>
                              <option value="DELETE">DELETE</option>
                            </select>
                          </div>
                          <div>
                            <Label className="text-xs text-white/50">Enable</Label>
                            <div className="mt-1">
                              <Switch
                                checked={formData.enabled}
                                onCheckedChange={(checked) => setFormData({ ...formData, enabled: checked })}
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex justify-end gap-2 pt-2">
                      <Button
                        variant="ghost"
                        onClick={() => setShowCreateForm(false)}
                        className="text-white/60 hover:text-white"
                      >
                        Cancel
                      </Button>
                      <Button
                        onClick={createJob}
                        disabled={submitting}
                        className="bg-orange-500/20 hover:bg-orange-500/30 text-orange-400 border border-orange-500/30"
                      >
                        {submitting ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <>
                            <Plus className="w-4 h-4 mr-1" />
                            Create Job
                          </>
                        )}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            )}
          </AnimatePresence>

          {/* No Jobs State */}
          {jobs.length === 0 && !showCreateForm && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center mb-3">
                <Calendar className="w-6 h-6 text-white/30" />
              </div>
              <p className="text-white/50 text-sm mb-2">No cron jobs yet</p>
              <p className="text-white/30 text-xs mb-4">
                Create your first scheduled task
              </p>
              <Button
                onClick={() => setShowCreateForm(true)}
                className="bg-white/10 hover:bg-white/20 text-white border border-white/20"
              >
                <Plus className="w-4 h-4 mr-1" />
                Create Job
              </Button>
            </div>
          )}

          {/* Jobs List */}
          {jobs.map((job) => (
            <Card 
              key={job.id} 
              className={`bg-white/5 border-white/10 transition-all ${
                !job.enabled && "opacity-60"
              }`}
            >
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                      job.enabled 
                        ? "bg-gradient-to-br from-green-500/20 to-emerald-500/20" 
                        : "bg-white/5"
                    }`}>
                      {job.lastResult?.success ? (
                        <CheckCircle2 className="w-5 h-5 text-green-400" />
                      ) : job.lastResult?.success === false ? (
                        <XCircle className="w-5 h-5 text-red-400" />
                      ) : (
                        <Clock className="w-5 h-5 text-white/40" />
                      )}
                    </div>
                    <div>
                      <h3 className="text-sm font-medium text-white">{job.name}</h3>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge 
                          variant="outline" 
                          className={`text-xs ${
                            job.enabled 
                              ? "bg-green-500/20 text-green-400 border-green-500/30" 
                              : "bg-white/5 text-white/40 border-white/10"
                          }`}
                        >
                          {job.enabled ? "Active" : "Paused"}
                        </Badge>
                        <span className="text-xs text-white/40 font-mono">{job.schedule}</span>
                      </div>
                      <div className="flex items-center gap-4 mt-2 text-xs text-white/40">
                        <span>{job.runCount} runs</span>
                        {job.lastRunAt && (
                          <span>Last: {new Date(job.lastRunAt).toLocaleString()}</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => triggerJob(job.id)}
                      className="h-8 w-8 text-white/60 hover:text-green-400"
                    >
                      <Play className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => toggleJob(job.id, !job.enabled)}
                      className="h-8 w-8 text-white/60 hover:text-white"
                    >
                      {job.enabled ? (
                        <Pause className="w-4 h-4" />
                      ) : (
                        <Play className="w-4 h-4" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => deleteJob(job.id)}
                      className="h-8 w-8 text-white/60 hover:text-red-400"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>

                {/* Error display */}
                {job.lastResult?.error && (
                  <div className="mt-3 p-2 rounded bg-red-500/10 border border-red-500/20">
                    <div className="flex items-center gap-2 text-red-400 text-xs">
                      <AlertCircle className="w-3 h-3" />
                      <span>{job.lastResult.error}</span>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}

          {/* Quota Warning */}
          {!canCreateMore && (
            <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
              <div className="flex items-center gap-2 text-amber-400 text-xs">
                <AlertCircle className="w-4 h-4" />
                <span>You've reached your quota of {MAX_USER_TASKS} cron job. Delete an existing job to create a new one.</span>
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Footer */}
      <div className="p-3 border-t border-white/10">
        <div className="flex items-center justify-between text-xs text-white/40">
          <span>Scheduler powered by BullMQ</span>
          <span className="flex items-center gap-1">
            <Lock className="w-3 h-3" />
            1 job per user
          </span>
        </div>
      </div>
    </div>
  );
}

export default CronJobsPanel;
