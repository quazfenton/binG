"use client";

import React, { useState, useEffect } from 'react';
import { Button } from '../ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Textarea } from '../ui/textarea';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '../ui/chart';
import { Bar, BarChart, CartesianGrid, Line, LineChart, Pie, PieChart, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface DataVisualizationBuilderPluginProps {
  onClose: () => void;
  onResult?: (result: any) => void;
}

const sampleData = {
  "bar-chart": JSON.stringify([
    { "label": "A", "value": 10 },
    { "label": "B", "value": 20 },
    { "label": "C", "value": 15 }
  ], null, 2),
  "line-chart": JSON.stringify([
    { "label": "Page A", "value": 2400 },
    { "label": "Page B", "value": 1398 },
    { "label": "Page C", "value": 9800 }
  ], null, 2),
  "pie-chart": JSON.stringify([
    { "name": "Group A", "value": 400 },
    { "name": "Group B", "value": 300 },
    { "name": "Group C", "value": 300 }
  ], null, 2),
};

const DataVisualizationBuilderPlugin: React.FC<DataVisualizationBuilderPluginProps> = ({ onClose, onResult }) => {
  const [chartType, setChartType] = useState('bar-chart');
  const [chartData, setChartData] = useState(sampleData['bar-chart']);
  const [chartTitle, setChartTitle] = useState('Sample Bar Chart');
  const [error, setError] = useState<string | null>(null);
  const [parsedChartData, setParsedChartData] = useState<any[]>([]);

  useEffect(() => {
    try {
      const parsed = JSON.parse(chartData);
      if (!Array.isArray(parsed)) {
        setError('Data must be a JSON array.');
        setParsedChartData([]);
        return;
      }
      // Basic validation for chart data structure
      if (chartType === 'bar-chart' || chartType === 'line-chart') {
        if (!parsed.every(item => typeof item === 'object' && item !== null && 'label' in item && 'value' in item)) {
          setError('For bar/line charts, each item in data array must have "label" and "value" properties.');
          setParsedChartData([]);
          return;
        }
      } else if (chartType === 'pie-chart') {
        if (!parsed.every(item => typeof item === 'object' && item !== null && 'name' in item && 'value' in item)) {
          setError('For pie charts, each item in data array must have "name" and "value" properties.');
          setParsedChartData([]);
          return;
        }
      }
      setError(null);
      setParsedChartData(parsed);
    } catch (e) {
      setError('Invalid JSON format.');
      setParsedChartData([]);
    }
  }, [chartData, chartType]);

  const chartConfig = {
    value: {
      label: "Value",
      color: "hsl(var(--chart-1))",
    },
    label: {
      label: "Label",
      color: "hsl(var(--chart-2))",
    },
    name: {
      label: "Name",
      color: "hsl(var(--chart-3))",
    },
  };

  const handleInsertVisualization = () => {
    if (error) {
      alert('Please fix the errors before inserting the visualization.');
      return;
    }
    const vizData = {
      type: chartType,
      title: chartTitle,
      data: JSON.parse(chartData),
      description: `${chartTitle}: A ${chartType} visualization.`,
    };
    onResult?.({
      content: `Here is the visualization data: \`\`\`json\n${JSON.stringify(vizData, null, 2)}\n\`\`\``,
    });
    onClose();
  };

  const handleChartTypeChange = (type: string) => {
    setChartType(type);
    setChartData(sampleData[type as keyof typeof sampleData] || '');
    setChartTitle(`Sample ${type.charAt(0).toUpperCase() + type.slice(1)}`);
  };

  return (
    <div className="p-4 bg-gray-900 text-white h-full flex flex-col">
      <h2 className="text-lg font-bold mb-4">Data Visualization Builder</h2>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 flex-grow">
        <div className="flex flex-col gap-4">
          <div>
            <Label htmlFor="chart-type">Chart Type</Label>
            <Select value={chartType} onValueChange={handleChartTypeChange}>
              <SelectTrigger id="chart-type">
                <SelectValue placeholder="Select chart type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="bar-chart">Bar Chart</SelectItem>
                <SelectItem value="line-chart">Line Chart</SelectItem>
                <SelectItem value="pie-chart">Pie Chart</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="chart-title">Chart Title</Label>
            <Input 
              id="chart-title" 
              value={chartTitle} 
              onChange={(e) => setChartTitle(e.target.value)}
              placeholder="Enter chart title"
            />
          </div>
          <div>
            <Label htmlFor="chart-data">Data (JSON)</Label>
            <Textarea
              id="chart-data"
              value={chartData}
              onChange={(e) => setChartData(e.target.value)}
              className="h-48 font-mono"
              placeholder="Enter valid JSON data"
            />
            {error && <p className="text-red-500 text-sm mt-1">{error}</p>}
          </div>
        </div>
        <div className="bg-gray-800 border border-gray-700 rounded-lg p-4 flex flex-col">
          <h3 className="text-md font-bold mb-2">Live Preview</h3>
          <div className="flex-grow bg-gray-700 rounded p-2 overflow-auto flex items-center justify-center">
            {error ? (
              <p className="text-red-400 text-center">Cannot render preview due to data errors.</p>
            ) : (
              <ChartContainer config={chartConfig} className="min-h-[200px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <>
                    {chartType === 'bar-chart' && (
                      <BarChart data={parsedChartData}>
                        <CartesianGrid vertical={false} />
                        <XAxis dataKey="label" tickLine={false} tickMargin={10} axisLine={false} />
                        <YAxis tickLine={false} tickMargin={10} axisLine={false} />
                        <Tooltip content={<ChartTooltipContent />} />
                        <Bar dataKey="value" fill="var(--color-value)" radius={4} />
                      </BarChart>
                    )}
                    {chartType === 'line-chart' && (
                      <LineChart data={parsedChartData}>
                        <CartesianGrid vertical={false} />
                        <XAxis dataKey="label" tickLine={false} tickMargin={10} axisLine={false} />
                        <YAxis tickLine={false} tickMargin={10} axisLine={false} />
                        <Tooltip content={<ChartTooltipContent />} />
                        <Line type="monotone" dataKey="value" stroke="var(--color-value)" strokeWidth={2} dot={{ r: 6 }} />
                      </LineChart>
                    )}
                    {chartType === 'pie-chart' && (
                      <PieChart>
                        <Tooltip content={<ChartTooltipContent nameKey="name" />} />
                        <Pie
                          data={parsedChartData}
                          dataKey="value"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          outerRadius={80}
                          fill="#8884d8"
                          label
                        />
                      </PieChart>
                    )}
                  </>
                </ResponsiveContainer>
              </ChartContainer>
            )}
          </div>
        </div>
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={handleInsertVisualization} disabled={!!error}>Insert Visualization</Button>
      </div>
    </div>
  );
};

export default DataVisualizationBuilderPlugin;
