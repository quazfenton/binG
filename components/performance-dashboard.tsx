/**
 * Performance Dashboard Component
 * Real-time performance monitoring and optimization controls
 */

"use client";

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { usePerformance } from '@/hooks/use-performance';
import { performanceManager } from '@/lib/performance/performance-manager';
import { Activity, Cpu, HardDrive, Network, Smartphone, Zap } from 'lucide-react';

interface PerformanceDashboardProps {
  className?: string;
  showOptimizationControls?: boolean;
  autoRefresh?: boolean;
  refreshInterval?: number;
}

export function PerformanceDashboard({
  className = '',
  showOptimizationControls = true,
  autoRefresh = true,
  refreshInterval = 5000
}: PerformanceDashboardProps) {
  const {
    isOptimizing,
    lastReport,
    performanceScore,
    optimize,
    generateReport,
    isLowPowerMode
  } = usePerformance({
    enableMonitoring: true,
    enableOptimization: true,
    componentName: 'PerformanceDashboard'
  });

  const [detailedReport, setDetailedReport] = useState<string>('');
  const [showDetailedReport, setShowDetailedReport] = useState(false);
  const [optimizationHistory, setOptimizationHistory] = useState<Array<{
    timestamp: number;
    score: number;
    memoryFreed: number;
  }>>([]);

  // Auto-refresh performance data
  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(async () => {
      try {
        const report = await performanceManager.generatePerformanceReport();
        // Update optimization history
        setOptimizationHistory(prev => [
          ...prev.slice(-9), // Keep last 10 entries
          {
            timestamp: report.timestamp,
            score: report.score,
            memoryFreed: report.memory.memoryFreed
          }
        ]);
      } catch (error) {
        console.error('Failed to refresh performance data:', error);
      }
    }, refreshInterval);

    return () => clearInterval(interval);
  }, [autoRefresh, refreshInterval]);

  const handleOptimize = async () => {
    try {
      await optimize();
    } catch (error) {
      console.error('Optimization failed:', error);
    }
  };

  const handleGenerateReport = async () => {
    try {
      const report = await generateReport();
      setDetailedReport(report);
      setShowDetailedReport(true);
    } catch (error) {
      console.error('Failed to generate report:', error);
    }
  };

  const getScoreColor = (score: number): string => {
    if (score >= 80) return 'text-green-600';
    if (score >= 60) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getScoreBadgeVariant = (score: number): "default" | "secondary" | "destructive" | "outline" => {
    if (score >= 80) return 'default';
    if (score >= 60) return 'secondary';
    return 'destructive';
  };

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Performance Overview */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            Performance Overview
          </CardTitle>
          <CardDescription>
            Real-time application performance monitoring
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Performance Score */}
            <div className="text-center">
              <div className={`text-3xl font-bold ${getScoreColor(performanceScore)}`}>
                {performanceScore}
              </div>
              <div className="text-sm text-muted-foreground">Performance Score</div>
              <Badge variant={getScoreBadgeVariant(performanceScore)} className="mt-2">
                {performanceScore >= 80 ? 'Excellent' : 
                 performanceScore >= 60 ? 'Good' : 'Needs Attention'}
              </Badge>
            </div>

            {/* Status Indicators */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm">Low Power Mode</span>
                <Badge variant={isLowPowerMode ? 'secondary' : 'outline'}>
                  {isLowPowerMode ? 'Enabled' : 'Disabled'}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm">Optimization</span>
                <Badge variant={isOptimizing ? 'default' : 'outline'}>
                  {isOptimizing ? 'Running' : 'Idle'}
                </Badge>
              </div>
            </div>

            {/* Quick Actions */}
            {showOptimizationControls && (
              <div className="space-y-2">
                <Button 
                  onClick={handleOptimize} 
                  disabled={isOptimizing}
                  className="w-full"
                  size="sm"
                >
                  {isOptimizing ? 'Optimizing...' : 'Optimize Now'}
                </Button>
                <Button 
                  onClick={handleGenerateReport}
                  variant="outline"
                  className="w-full"
                  size="sm"
                >
                  Generate Report
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Detailed Metrics */}
      {lastReport && (
        <Tabs defaultValue="memory" className="w-full">
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="memory">Memory</TabsTrigger>
            <TabsTrigger value="streaming">Streaming</TabsTrigger>
            <TabsTrigger value="network">Network</TabsTrigger>
            <TabsTrigger value="ui">UI</TabsTrigger>
            <TabsTrigger value="mobile">Mobile</TabsTrigger>
          </TabsList>

          {/* Memory Tab */}
          <TabsContent value="memory">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <HardDrive className="h-4 w-4" />
                  Memory Usage
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <div className="flex justify-between text-sm mb-2">
                    <span>Heap Used</span>
                    <span>{(lastReport.overall.memory.heapUsed / 1024 / 1024).toFixed(2)} MB</span>
                  </div>
                  <Progress 
                    value={(lastReport.overall.memory.heapUsed / lastReport.overall.memory.heapTotal) * 100} 
                    className="h-2"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <div className="font-medium">Peak Usage</div>
                    <div className="text-muted-foreground">
                      {(lastReport.overall.memory.peakUsage / 1024 / 1024).toFixed(2)} MB
                    </div>
                  </div>
                  <div>
                    <div className="font-medium">Memory Leaks</div>
                    <div className="text-muted-foreground">
                      {lastReport.overall.memory.memoryLeaks.length}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Streaming Tab */}
          <TabsContent value="streaming">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Zap className="h-4 w-4" />
                  Streaming Performance
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <div className="font-medium">Total Chunks</div>
                    <div className="text-muted-foreground">
                      {lastReport.overall.streaming.totalChunks}
                    </div>
                  </div>
                  <div>
                    <div className="font-medium">Throughput</div>
                    <div className="text-muted-foreground">
                      {lastReport.overall.streaming.throughput.toFixed(2)} chunks/sec
                    </div>
                  </div>
                  <div>
                    <div className="font-medium">Render Latency</div>
                    <div className="text-muted-foreground">
                      {lastReport.overall.streaming.renderLatency.toFixed(2)} ms
                    </div>
                  </div>
                  <div>
                    <div className="font-medium">Error Rate</div>
                    <div className="text-muted-foreground">
                      {(lastReport.overall.streaming.errorRate * 100).toFixed(2)}%
                    </div>
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-sm mb-2">
                    <span>Buffer Utilization</span>
                    <span>{(lastReport.overall.streaming.bufferUtilization * 100).toFixed(1)}%</span>
                  </div>
                  <Progress 
                    value={lastReport.overall.streaming.bufferUtilization * 100} 
                    className="h-2"
                  />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Network Tab */}
          <TabsContent value="network">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Network className="h-4 w-4" />
                  Network Performance
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <div className="font-medium">Request Count</div>
                    <div className="text-muted-foreground">
                      {lastReport.overall.network.requestCount}
                    </div>
                  </div>
                  <div>
                    <div className="font-medium">Average Latency</div>
                    <div className="text-muted-foreground">
                      {lastReport.overall.network.averageLatency.toFixed(2)} ms
                    </div>
                  </div>
                  <div>
                    <div className="font-medium">Error Rate</div>
                    <div className="text-muted-foreground">
                      {(lastReport.overall.network.errorRate * 100).toFixed(2)}%
                    </div>
                  </div>
                  <div>
                    <div className="font-medium">Cache Hit Rate</div>
                    <div className="text-muted-foreground">
                      {(lastReport.overall.network.cacheHitRate * 100).toFixed(2)}%
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* UI Tab */}
          <TabsContent value="ui">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Cpu className="h-4 w-4" />
                  UI Performance
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <div className="font-medium">Frame Rate</div>
                    <div className="text-muted-foreground">
                      {lastReport.overall.ui.frameRate} FPS
                    </div>
                  </div>
                  <div>
                    <div className="font-medium">Layout Shifts</div>
                    <div className="text-muted-foreground">
                      {lastReport.overall.ui.layoutShifts.toFixed(4)}
                    </div>
                  </div>
                  <div>
                    <div className="font-medium">Component Renders</div>
                    <div className="text-muted-foreground">
                      {lastReport.overall.ui.componentRenderCount}
                    </div>
                  </div>
                  <div>
                    <div className="font-medium">Bundle Size</div>
                    <div className="text-muted-foreground">
                      {(lastReport.overall.ui.bundleSize / 1024).toFixed(2)} KB
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Mobile Tab */}
          <TabsContent value="mobile">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Smartphone className="h-4 w-4" />
                  Mobile Performance
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <div className="font-medium">Battery Usage</div>
                    <div className="text-muted-foreground">
                      {lastReport.mobile.batteryUsage.toFixed(1)}%
                    </div>
                  </div>
                  <div>
                    <div className="font-medium">Network Type</div>
                    <div className="text-muted-foreground">
                      {lastReport.mobile.networkType}
                    </div>
                  </div>
                  <div>
                    <div className="font-medium">Touch Latency</div>
                    <div className="text-muted-foreground">
                      {lastReport.mobile.touchLatency.toFixed(2)} ms
                    </div>
                  </div>
                  <div>
                    <div className="font-medium">Device Memory</div>
                    <div className="text-muted-foreground">
                      {lastReport.mobile.deviceMemory} GB
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}

      {/* Recommendations */}
      {lastReport && lastReport.recommendations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Performance Recommendations</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {lastReport.recommendations.map((recommendation, index) => (
                <Alert key={index}>
                  <AlertDescription>{recommendation}</AlertDescription>
                </Alert>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Detailed Report Modal */}
      {showDetailedReport && (
        <Card>
          <CardHeader>
            <CardTitle>Detailed Performance Report</CardTitle>
            <Button 
              onClick={() => setShowDetailedReport(false)}
              variant="outline"
              size="sm"
            >
              Close
            </Button>
          </CardHeader>
          <CardContent>
            <pre className="text-xs bg-muted p-4 rounded-md overflow-auto max-h-96">
              {detailedReport}
            </pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default PerformanceDashboard;