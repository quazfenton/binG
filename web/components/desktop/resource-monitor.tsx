'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Cpu, HardDrive, Activity, RefreshCw, AlertTriangle } from 'lucide-react';
import { tauriInvoke, type ResourceUsage } from '@/lib/tauri/invoke-bridge';
import { isDesktopMode } from '@/lib/utils/desktop-env';
import { createLogger } from '@/lib/utils/logger';

const log = createLogger('ResourceMonitor');

interface ResourceMonitorProps {
  refreshInterval?: number;
  showDetails?: boolean;
  className?: string;
}

export function ResourceMonitor({
  refreshInterval = 3000,
  showDetails = true,
  className,
}: ResourceMonitorProps) {
  const [resources, setResources] = useState<ResourceUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isDesktop, setIsDesktop] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  // Memoize loadResources to prevent stale closures in interval
  const loadResources = useCallback(async () => {
    try {
      const data = await tauriInvoke.getResourceUsage();
      setResources(data);
      setLastUpdate(new Date());
      setError(null);
    } catch (err: any) {
      log.error('Failed to load resources', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const desktop = isDesktopMode();
    setIsDesktop(desktop);

    if (desktop) {
      // Use sequential polling to avoid overlapping fetches
      let timeout: ReturnType<typeof setTimeout> | null = null;
      let cancelled = false;
      let inFlight = false;

      const poll = async () => {
        if (cancelled || inFlight) return;
        inFlight = true;
        await loadResources();
        inFlight = false;
        if (!cancelled) {
          timeout = setTimeout(poll, refreshInterval);
        }
      };

      // Start the polling loop
      void poll();

      return () => {
        cancelled = true;
        if (timeout) clearTimeout(timeout);
      };
    } else {
      setLoading(false);
    }
  }, [refreshInterval, loadResources]);

  const getCpuColor = (percent: number): string => {
    if (percent > 90) return 'text-red-500';
    if (percent > 70) return 'text-yellow-500';
    return 'text-green-500';
  };

  const getMemoryColor = (percent: number): string => {
    if (percent > 90) return 'bg-red-500';
    if (percent > 70) return 'bg-yellow-500';
    return 'bg-green-500';
  };

  const getDiskColor = (percent: number): string => {
    if (percent > 95) return 'bg-red-500';
    if (percent > 85) return 'bg-yellow-500';
    return 'bg-green-500';
  };

  if (!isDesktop) {
    return null;
  }

  if (loading) {
    return (
      <Card className={className}>
        <CardContent className="flex items-center justify-center py-8">
          <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (error || !resources) {
    return (
      <Card className={className}>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Activity className="h-4 w-4" />
            Resource Monitor
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <AlertTriangle className="h-4 w-4 text-yellow-500" />
            Unable to load resource data
          </div>
        </CardContent>
      </Card>
    );
  }

  // Guard against division by zero
  const memoryPercent = resources.memory_total_mb > 0 
    ? (resources.memory_used_mb / resources.memory_total_mb) * 100 
    : 0;
  const diskPercent = resources.disk_total_gb > 0 
    ? (resources.disk_used_gb / resources.disk_total_gb) * 100 
    : 0;

  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4" />
            Resource Monitor
          </div>
          {lastUpdate && (
            <Badge variant="outline" className="text-xs">
              {lastUpdate.toLocaleTimeString()}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* CPU */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Tooltip>
              <TooltipTrigger className="flex items-center gap-2 text-sm">
                <Cpu className="h-4 w-4" />
                <span>CPU</span>
              </TooltipTrigger>
              <TooltipContent>
                <p>{resources.active_processes} active processes</p>
              </TooltipContent>
            </Tooltip>
            <span className={`text-sm font-medium ${getCpuColor(resources.cpu_percent)}`}>
              {resources.cpu_percent.toFixed(1)}%
            </span>
          </div>
          <Progress value={resources.cpu_percent} className="h-2" />
        </div>

        {/* Memory */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Tooltip>
              <TooltipTrigger className="flex items-center gap-2 text-sm">
                <HardDrive className="h-4 w-4" />
                <span>Memory</span>
              </TooltipTrigger>
              <TooltipContent>
                <p>
                  {formatBytes(resources.memory_used_mb * 1024 * 1024)} /{' '}
                  {formatBytes(resources.memory_total_mb * 1024 * 1024)}
                </p>
              </TooltipContent>
            </Tooltip>
            <span className="text-sm font-medium">{memoryPercent.toFixed(1)}%</span>
          </div>
          {/* Custom progress bar with colored indicator */}
          <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
            <div
              className={`h-full transition-all ${getMemoryColor(memoryPercent)}`}
              style={{ width: `${Math.min(100, Math.max(0, memoryPercent))}%` }}
            />
          </div>
        </div>

        {/* Disk */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Tooltip>
              <TooltipTrigger className="flex items-center gap-2 text-sm">
                <HardDrive className="h-4 w-4" />
                <span>Disk</span>
              </TooltipTrigger>
              <TooltipContent>
                <p>
                  {resources.disk_used_gb.toFixed(1)}GB / {resources.disk_total_gb.toFixed(1)}GB
                </p>
              </TooltipContent>
            </Tooltip>
            <span className="text-sm font-medium">{diskPercent.toFixed(1)}%</span>
          </div>
          {/* Custom progress bar with colored indicator */}
          <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
            <div
              className={`h-full transition-all ${getDiskColor(diskPercent)}`}
              style={{ width: `${Math.min(100, Math.max(0, diskPercent))}%` }}
            />
          </div>
        </div>

        {showDetails && (
          <div className="pt-2 border-t text-xs text-muted-foreground">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className="font-medium">Processes:</span> {resources.active_processes}
              </div>
              <div>
                <span className="font-medium">Memory:</span> {formatBytes(resources.memory_used_mb * 1024 * 1024)}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}
