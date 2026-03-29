/**
 * Data Analysis Workflow
 *
 * Workflow for analyzing datasets, generating insights, and creating visualizations.
 * Implements data loader → validator → analyzer → visualizer pattern.
 *
 * @module orchestra/mastra/workflows/data-analysis-workflow
 */

import { createWorkflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { getModel } from '../models/model-router';

// ===========================================
// Schema Definitions
// ===========================================

export const DataAnalysisInput = z.object({
  dataset: z.string().describe('Dataset description or path'),
  questions: z.array(z.string()).describe('Analysis questions'),
  format: z.enum(['csv', 'json', 'sql', 'excel']).default('csv'),
  ownerId: z.string(),
});

export const DataProfile = z.object({
  rowCount: z.number(),
  columnCount: z.number(),
  columns: z.array(z.object({
    name: z.string(),
    type: z.string(),
    nullCount: z.number(),
    uniqueCount: z.number(),
    description: z.string().optional(),
  })),
  quality: z.number().min(0).max(1),
  issues: z.array(z.string()),
});

export const AnalysisResult = z.object({
  insights: z.array(z.string()),
  statistics: z.record(z.any()),
  correlations: z.array(z.object({
    variables: z.array(z.string()),
    correlation: z.number(),
    significance: z.string(),
  })),
  anomalies: z.array(z.object({
    description: z.string(),
    severity: z.enum(['low', 'medium', 'high']),
    affectedRows: z.number(),
  })),
});

export const VisualizationSpec = z.object({
  charts: z.array(z.object({
    type: z.enum(['bar', 'line', 'scatter', 'pie', 'heatmap']),
    title: z.string(),
    data: z.string(),
    xField: z.string(),
    yField: z.string().optional(),
    colorField: z.string().optional(),
    description: z.string(),
  })),
  recommendations: z.array(z.string()),
});

// ===========================================
// Step Definitions
// ===========================================

/**
 * Step 1: Data Profiler
 *
 * Profiles dataset structure and quality
 */
export const dataProfilerStep = createStep({
  id: 'data-profiler',
  inputSchema: DataAnalysisInput,
  outputSchema: z.object({
    profile: DataProfile,
    ownerId: z.string(),
  }),
  execute: async ({ inputData }) => {
    const { dataset, format, ownerId } = inputData;
    const agent = getModel('reasoning');

    const response = await agent.generate([
      {
        role: 'system',
        content: `You are a data profiling agent. Analyze the dataset structure and quality.

Output JSON format:
{
  "rowCount": 1000,
  "columnCount": 10,
  "columns": [
    {
      "name": "column_name",
      "type": "string | number | boolean | date",
      "nullCount": 5,
      "uniqueCount": 100,
      "description": "Column description"
    }
  ],
  "quality": 0.85,
  "issues": ["Issue 1", "Issue 2"]
}`,
      },
      { role: 'user', content: `Dataset: ${dataset}\nFormat: ${format}` },
    ]);

    const profile = JSON.parse(response.text.trim());

    return { profile, ownerId };
  },
  retries: 2,
});

/**
 * Step 2: Statistical Analyzer
 *
 * Performs statistical analysis on the dataset
 */
export const statisticalAnalyzerStep = createStep({
  id: 'statistical-analyzer',
  inputSchema: z.object({
    questions: z.array(z.string()),
    profile: DataProfile,
    ownerId: z.string(),
  }),
  outputSchema: z.object({
    result: AnalysisResult,
  }),
  execute: async ({ inputData }) => {
    const { questions, profile, ownerId } = inputData;
    const agent = getModel('reasoning');

    const response = await agent.generate([
      {
        role: 'system',
        content: `You are a statistical analysis agent. Analyze the data profile and answer research questions.

Output JSON format:
{
  "insights": ["Insight 1", "Insight 2"],
  "statistics": {
    "mean": 50.5,
    "median": 48,
    "stdDev": 12.3
  },
  "correlations": [
    {
      "variables": ["var1", "var2"],
      "correlation": 0.75,
      "significance": "strong positive"
    }
  ],
  "anomalies": [
    {
      "description": "Outlier in column X",
      "severity": "medium",
      "affectedRows": 5
    }
  ]
}`,
      },
      { role: 'user', content: `Questions: ${questions.join('\n')}\n\nData Profile: ${JSON.stringify(profile, null, 2)}` },
    ]);

    const result = JSON.parse(response.text.trim());

    return { result };
  },
  retries: 2,
});

/**
 * Step 3: Visualization Designer
 *
 * Creates visualization specifications based on analysis
 */
export const visualizationDesignerStep = createStep({
  id: 'visualization-designer',
  inputSchema: z.object({
    questions: z.array(z.string()),
    profile: DataProfile,
    analysis: AnalysisResult,
  }),
  outputSchema: z.object({
    specs: VisualizationSpec,
  }),
  execute: async ({ inputData }) => {
    const { questions, profile, analysis } = inputData;
    const agent = getModel('reasoning');

    const response = await agent.generate([
      {
        role: 'system',
        content: `You are a visualization design agent. Create visualization specifications based on the analysis.

Output JSON format:
{
  "charts": [
    {
      "type": "bar | line | scatter | pie | heatmap",
      "title": "Chart Title",
      "data": "data_source",
      "xField": "x_axis_field",
      "yField": "y_axis_field",
      "colorField": "color_field (optional)",
      "description": "What this chart shows"
    }
  ],
  "recommendations": ["Recommendation 1", "Recommendation 2"]
}

Choose chart types appropriately:
- Bar charts for categorical comparisons
- Line charts for trends over time
- Scatter plots for correlations
- Pie charts for proportions (limited categories)
- Heatmaps for matrix data`,
      },
      { role: 'user', content: `Questions: ${questions.join('\n')}\n\nProfile: ${JSON.stringify(profile, null, 2)}\n\nAnalysis: ${JSON.stringify(analysis, null, 2)}` },
    ]);

    const specs = JSON.parse(response.text.trim());

    return { specs };
  },
  retries: 2,
});

/**
 * Step 4: Report Generator
 *
 * Generates comprehensive analysis report
 */
export const reportGeneratorStep = createStep({
  id: 'report-generator',
  inputSchema: z.object({
    dataset: z.string(),
    questions: z.array(z.string()),
    profile: DataProfile,
    analysis: AnalysisResult,
    visualizations: VisualizationSpec,
  }),
  outputSchema: z.object({
    report: z.string(),
    executiveSummary: z.string(),
  }),
  execute: async ({ inputData }) => {
    const { dataset, questions, profile, analysis, visualizations } = inputData;
    const agent = getModel('reasoning');

    const response = await agent.generate([
      {
        role: 'system',
        content: `You are a report generation agent. Create a comprehensive data analysis report.

Generate a markdown report with:
# Data Analysis Report

## Executive Summary
(Brief overview)

## Dataset Overview
(Description and quality assessment)

## Key Findings
(Bulleted insights)

## Statistical Analysis
(Detailed statistics)

## Visualizations
(Chart descriptions)

## Recommendations
(Actionable recommendations)

## Limitations
(Analysis limitations)`,
      },
      { role: 'user', content: `Dataset: ${dataset}\nQuestions: ${questions.join('\n')}\n\nProfile: ${JSON.stringify(profile, null, 2)}\n\nAnalysis: ${JSON.stringify(analysis, null, 2)}\n\nVisualizations: ${JSON.stringify(visualizations, null, 2)}` },
    ]);

    // Extract executive summary (first section)
    const executiveSummary = response.text.split('##')[1]?.split('\n').slice(1, 4).join('\n') || response.text.slice(0, 500);

    return {
      report: response.text,
      executiveSummary: executiveSummary.trim(),
    };
  },
  retries: 2,
});

// ===========================================
// Workflow Definition
// ===========================================

export const dataAnalysisWorkflow = createWorkflow({
  id: 'data-analysis',
  name: 'Data Analysis Workflow',
  inputSchema: DataAnalysisInput,
  outputSchema: z.object({
    profile: DataProfile,
    analysis: AnalysisResult,
    visualizations: VisualizationSpec,
    report: z.string(),
    executiveSummary: z.string(),
  }),
  retryConfig: {
    attempts: 2,
    delay: 1000,
  },
})
  .then(dataProfilerStep)
  .then(statisticalAnalyzerStep)
  .then(visualizationDesignerStep)
  .then(reportGeneratorStep)
  .commit();

export function getDataAnalysisWorkflow() {
  return dataAnalysisWorkflow;
}
