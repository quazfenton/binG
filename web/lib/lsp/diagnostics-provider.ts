/**
 * diagnostics-provider.ts — High-level diagnostic queries for LLM feedback
 *
 * Provides functions to query the diagnostic bus and format results
 * as LLM-friendly feedback strings. Used by the agent loop and VFS
 * integration to inject LSP errors into the prompt for self-correction.
 */

import { diagnosticBus, type UnifiedDiagnostic, type DiagnosticSeverity, type DiagnosticSource } from './diagnostic-bus';

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface DiagnosticSummary {
  file: string;
  errorCount: number;
  warningCount: number;
  infoCount: number;
  hintCount: number;
  /** Top N unique diagnostic messages for feedback */
  topMessages: string[];
  /** Formatted for direct injection into an LLM prompt */
  feedbackText: string;
}

export interface BatchDiagnosticSummary {
  totalErrors: number;
  totalWarnings: number;
  filesWithIssues: number;
  perFile: DiagnosticSummary[];
  feedbackText: string;
}

// ─── Defaults ──────────────────────────────────────────────────────────────────

const DEFAULT_TOP_MESSAGES = 5;
const DEFAULT_MAX_FILES = 10;

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Get a diagnostic summary for a single file, formatted for LLM feedback.
 *
 * @param filePath - Absolute or relative file path
 * @param topMessages - How many unique messages to include (default 5)
 */
export function getDiagnosticSummary(
  filePath: string,
  topMessages = DEFAULT_TOP_MESSAGES,
  source?: DiagnosticSource
): DiagnosticSummary {
  const diagnostics = diagnosticBus.getForFile(filePath, source);

  const errors = diagnostics.filter((d) => d.severity === 'error');
  const warnings = diagnostics.filter((d) => d.severity === 'warning');
  const infos = diagnostics.filter((d) => d.severity === 'info');
  const hints = diagnostics.filter((d) => d.severity === 'hint');

  const top = diagnosticBus.getCompacted(filePath, topMessages, source);
  const topMessageStrings = top.map(
    (d) => `${severityLabel(d.severity)}${d.line ? ` L${d.line}` : ''}: ${d.message}`
  );

  const feedbackText = buildSingleFileFeedback(filePath, topMessageStrings, diagnostics.length);

  return {
    file: filePath,
    errorCount: errors.length,
    warningCount: warnings.length,
    infoCount: infos.length,
    hintCount: hints.length,
    topMessages: topMessageStrings,
    feedbackText,
  };
}

/**
 * Get diagnostic summaries for multiple files.
 *
 * @param filePaths - Array of file paths to check
 * @param topMessages - How many unique messages per file
 * @param maxFiles - Max files to include in summary (avoids overwhelming the prompt)
 */
export function getBatchDiagnosticSummary(
  filePaths: string[],
  topMessages = DEFAULT_TOP_MESSAGES,
  maxFiles = DEFAULT_MAX_FILES,
  source?: DiagnosticSource
): BatchDiagnosticSummary {
  const perFile: DiagnosticSummary[] = [];
  let totalErrors = 0;
  let totalWarnings = 0;
  let filesWithIssues = 0;

  for (const fp of filePaths.slice(0, maxFiles)) {
    const summary = getDiagnosticSummary(fp, topMessages, source);
    perFile.push(summary);
    totalErrors += summary.errorCount;
    totalWarnings += summary.warningCount;
    if (summary.errorCount > 0 || summary.warningCount > 0) {
      filesWithIssues++;
    }
  }

  const feedbackText = buildBatchFeedback(perFile, totalErrors, totalWarnings, filesWithIssues);

  return { totalErrors, totalWarnings, filesWithIssues, perFile, feedbackText };
}

/**
 * Build a concise feedback string suitable for injection into an LLM prompt's
 * retry/error block. Returns an empty string if no diagnostics exist.
 */
export function buildFeedbackForPrompt(filePath: string, source?: DiagnosticSource): string {
  const summary = getDiagnosticSummary(filePath, DEFAULT_TOP_MESSAGES, source);
  if (summary.errorCount === 0 && summary.warningCount === 0) return '';
  return summary.feedbackText;
}

/**
 * Build a feedback string for multiple files.
 */
export function buildBatchFeedbackForPrompt(filePaths: string[], source?: DiagnosticSource): string {
  const summary = getBatchDiagnosticSummary(filePaths, DEFAULT_TOP_MESSAGES, DEFAULT_MAX_FILES, source);
  if (summary.totalErrors === 0 && summary.totalWarnings === 0) return '';
  return summary.feedbackText;
}

// ─── Formatters ────────────────────────────────────────────────────────────────

function severityLabel(s: DiagnosticSeverity): string {
  switch (s) {
    case 'error': return 'ERROR';
    case 'warning': return 'WARN';
    case 'info': return 'INFO';
    case 'hint': return 'HINT';
  }
}

function buildSingleFileFeedback(
  filePath: string,
  messages: string[],
  totalCount: number
): string {
  if (messages.length === 0) return '';

  const shortPath = filePath.replace(/^.*[/\\]/, '');
  let text = `## LSP Diagnostics for ${shortPath}`;

  if (totalCount > messages.length) {
    text += ` (${totalCount} total, showing top ${messages.length})`;
  }
  text += '\n';

  for (const msg of messages) {
    text += `- ${msg}\n`;
  }

  text += `\nFix these issues before the code is considered valid.`;

  return text;
}

function buildBatchFeedback(
  perFile: DiagnosticSummary[],
  totalErrors: number,
  totalWarnings: number,
  filesWithIssues: number
): string {
  if (filesWithIssues === 0) return '';

  let text = '## LSP Diagnostics Summary\n';
  text += `- ${totalErrors} error(s), ${totalWarnings} warning(s) across ${filesWithIssues} file(s)\n\n`;

  for (const sf of perFile) {
    if (sf.errorCount === 0 && sf.warningCount === 0) continue;
    const shortPath = sf.file.replace(/^.*[/\\]/, '');
    text += `### ${shortPath} (${sf.errorCount} errors, ${sf.warningCount} warnings)\n`;
    for (const msg of sf.topMessages) {
      text += `- ${msg}\n`;
    }
    text += '\n';
  }

  if (totalErrors > 0) {
    text += 'Fix all errors before the code is considered valid.';
  }

  return text;
}
