"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs';
import { Badge } from '../ui/badge';
import { ScrollArea } from '../ui/scroll-area';
import {
  Regex, Sparkles, Copy, Save, Trash2, Play, Info,
  CheckCircle, XCircle, AlertCircle, Book, Zap,
  Code, FileText, Download, Hash, Search, Eye,
  List, Settings, HelpCircle, Lightbulb, Star
} from 'lucide-react';
import type { PluginProps } from './plugin-manager';
import { toast } from 'sonner';

interface RegexMatch {
  match: string;
  index: number;
  groups: string[];
  namedGroups?: Record<string, string>;
}

interface SavedPattern {
  id: string;
  name: string;
  pattern: string;
  flags: string;
  description: string;
  category: string;
  created: string;
}

interface RegexExplanation {
  pattern: string;
  explanation: string;
  components: Array<{
    part: string;
    meaning: string;
  }>;
}

const RegexPatternLabPlugin: React.FC<PluginProps> = ({ onClose, onResult }) => {
  const [pattern, setPattern] = useState('\\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Z|a-z]{2,}\\b');
  const [testString, setTestString] = useState('Contact us at support@example.com or sales@company.org for more info.');
  const [flags, setFlags] = useState({ g: true, i: false, m: false, s: false, u: false, y: false });
  const [matches, setMatches] = useState<RegexMatch[]>([]);
  const [isValid, setIsValid] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('tester');
  const [savedPatterns, setSavedPatterns] = useState<SavedPattern[]>([
    {
      id: '1',
      name: 'Email Address',
      pattern: '\\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Z|a-z]{2,}\\b',
      flags: 'gi',
      description: 'Matches email addresses',
      category: 'common',
      created: new Date().toISOString()
    },
    {
      id: '2',
      name: 'URL',
      pattern: 'https?:\\/\\/(www\\.)?[-a-zA-Z0-9@:%._\\+~#=]{1,256}\\.[a-zA-Z0-9()]{1,6}\\b([-a-zA-Z0-9()@:%_\\+.~#?&//=]*)',
      flags: 'gi',
      description: 'Matches HTTP/HTTPS URLs',
      category: 'common',
      created: new Date().toISOString()
    },
    {
      id: '3',
      name: 'Phone Number (US)',
      pattern: '\\(?(\\d{3})\\)?[-.\\s]?(\\d{3})[-.\\s]?(\\d{4})',
      flags: 'g',
      description: 'Matches US phone numbers',
      category: 'common',
      created: new Date().toISOString()
    },
    {
      id: '4',
      name: 'IPv4 Address',
      pattern: '\\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\b',
      flags: 'g',
      description: 'Matches IPv4 addresses',
      category: 'network',
      created: new Date().toISOString()
    }
  ]);
  const [patternName, setPatternName] = useState('');
  const [patternDescription, setPatternDescription] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('custom');
  const [showExplanation, setShowExplanation] = useState(true);
  const [replaceString, setReplaceString] = useState('');
  const [replaceResult, setReplaceResult] = useState('');

  // Common regex patterns library
  const patternLibrary = [
    { name: 'Email', pattern: '[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}', category: 'common' },
    { name: 'URL', pattern: 'https?://[^\\s]+', category: 'common' },
    { name: 'Phone (US)', pattern: '\\(?\\d{3}\\)?[-.\\s]?\\d{3}[-.\\s]?\\d{4}', category: 'common' },
    { name: 'Date (MM/DD/YYYY)', pattern: '(0[1-9]|1[0-2])/(0[1-9]|[12]\\d|3[01])/(19|20)\\d{2}', category: 'date' },
    { name: 'Time (HH:MM)', pattern: '([01]?\\d|2[0-3]):[0-5]\\d', category: 'date' },
    { name: 'Hex Color', pattern: '#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})', category: 'code' },
    { name: 'Credit Card', pattern: '\\d{4}[-.\\s]?\\d{4}[-.\\s]?\\d{4}[-.\\s]?\\d{4}', category: 'finance' },
    { name: 'SSN', pattern: '\\d{3}-\\d{2}-\\d{4}', category: 'finance' },
    { name: 'ZIP Code', pattern: '\\d{5}(-\\d{4})?', category: 'location' },
    { name: 'Username', pattern: '^[a-zA-Z0-9_-]{3,16}$', category: 'validation' },
    { name: 'Password (Strong)', pattern: '^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[@$!%*?&])[A-Za-z\\d@$!%*?&]{8,}$', category: 'validation' },
    { name: 'HTML Tag', pattern: '<([a-z]+)([^<]+)*(?:>(.*)<\\/\\1>|\\s+\\/>)', category: 'code' },
    { name: 'IPv4', pattern: '\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b', category: 'network' },
    { name: 'MAC Address', pattern: '([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})', category: 'network' },
    { name: 'Domain Name', pattern: '([a-z0-9]+(-[a-z0-9]+)*\\.)+[a-z]{2,}', category: 'network' },
    { name: 'Integer', pattern: '^-?\\d+$', category: 'number' },
    { name: 'Decimal', pattern: '^-?\\d*\\.?\\d+$', category: 'number' },
    { name: 'Whitespace', pattern: '\\s+', category: 'text' },
    { name: 'Word Boundary', pattern: '\\b\\w+\\b', category: 'text' }
  ];

  // Test regex pattern
  useEffect(() => {
    try {
      const flagsString = Object.entries(flags)
        .filter(([_, enabled]) => enabled)
        .map(([flag]) => flag)
        .join('');

      const regex = new RegExp(pattern, flagsString);
      setIsValid(true);
      setError('');

      // Find all matches
      const foundMatches: RegexMatch[] = [];
      let match;

      if (flags.g) {
        const regexGlobal = new RegExp(pattern, flagsString);
        while ((match = regexGlobal.exec(testString)) !== null) {
          foundMatches.push({
            match: match[0],
            index: match.index,
            groups: match.slice(1),
            namedGroups: match.groups
          });

          // Prevent infinite loop on zero-width matches
          if (match.index === regexGlobal.lastIndex) {
            regexGlobal.lastIndex++;
          }
        }
      } else {
        match = regex.exec(testString);
        if (match) {
          foundMatches.push({
            match: match[0],
            index: match.index,
            groups: match.slice(1),
            namedGroups: match.groups
          });
        }
      }

      setMatches(foundMatches);

      // Perform replacement if replace string is provided
      if (replaceString) {
        try {
          const replaced = testString.replace(regex, replaceString);
          setReplaceResult(replaced);
        } catch (e) {
          setReplaceResult('Error in replacement string');
        }
      } else {
        setReplaceResult('');
      }

    } catch (e: any) {
      setIsValid(false);
      setError(e.message || 'Invalid regex pattern');
      setMatches([]);
    }
  }, [pattern, testString, flags, replaceString]);

  const getExplanation = (): RegexExplanation => {
    const components: Array<{ part: string; meaning: string }> = [];

    // Simple pattern analysis
    const patterns = [
      { regex: /\\b/g, meaning: 'Word boundary' },
      { regex: /\\d/g, meaning: 'Any digit (0-9)' },
      { regex: /\\w/g, meaning: 'Any word character (a-z, A-Z, 0-9, _)' },
      { regex: /\\s/g, meaning: 'Any whitespace character' },
      { regex: /\+/g, meaning: 'One or more occurrences' },
      { regex: /\*/g, meaning: 'Zero or more occurrences' },
      { regex: /\?/g, meaning: 'Zero or one occurrence (optional)' },
      { regex: /\[([^\]]+)\]/g, meaning: 'Character class - matches any single character in brackets' },
      { regex: /\{(\d+),?(\d+)?\}/g, meaning: 'Quantifier - specific number of occurrences' },
      { regex: /\^/g, meaning: 'Start of string' },
      { regex: /\$/g, meaning: 'End of string' },
      { regex: /\./g, meaning: 'Any character except newline' },
      { regex: /\|/g, meaning: 'Alternation (OR)' },
      { regex: /\(([^)]+)\)/g, meaning: 'Capturing group' }
    ];

    return {
      pattern,
      explanation: 'This pattern matches based on the following components:',
      components: [
        { part: 'Full Pattern', meaning: pattern },
        ...patterns
          .filter(p => p.regex.test(pattern))
          .map(p => ({ part: p.regex.source, meaning: p.meaning }))
      ]
    };
  };

  const highlightMatches = (text: string): JSX.Element[] => {
    if (matches.length === 0) {
      return [<span key="0">{text}</span>];
    }

    const result: JSX.Element[] = [];
    let lastIndex = 0;

    matches.forEach((match, idx) => {
      // Add text before match
      if (match.index > lastIndex) {
        result.push(
          <span key={`text-${idx}`}>{text.substring(lastIndex, match.index)}</span>
        );
      }

      // Add highlighted match
      result.push(
        <span
          key={`match-${idx}`}
          className="bg-yellow-500/30 border-b-2 border-yellow-500 text-yellow-200 font-medium"
          title={`Match ${idx + 1}: "${match.match}"`}
        >
          {match.match}
        </span>
      );

      lastIndex = match.index + match.match.length;
    });

    // Add remaining text
    if (lastIndex < text.length) {
      result.push(<span key="text-end">{text.substring(lastIndex)}</span>);
    }

    return result;
  };

  const savePattern = () => {
    if (!patternName.trim()) {
      toast.error('Please provide a pattern name');
      return;
    }

    const flagsString = Object.entries(flags)
      .filter(([_, enabled]) => enabled)
      .map(([flag]) => flag)
      .join('');

    const newPattern: SavedPattern = {
      id: Date.now().toString(),
      name: patternName,
      pattern,
      flags: flagsString,
      description: patternDescription,
      category: selectedCategory,
      created: new Date().toISOString()
    };

    setSavedPatterns(prev => [newPattern, ...prev]);
    setPatternName('');
    setPatternDescription('');
    toast.success('Pattern saved');
  };

  const loadPattern = (savedPattern: SavedPattern) => {
    setPattern(savedPattern.pattern);

    // Parse flags
    const newFlags = { g: false, i: false, m: false, s: false, u: false, y: false };
    for (const flag of savedPattern.flags) {
      if (flag in newFlags) {
        newFlags[flag as keyof typeof newFlags] = true;
      }
    }
    setFlags(newFlags);

    setActiveTab('tester');
    toast.success('Pattern loaded');
  };

  const deletePattern = (id: string) => {
    setSavedPatterns(prev => prev.filter(p => p.id !== id));
    toast.success('Pattern deleted');
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard');
  };

  const exportPattern = () => {
    const flagsString = Object.entries(flags)
      .filter(([_, enabled]) => enabled)
      .map(([flag]) => flag)
      .join('');

    const data = {
      pattern,
      flags: flagsString,
      testString,
      matches: matches.length,
      description: patternDescription || 'Regex pattern export'
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `regex-pattern-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);

    toast.success('Pattern exported');
  };

  const explanation = useMemo(() => getExplanation(), [pattern]);

  return (
    <div className="flex flex-col h-full bg-gradient-to-br from-slate-900 via-emerald-900/20 to-slate-900">
      <div className="flex items-center justify-between p-4 border-b border-white/10">
        <div className="flex items-center gap-2">
          <Hash className="w-5 h-5 text-emerald-400" />
          <h2 className="text-lg font-semibold text-white">Regex Pattern Lab</h2>
          <Badge variant="outline" className="text-xs">
            <Sparkles className="w-3 h-3 mr-1" />
            AI-Powered
          </Badge>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>
          <XCircle className="w-4 h-4" />
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
        <TabsList className="mx-4 mt-4 bg-black/40">
          <TabsTrigger value="tester" className="text-xs">
            <Play className="w-3 h-3 mr-1" />
            Tester
          </TabsTrigger>
          <TabsTrigger value="library" className="text-xs">
            <Book className="w-3 h-3 mr-1" />
            Library
          </TabsTrigger>
          <TabsTrigger value="saved" className="text-xs">
            <Star className="w-3 h-3 mr-1" />
            Saved ({savedPatterns.length})
          </TabsTrigger>
          <TabsTrigger value="help" className="text-xs">
            <HelpCircle className="w-3 h-3 mr-1" />
            Help
          </TabsTrigger>
        </TabsList>

        {/* Tester Tab */}
        <TabsContent value="tester" className="flex-1 p-4 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="space-y-4">
              {/* Pattern Input */}
              <Card className="bg-black/40 border-emerald-500/20">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm text-white flex items-center gap-2">
                    <Code className="w-4 h-4" />
                    Regular Expression
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex gap-2">
                    <span className="text-white/60 text-sm mt-2">/</span>
                    <Input
                      value={pattern}
                      onChange={(e) => setPattern(e.target.value)}
                      className="flex-1 bg-black/40 border-white/20 text-white font-mono"
                      placeholder="Enter regex pattern..."
                    />
                    <span className="text-white/60 text-sm mt-2">/</span>
                    <div className="flex gap-1">
                      {Object.entries(flags).map(([flag, enabled]) => (
                        <button
                          key={flag}
                          onClick={() => setFlags(prev => ({ ...prev, [flag]: !enabled }))}
                          className={`w-8 h-10 rounded text-xs font-mono border transition-all ${
                            enabled
                              ? 'bg-emerald-500/30 border-emerald-500 text-emerald-300'
                              : 'bg-black/40 border-white/20 text-white/40'
                          }`}
                          title={
                            flag === 'g' ? 'Global' :
                            flag === 'i' ? 'Case insensitive' :
                            flag === 'm' ? 'Multiline' :
                            flag === 's' ? 'Dot all' :
                            flag === 'u' ? 'Unicode' :
                            'Sticky'
                          }
                        >
                          {flag}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Status */}
                  <div className="flex items-center gap-2">
                    {isValid ? (
                      <>
                        <CheckCircle className="w-4 h-4 text-green-400" />
                        <span className="text-xs text-green-400">Valid pattern</span>
                        <span className="text-xs text-white/60 ml-auto">
                          {matches.length} match{matches.length !== 1 ? 'es' : ''} found
                        </span>
                      </>
                    ) : (
                      <>
                        <XCircle className="w-4 h-4 text-red-400" />
                        <span className="text-xs text-red-400">{error}</span>
                      </>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => copyToClipboard(pattern)}>
                      <Copy className="w-3 h-3 mr-1" />
                      Copy
                    </Button>
                    <Button size="sm" variant="outline" onClick={exportPattern}>
                      <Download className="w-3 h-3 mr-1" />
                      Export
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setPattern('');
                        setTestString('');
                        setReplaceString('');
                      }}
                    >
                      <Trash2 className="w-3 h-3 mr-1" />
                      Clear
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {/* Test String */}
              <Card className="bg-black/40 border-white/10">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm text-white flex items-center gap-2">
                    <FileText className="w-4 h-4" />
                    Test String
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Textarea
                    value={testString}
                    onChange={(e) => setTestString(e.target.value)}
                    className="bg-black/40 border-white/20 text-white font-mono text-sm min-h-[100px]"
                    placeholder="Enter text to test against the pattern..."
                  />
                  <div className="p-3 bg-black/40 rounded border border-white/10">
                    <div className="text-sm text-white font-mono whitespace-pre-wrap break-words">
                      {highlightMatches(testString)}
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Replace */}
              <Card className="bg-black/40 border-white/10">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm text-white flex items-center gap-2">
                    <Search className="w-4 h-4" />
                    Replace
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Input
                    value={replaceString}
                    onChange={(e) => setReplaceString(e.target.value)}
                    className="bg-black/40 border-white/20 text-white font-mono text-sm"
                    placeholder="Replacement string (use $1, $2 for groups)..."
                  />
                  {replaceResult && (
                    <div className="p-3 bg-black/40 rounded border border-emerald-500/20">
                      <div className="text-xs text-white/60 mb-1">Result:</div>
                      <div className="text-sm text-emerald-300 font-mono whitespace-pre-wrap break-words">
                        {replaceResult}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Matches */}
              {matches.length > 0 && (
                <Card className="bg-black/40 border-white/10">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm text-white flex items-center gap-2">
                      <List className="w-4 h-4" />
                      Matches ({matches.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {matches.map((match, idx) => (
                        <div key={idx} className="p-2 bg-black/40 rounded border border-white/10">
                          <div className="flex items-center justify-between mb-1">
                            <Badge variant="outline" className="text-xs">Match {idx + 1}</Badge>
                            <span className="text-xs text-white/60">Index: {match.index}</span>
                          </div>
                          <div className="text-sm text-white font-mono mb-2">"{match.match}"</div>
                          {match.groups.length > 0 && (
                            <div className="space-y-1">
                              {match.groups.map((group, gIdx) => (
                                <div key={gIdx} className="text-xs text-white/60">
                                  Group {gIdx + 1}: <span className="text-emerald-300">{group}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* AI Explanation */}
              {showExplanation && isValid && (
                <Card className="bg-black/40 border-emerald-500/20">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm text-white flex items-center gap-2">
                        <Lightbulb className="w-4 h-4 text-yellow-400" />
                        Pattern Explanation
                      </CardTitle>
                      <Button size="sm" variant="ghost" onClick={() => setShowExplanation(false)}>
                        <Eye className="w-3 h-3" />
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {explanation.components.slice(0, 6).map((comp, idx) => (
                        <div key={idx} className="text-xs">
                          <span className="text-emerald-300 font-mono">{comp.part}</span>
                          <span className="text-white/60"> - {comp.meaning}</span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Save Pattern */}
              <Card className="bg-black/40 border-white/10">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm text-white flex items-center gap-2">
                    <Save className="w-4 h-4" />
                    Save Pattern
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Input
                    placeholder="Pattern name"
                    value={patternName}
                    onChange={(e) => setPatternName(e.target.value)}
                    className="bg-black/40 border-white/20 text-white text-sm"
                  />
                  <Textarea
                    placeholder="Description (optional)"
                    value={patternDescription}
                    onChange={(e) => setPatternDescription(e.target.value)}
                    className="bg-black/40 border-white/20 text-white text-sm min-h-[60px]"
                  />
                  <select
                    value={selectedCategory}
                    onChange={(e) => setSelectedCategory(e.target.value)}
                    className="w-full bg-black/40 border border-white/20 rounded-md px-3 py-2 text-white text-sm"
                  >
                    <option value="custom">Custom</option>
                    <option value="common">Common</option>
                    <option value="validation">Validation</option>
                    <option value="extraction">Extraction</option>
                    <option value="code">Code</option>
                  </select>
                  <Button onClick={savePattern} className="w-full bg-emerald-600 hover:bg-emerald-700">
                    <Save className="w-4 h-4 mr-2" />
                    Save Pattern
                  </Button>
                </CardContent>
              </Card>
            </div>
          </ScrollArea>
        </TabsContent>

        {/* Library Tab */}
        <TabsContent value="library" className="flex-1 p-4 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="space-y-4">
              <Card className="bg-black/40 border-emerald-500/20">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm text-white">Common Patterns</CardTitle>
                  <CardDescription className="text-xs">
                    Click any pattern to load it into the tester
                  </CardDescription>
                </CardHeader>
              </Card>

              {['common', 'validation', 'date', 'code', 'network', 'finance', 'number', 'text'].map(category => {
                const categoryPatterns = patternLibrary.filter(p => p.category === category);
                if (categoryPatterns.length === 0) return null;

                return (
                  <div key={category}>
                    <h3 className="text-sm font-medium text-white mb-2 capitalize">{category}</h3>
                    <div className="space-y-2">
                      {categoryPatterns.map((lib, idx) => (
                        <Card
                          key={idx}
                          className="bg-black/40 border-white/10 cursor-pointer hover:border-emerald-500/40 transition-all"
                          onClick={() => {
                            setPattern(lib.pattern);
                            setActiveTab('tester');
                            toast.success(`Loaded: ${lib.name}`);
                          }}
                        >
                          <CardContent className="p-3">
                            <div className="flex items-center justify-between">
                              <div className="flex-1">
                                <h4 className="font-medium text-white text-sm mb-1">{lib.name}</h4>
                                <code className="text-xs text-emerald-300 bg-black/40 px-2 py-1 rounded">
                                  {lib.pattern}
                                </code>
                              </div>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  copyToClipboard(lib.pattern);
                                }}
                              >
                                <Copy className="w-3 h-3" />
                              </Button>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        </TabsContent>

        {/* Saved Tab */}
        <TabsContent value="saved" className="flex-1 p-4 overflow-hidden
