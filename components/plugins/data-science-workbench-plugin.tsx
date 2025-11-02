"use client";

import React, { useState } from 'react';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { 
  BarChart, LineChart, PieChart, Upload, Download, Play,
  Loader2, XCircle, Table, TrendingUp, Brain, Database
} from 'lucide-react';
import type { PluginProps } from './plugin-manager';
import { toast } from 'sonner';

interface DataRow {
  [key: string]: string | number;
}

interface Statistics {
  mean: number;
  median: number;
  stdDev: number;
  min: number;
  max: number;
  count: number;
}

export default function DataScienceWorkbenchPlugin({ onClose }: PluginProps) {
  const [data, setData] = useState<DataRow[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [chartType, setChartType] = useState<'bar' | 'line' | 'scatter' | 'pie'>('bar');
  const [selectedColumn, setSelectedColumn] = useState<string>('');
  const [statistics, setStatistics] = useState<Record<string, Statistics>>({});
  const [loading, setLoading] = useState(false);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      parseCSV(text);
    };
    reader.readAsText(file);
  };

  const parseCSV = (text: string) => {
    const lines = text.split('\n').filter(l => l.trim());
    if (lines.length < 2) return;

    const headers = lines[0].split(',').map(h => h.trim());
    setColumns(headers);

    const rows: DataRow[] = lines.slice(1).map(line => {
      const values = line.split(',');
      const row: DataRow = {};
      headers.forEach((header, i) => {
        const value = values[i]?.trim();
        row[header] = isNaN(Number(value)) ? value : Number(value);
      });
      return row;
    });

    setData(rows);
    calculateStatistics(rows, headers);
    toast.success(`Loaded ${rows.length} rows`);
  };

  const calculateStatistics = (rows: DataRow[], cols: string[]) => {
    const stats: Record<string, Statistics> = {};

    cols.forEach(col => {
      const values = rows.map(r => r[col]).filter(v => typeof v === 'number') as number[];
      if (values.length === 0) return;

      const sorted = [...values].sort((a, b) => a - b);
      const sum = values.reduce((a, b) => a + b, 0);
      const mean = sum / values.length;
      const median = sorted[Math.floor(sorted.length / 2)];
      const variance = values.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / values.length;
      const stdDev = Math.sqrt(variance);

      stats[col] = {
        mean,
        median,
        stdDev,
        min: Math.min(...values),
        max: Math.max(...values),
        count: values.length
      };
    });

    setStatistics(stats);
  };

  const trainModel = async () => {
    setLoading(true);
    try {
      // Simulate model training
      await new Promise(resolve => setTimeout(resolve, 2000));
      toast.success('Model trained successfully');
    } catch (err) {
      toast.error('Training failed');
    } finally {
      setLoading(false);
    }
  };

  const exportData = () => {
    const csv = [
      columns.join(','),
      ...data.map(row => columns.map(col => row[col]).join(','))
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'data.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success('Data exported');
  };

  return (
    <div className="h-full flex flex-col bg-black text-white">
      <CardHeader className="border-b border-white/10">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-purple-400" />
            Data Science Workbench
          </CardTitle>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <XCircle className="w-4 h-4" />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="flex-1 overflow-auto p-4">
        <Tabs defaultValue="data" className="w-full">
          <TabsList className="grid grid-cols-4 w-full">
            <TabsTrigger value="data"><Database className="w-4 h-4 mr-1" /> Data</TabsTrigger>
            <TabsTrigger value="stats"><BarChart className="w-4 h-4 mr-1" /> Stats</TabsTrigger>
            <TabsTrigger value="viz"><PieChart className="w-4 h-4 mr-1" /> Visualize</TabsTrigger>
            <TabsTrigger value="ml"><Brain className="w-4 h-4 mr-1" /> ML</TabsTrigger>
          </TabsList>

          <TabsContent value="data" className="space-y-3 pt-4">
            <div className="flex gap-2">
              <label className="flex-1">
                <Button variant="outline" className="w-full" as="span">
                  <Upload className="w-4 h-4 mr-2" />
                  Upload CSV
                </Button>
                <input type="file" accept=".csv" onChange={handleFileUpload} className="hidden" />
              </label>
              <Button variant="outline" onClick={exportData} disabled={data.length === 0}>
                <Download className="w-4 h-4 mr-2" />
                Export
              </Button>
            </div>

            {data.length > 0 && (
              <Card className="bg-white/5">
                <CardContent className="p-3">
                  <div className="text-sm text-gray-400 mb-2">
                    {data.length} rows × {columns.length} columns
                  </div>
                  <div className="overflow-auto max-h-96">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-white/10">
                          {columns.map(col => (
                            <th key={col} className="text-left p-2">{col}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {data.slice(0, 20).map((row, i) => (
                          <tr key={i} className="border-b border-white/5">
                            {columns.map(col => (
                              <td key={col} className="p-2">{String(row[col])}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="stats" className="pt-4">
            <div className="grid grid-cols-2 gap-3">
              {Object.entries(statistics).map(([col, stats]) => (
                <Card key={col} className="bg-white/5">
                  <CardHeader className="p-3">
                    <CardTitle className="text-sm">{col}</CardTitle>
                  </CardHeader>
                  <CardContent className="p-3 text-xs space-y-1">
                    <div className="flex justify-between">
                      <span className="text-gray-400">Mean:</span>
                      <span>{stats.mean.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Median:</span>
                      <span>{stats.median.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Std Dev:</span>
                      <span>{stats.stdDev.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Min/Max:</span>
                      <span>{stats.min.toFixed(2)} / {stats.max.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Count:</span>
                      <span>{stats.count}</span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="viz" className="space-y-3 pt-4">
            <div className="flex gap-2">
              <Select value={chartType} onValueChange={(v: any) => setChartType(v)}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="bar">Bar Chart</SelectItem>
                  <SelectItem value="line">Line Chart</SelectItem>
                  <SelectItem value="scatter">Scatter Plot</SelectItem>
                  <SelectItem value="pie">Pie Chart</SelectItem>
                </SelectContent>
              </Select>
              <Select value={selectedColumn} onValueChange={setSelectedColumn}>
                <SelectTrigger className="flex-1"><SelectValue placeholder="Select column" /></SelectTrigger>
                <SelectContent>
                  {columns.map(col => (
                    <SelectItem key={col} value={col}>{col}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Card className="bg-white/5">
              <CardContent className="p-4 h-96 flex items-center justify-center">
                <div className="text-center text-gray-400">
                  <PieChart className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>Chart visualization placeholder</p>
                  <p className="text-xs mt-2">Select a column and chart type to visualize</p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="ml" className="space-y-3 pt-4">
            <Card className="bg-white/5">
              <CardHeader className="p-3">
                <CardTitle className="text-sm">Train Model</CardTitle>
              </CardHeader>
              <CardContent className="p-3 space-y-3">
                <Select>
                  <SelectTrigger><SelectValue placeholder="Select algorithm" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="linear">Linear Regression</SelectItem>
                    <SelectItem value="logistic">Logistic Regression</SelectItem>
                    <SelectItem value="kmeans">K-Means Clustering</SelectItem>
                    <SelectItem value="rf">Random Forest</SelectItem>
                  </SelectContent>
                </Select>

                <Button onClick={trainModel} disabled={loading || data.length === 0} className="w-full">
                  {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
                  Train Model
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </CardContent>
    </div>
  );
}
