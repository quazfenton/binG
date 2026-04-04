/**
 * Response Style Selector
 *
 * Compact pill-based UI for selecting response style presets and custom parameters.
 * Features:
 * - Visual indicator when non-default params are active (Sparkles icon)
 * - Keyboard shortcut hints on preset pills (⌘1..9, ⌘0)
 * - Full customization popover with all parameter controls
 * - Export/import configuration
 * - Undo/redo support
 *
 * Usage:
 * ```tsx
 * import { ResponseStyleSelector } from '@/components/response-style-selector';
 *
 * // Compact form (default in toolbar):
 * <ResponseStyleSelector compact />
 *
 * // Full form (in settings or standalone):
 * <ResponseStyleSelector />
 * ```
 */

'use client';

import React, { useState, useCallback } from 'react';
import {
  PROMPT_PRESETS,
  PromptPresetKey,
  ResponseDepth,
  ExpertiseLevel,
  Tone,
  ReasoningMode,
  CreativityLevel,
  CitationStrictness,
  SelfCorrection,
  ConfidenceExpression,
  OutputFormat,
  type PromptParameters,
} from '@bing/shared/agent/prompt-parameters';
import { useResponseStyle } from '@/contexts/response-style-context';
import { cn } from '@/lib/utils';
import {
  ChevronDown,
  Settings2,
  X,
  Sparkles,
  Upload,
  Download,
  Undo2,
  Redo2,
  Copy,
} from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SelectSeparator,
} from '@/components/ui/select';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { clipboard } from "@bing/platform/clipboard";

/** Preset display metadata with keyboard shortcut hints */
const PRESET_DISPLAY: Record<PromptPresetKey, {
  label: string;
  icon: string;
  description: string;
  shortcut: string;
}> = {
  QuickAnswer: { label: 'Quick', icon: '⚡', description: 'Fast, minimal response', shortcut: '⌘1' },
  ExpertBrief: { label: 'Expert Brief', icon: '🎯', description: 'Short, expert-level answer', shortcut: '⌘2' },
  StandardProfessional: { label: 'Standard', icon: '💬', description: 'Balanced professional response', shortcut: '⌘3' },
  DeepExpertAnalysis: { label: 'Deep', icon: '🔬', description: 'Comprehensive expert analysis', shortcut: '⌘4' },
  MaximumRigor: { label: 'Maximum', icon: '🏛️', description: 'Peer-review level rigor', shortcut: '⌘5' },
  CasualExplanation: { label: 'Casual', icon: '😊', description: 'Friendly, beginner-friendly', shortcut: '⌘6' },
  Brainstorming: { label: 'Brainstorm', icon: '💡', description: 'Creative, exploratory ideas', shortcut: '⌘7' },
  ExecutiveSummary: { label: 'Executive', icon: '📊', description: 'Decision-maker brief', shortcut: '⌘8' },
  Teaching: { label: 'Teaching', icon: '📚', description: 'Step-by-step explanation', shortcut: '⌘9' },
  ResearchAssistant: { label: 'Research', icon: '🔍', description: 'Maximum thoroughness', shortcut: '—' },
};

/** Ordered preset keys for consistent display */
const PRESET_ORDER: PromptPresetKey[] = [
  'QuickAnswer',
  'ExpertBrief',
  'StandardProfessional',
  'DeepExpertAnalysis',
  'MaximumRigor',
  'CasualExplanation',
  'Brainstorming',
  'ExecutiveSummary',
  'Teaching',
  'ResearchAssistant',
];

interface ResponseStyleSelectorProps {
  className?: string;
  compact?: boolean;
}

export function ResponseStyleSelector({ className, compact = false }: ResponseStyleSelectorProps) {
  const {
    params,
    setPreset,
    presetKey,
    hasActiveModifiers,
    reset,
    updateParam,
    promptSuffix,
    debugHeader,
    undo,
    redo,
    canUndo,
    canRedo,
    exportConfig,
    importConfig,
    encodedParams,
  } = useResponseStyle();
  const [customOpen, setCustomOpen] = useState(false);

  const handlePresetChange = useCallback((value: string) => {
    if (value === '__none__') {
      reset();
    } else {
      setPreset(value as PromptPresetKey);
    }
    setCustomOpen(false);
  }, [setPreset, reset]);

  const handleExport = useCallback(() => {
    const json = exportConfig();
    clipboard.writeText(json).then(() => {
      toast.success('Configuration copied to clipboard');
    }).catch(() => {
      // Fallback: download as file
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'response-style-config.json';
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Configuration downloaded');
    });
  }, [exportConfig]);

  const handleImport = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const json = reader.result as string;
        if (importConfig(json)) {
          toast.success('Configuration imported');
        } else {
          toast.error('Invalid configuration file');
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }, [importConfig]);

  const handleShareLink = useCallback(() => {
    if (!encodedParams) {
      toast.info('No custom settings to share — using default style');
      return;
    }
    const url = `${window.location.origin}${window.location.pathname}?style=${encodedParams}`;
    clipboard.writeText(url).then(() => {
      toast.success('Shareable link copied to clipboard');
    }).catch(() => {
      toast.error('Failed to copy link');
    });
  }, [encodedParams]);

  // Detect platform for keyboard shortcut display
  const isMac = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  const modKey = isMac ? '⌘' : 'Ctrl';

  if (compact) {
    return (
      <div className={cn('flex items-center gap-1', className)}>
        {/* Active preset pill */}
        {presetKey ? (
          <button
            onClick={() => setCustomOpen(true)}
            className={cn(
              'inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-md transition-colors',
              'bg-primary/10 text-primary hover:bg-primary/20'
            )}
            title={PRESET_DISPLAY[presetKey].description}
          >
            <span>{PRESET_DISPLAY[presetKey].icon}</span>
            <span className="font-medium">{PRESET_DISPLAY[presetKey].label}</span>
            {hasActiveModifiers && <Sparkles className="h-3 w-3 ml-0.5" />}
          </button>
        ) : hasActiveModifiers ? (
          <button
            onClick={() => setCustomOpen(true)}
            className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-md bg-accent/50 text-accent-foreground hover:bg-accent"
            title="Custom response style active"
          >
            <Sparkles className="h-3 w-3" />
            <span className="font-medium">Custom</span>
          </button>
        ) : (
          <button
            onClick={() => setCustomOpen(true)}
            className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/50"
            title="Response style (default)"
          >
            <Settings2 className="h-3 w-3" />
            <span>Style</span>
          </button>
        )}

        {/* Quick undo */}
        {canUndo && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={undo}
            title={`Undo (${modKey}+Z)`}
          >
            <Undo2 className="h-3 w-3" />
          </Button>
        )}

        {/* Popover for full settings */}
        <Popover open={customOpen} onOpenChange={setCustomOpen}>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" className="h-6 w-6">
              <ChevronDown className="h-3 w-3" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-72 p-4" align="end">
            <CompactSettings
              params={params}
              presetKey={presetKey}
              updateParam={updateParam}
              setPreset={setPreset}
              reset={reset}
              undo={undo}
              redo={redo}
              canUndo={canUndo}
              canRedo={canRedo}
              handleExport={handleExport}
              handleImport={handleImport}
              handleShareLink={handleShareLink}
              encodedParams={encodedParams}
              debugHeader={debugHeader}
            />
          </PopoverContent>
        </Popover>
      </div>
    );
  }

  // Full (non-compact) mode
  return (
    <div className={cn('space-y-4', className)}>
      {/* Preset Pills Row */}
      <div>
        <Label className="text-xs text-muted-foreground mb-2 block">Response Style</Label>
        <div className="flex flex-wrap gap-1.5">
          {PRESET_ORDER.map((key) => (
            <button
              key={key}
              onClick={() => setPreset(key)}
              className={cn(
                'px-3 py-1.5 text-xs rounded-lg transition-all flex items-center gap-1.5',
                'border',
                presetKey === key
                  ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                  : 'bg-background text-muted-foreground hover:text-foreground hover:border-border hover:bg-accent/50'
              )}
              title={`${PRESET_DISPLAY[key].description} (${PRESET_DISPLAY[key].shortcut})`}
            >
              <span className="text-sm">{PRESET_DISPLAY[key].icon}</span>
              <span className="font-medium">{PRESET_DISPLAY[key].label}</span>
              <span className={cn(
                'text-[10px] ml-auto opacity-50',
                presetKey === key ? 'text-primary-foreground/70' : 'text-muted-foreground'
              )}>
                {PRESET_DISPLAY[key].shortcut}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Custom Parameters */}
      <div className="space-y-3 pt-3 border-t">
        <div className="flex items-center justify-between">
          <Label className="text-xs text-muted-foreground">Custom Parameters</Label>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={undo} disabled={!canUndo}>
              <Undo2 className="h-3 w-3 mr-1" /> Undo
            </Button>
            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={redo} disabled={!canRedo}>
              <Redo2 className="h-3 w-3 mr-1" /> Redo
            </Button>
            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={reset} disabled={!hasActiveModifiers && !presetKey}>
              <X className="h-3 w-3 mr-1" /> Reset
            </Button>
          </div>
        </div>

        <ParameterSelect
          label="Depth"
          value={params.responseDepth || ''}
          onChange={(v) => updateParam('responseDepth', v as ResponseDepth)}
          options={[
            { value: '', label: 'Default' },
            { value: ResponseDepth.Minimal, label: 'Minimal (1-3 sentences)' },
            { value: ResponseDepth.Brief, label: 'Brief (~1 paragraph)' },
            { value: ResponseDepth.Detailed, label: 'Detailed (~1 page)' },
            { value: ResponseDepth.Comprehensive, label: 'Comprehensive (multi-section)' },
            { value: ResponseDepth.Exhaustive, label: 'Exhaustive (leave no stone unturned)' },
          ]}
        />

        <ParameterSelect
          label="Expertise"
          value={params.expertiseLevel || ''}
          onChange={(v) => updateParam('expertiseLevel', v as ExpertiseLevel)}
          options={[
            { value: '', label: 'Default' },
            { value: ExpertiseLevel.Layperson, label: 'Layperson (explain all terms)' },
            { value: ExpertiseLevel.Informed, label: 'Informed (general knowledge)' },
            { value: ExpertiseLevel.Practitioner, label: 'Practitioner (working knowledge)' },
            { value: ExpertiseLevel.Expert, label: 'Expert (deep domain knowledge)' },
            { value: ExpertiseLevel.WorldClass, label: 'World-Class (peer-level)' },
          ]}
        />

        <ParameterSelect
          label="Tone"
          value={params.tone || ''}
          onChange={(v) => updateParam('tone', v as Tone)}
          options={[
            { value: '', label: 'Default' },
            { value: Tone.Formal, label: 'Formal (academic)' },
            { value: Tone.Professional, label: 'Professional (business)' },
            { value: Tone.Conversational, label: 'Conversational (natural)' },
            { value: Tone.Casual, label: 'Casual (relaxed)' },
            { value: Tone.Authoritative, label: 'Authoritative (decisive)' },
            { value: Tone.Tentative, label: 'Tentative (careful)' },
          ]}
        />

        <ParameterSelect
          label="Reasoning"
          value={params.reasoningMode || ''}
          onChange={(v) => updateParam('reasoningMode', v as ReasoningMode)}
          options={[
            { value: '', label: 'Default' },
            { value: ReasoningMode.Direct, label: 'Direct (answer immediately)' },
            { value: ReasoningMode.Structured, label: 'Structured (clear sections)' },
            { value: ReasoningMode.Analytical, label: 'Analytical (break down components)' },
            { value: ReasoningMode.Deliberative, label: 'Deliberative (step-by-step)' },
            { value: ReasoningMode.Dialectical, label: 'Dialectical (thesis/antithesis/synthesis)' },
            { value: ReasoningMode.Socratic, label: 'Socratic (question assumptions)' },
          ]}
        />

        <ParameterSelect
          label="Creativity"
          value={params.creativityLevel || ''}
          onChange={(v) => updateParam('creativityLevel', v as CreativityLevel)}
          options={[
            { value: '', label: 'Default' },
            { value: CreativityLevel.StrictlyFactual, label: 'Strictly factual' },
            { value: CreativityLevel.EvidenceBased, label: 'Evidence-based' },
            { value: CreativityLevel.Balanced, label: 'Balanced' },
            { value: CreativityLevel.Exploratory, label: 'Exploratory (hypotheses OK)' },
            { value: CreativityLevel.Creative, label: 'Creative (brainstorming)' },
          ]}
        />

        <ParameterSelect
          label="Citations"
          value={params.citationStrictness || ''}
          onChange={(v) => updateParam('citationStrictness', v as CitationStrictness)}
          options={[
            { value: '', label: 'Default' },
            { value: CitationStrictness.None, label: 'None' },
            { value: CitationStrictness.KeyClaims, label: 'Key claims only' },
            { value: CitationStrictness.AllClaims, label: 'All claims sourced' },
            { value: CitationStrictness.Academic, label: 'Academic citations' },
          ]}
        />

        <ParameterSelect
          label="Self-Correction"
          value={params.selfCorrection || ''}
          onChange={(v) => updateParam('selfCorrection', v as SelfCorrection)}
          options={[
            { value: '', label: 'Default' },
            { value: SelfCorrection.None, label: 'None' },
            { value: SelfCorrection.Light, label: 'Light sanity check' },
            { value: SelfCorrection.Thorough, label: 'Thorough review' },
            { value: SelfCorrection.Iterative, label: 'Draft → critique → revise' },
          ]}
        />

        <ParameterSelect
          label="Output Format"
          value={params.outputFormat || ''}
          onChange={(v) => updateParam('outputFormat', v as OutputFormat)}
          options={[
            { value: '', label: 'Default (mixed)' },
            { value: OutputFormat.Prose, label: 'Prose only' },
            { value: OutputFormat.Bulleted, label: 'Bullet points' },
            { value: OutputFormat.Tabular, label: 'Tables' },
            { value: OutputFormat.Outline, label: 'Hierarchical outline' },
            { value: OutputFormat.JSON, label: 'JSON' },
          ]}
        />
      </div>

      {/* Import/Export/Share */}
      <div className="flex items-center gap-2 pt-3 border-t">
        <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={handleExport}>
          <Download className="h-3 w-3" /> Export
        </Button>
        <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={handleImport}>
          <Upload className="h-3 w-3" /> Import
        </Button>
        <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={handleShareLink}>
          <Copy className="h-3 w-3" /> Share Link
        </Button>
        {debugHeader !== 'default' && (
          <span className="text-[10px] text-muted-foreground ml-auto font-mono" title="Active response style parameters">
            {debugHeader}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Compact settings panel for popover
 */
function CompactSettings({
  params,
  presetKey,
  updateParam,
  setPreset,
  reset,
  undo,
  redo,
  canUndo,
  canRedo,
  handleExport,
  handleImport,
  handleShareLink,
  encodedParams,
  debugHeader,
}: {
  params: PromptParameters;
  presetKey: PromptPresetKey | null;
  updateParam: <K extends keyof PromptParameters>(key: K, value: PromptParameters[K]) => void;
  setPreset: (preset: PromptPresetKey | null) => void;
  reset: () => void;
  undo: () => boolean;
  redo: () => boolean;
  canUndo: boolean;
  canRedo: boolean;
  handleExport: () => void;
  handleImport: () => void;
  handleShareLink: () => void;
  encodedParams: string;
  debugHeader: string;
}) {
  return (
    <div className="space-y-3">
      {/* Preset dropdown */}
      <div>
        <Label className="text-xs text-muted-foreground">Preset</Label>
        <Select value={presetKey || '__none__'} onValueChange={(v) => setPreset(v === '__none__' ? null : v as PromptPresetKey)}>
          <SelectTrigger className="mt-1 h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PRESET_ORDER.map(key => (
              <SelectItem key={key} value={key}>
                <span className="flex items-center gap-2">
                  <span>{PRESET_DISPLAY[key].icon}</span>
                  <span>{PRESET_DISPLAY[key].label}</span>
                </span>
              </SelectItem>
            ))}
            <SelectSeparator />
            <SelectItem value="__none__">Default</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Key parameters */}
      <div className="space-y-2">
        <ParameterSelect
          label="Depth"
          value={params.responseDepth || ''}
          onChange={(v) => updateParam('responseDepth', v as ResponseDepth)}
          options={[
            { value: '', label: 'Default' },
            { value: ResponseDepth.Minimal, label: 'Minimal' },
            { value: ResponseDepth.Detailed, label: 'Detailed' },
            { value: ResponseDepth.Comprehensive, label: 'Comprehensive' },
          ]}
        />
        <ParameterSelect
          label="Expertise"
          value={params.expertiseLevel || ''}
          onChange={(v) => updateParam('expertiseLevel', v as ExpertiseLevel)}
          options={[
            { value: '', label: 'Default' },
            { value: ExpertiseLevel.Layperson, label: 'Beginner' },
            { value: ExpertiseLevel.Expert, label: 'Expert' },
            { value: ExpertiseLevel.WorldClass, label: 'World-Class' },
          ]}
        />
        <ParameterSelect
          label="Tone"
          value={params.tone || ''}
          onChange={(v) => updateParam('tone', v as Tone)}
          options={[
            { value: '', label: 'Default' },
            { value: Tone.Casual, label: 'Casual' },
            { value: Tone.Professional, label: 'Professional' },
            { value: Tone.Formal, label: 'Formal' },
          ]}
        />
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 pt-2 border-t">
        <Button variant="ghost" size="sm" className="h-6 px-1.5 text-xs" onClick={undo} disabled={!canUndo}>
          <Undo2 className="h-3 w-3" />
        </Button>
        <Button variant="ghost" size="sm" className="h-6 px-1.5 text-xs" onClick={redo} disabled={!canRedo}>
          <Redo2 className="h-3 w-3" />
        </Button>
        <Button variant="ghost" size="sm" className="h-6 px-1.5 text-xs" onClick={reset}>
          <X className="h-3 w-3" />
        </Button>
        <div className="ml-auto flex gap-1">
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={handleShareLink} title="Share link">
            <Copy className="h-3 w-3" />
          </Button>
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={handleExport} title="Export config">
            <Download className="h-3 w-3" />
          </Button>
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={handleImport} title="Import config">
            <Upload className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Debug header */}
      {debugHeader !== 'default' && (
        <div className="text-[10px] text-muted-foreground font-mono truncate" title={debugHeader}>
          {debugHeader}
        </div>
      )}
    </div>
  );
}

/**
 * Small parameter select dropdown
 */
function ParameterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <div className="flex items-center gap-2">
      <Label className="text-xs text-muted-foreground w-20 shrink-0">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-7 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map(opt => (
            <SelectItem key={opt.value} value={opt.value} className="text-xs">
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
