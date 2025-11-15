"use client";

import React, { useState, useEffect } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs';
import { Badge } from '../ui/badge';
import { ScrollArea } from '../ui/scroll-area';
import {
  Globe, Zap, Download, Copy, Trash2, Search,
  Loader2, CheckCircle, XCircle, AlertCircle,
  FileText, Image as ImageIcon, Link as LinkIcon,
  Code, Table, Brain, Sparkles, Play, Eye,
  Clock, ExternalLink, Filter, RefreshCw
} from 'lucide-react';
import type { PluginProps } from './plugin-manager';
import { toast } from 'sonner';

interface ScrapedData {
  id: string;
  url: string;
  timestamp: string;
  title: string;
  description?: string;
  content: {
    text?: string;
    html?: string;
    markdown?: string;
  };
  metadata: {
    images: string[];
    links: string[];
    headings: string[];
    keywords: string[];
  };
  structured?: any;
  status: 'success' | 'error';
  duration: number;
}

interface ExtractionRule {
  id: string;
  name: string;
  selector: string;
  type: 'text' | 'html' | 'attribute' | 'list';
  attribute?: string;
}

const HyperagentScraperPlugin: React.FC<PluginProps> = ({ onClose, onResult }) => {
  const [url, setUrl] = useState('');
  const [extractionMode, setExtractionMode] = useState<'auto' | 'smart' | 'custom'>('smart');
  const [customPrompt, setCustomPrompt] = useState('');
  const [isScrapting, setIsScraping] = useState(false);
  const [scrapedHistory, setScrapedHistory] = useState<ScrapedData[]>([]);
  const [selectedScrape, setSelectedScrape] = useState<ScrapedData | null>(null);
  const [activeTab, setActiveTab] = useState('scraper');
  const [extractionRules, setExtractionRules] = useState<ExtractionRule[]>([
    { id: '1', name: 'Page Title', selector: 'h1', type: 'text' },
    { id: '2', name: 'Main Content', selector: 'article, main, .content', type: 'text' },
    { id: '3', name: 'All Links', selector: 'a', type: 'list', attribute: 'href' }
  ]);
  const [newRuleName, setNewRuleName] = useState('');
  const [newRuleSelector, setNewRuleSelector] = useState('');
  const [filterImages, setFilterImages] = useState(true);
  const [filterLinks, setFilterLinks] = useState(true);
  const [maxDepth, setMaxDepth] = useState(1);

  const mockScrapeWebsite = async (targetUrl: string): Promise<ScrapedData> => {
    // Simulate realistic scraping delay
    await new Promise(resolve => setTimeout(resolve, 2000 + Math.random() * 2000));

    const mockData: ScrapedData = {
      id: `scrape-${Date.now()}`,
      url: targetUrl,
      timestamp: new Date().toISOString(),
      title: 'Example Website - AI-Powered Scraping Results',
      description: 'This is a demonstration of web scraping with AI-enhanced content extraction',
      content: {
        text: `Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.

Key Features:
- Intelligent content extraction
- Structured data parsing
- Media asset discovery
- Link relationship mapping

This is a mock scraping result. In production, this would contain the actual scraped content from ${targetUrl}.

The Hyperagent Web Scraper uses advanced AI algorithms to intelligently extract and structure web content, making it easy to access and analyze information from any website.`,
        html: '<div><h1>Example Content</h1><p>Sample HTML content...</p></div>',
        markdown: '# Example Content\n\nSample markdown content...'
      },
      metadata: {
        images: [
          'https://via.placeholder.com/800x600/4A90E2/ffffff?text=Image+1',
          'https://via.placeholder.com/800x600/7B68EE/ffffff?text=Image+2',
          'https://via.placeholder.com/800x600/50C878/ffffff?text=Image+3',
          'https://via.placeholder.com/400x300/FF6B6B/ffffff?text=Thumbnail'
        ],
        links: [
          'https://example.com/about',
          'https://example.com/contact',
          'https://example.com/blog',
          'https://example.com/services',
          'https://github.com/example/repo'
        ],
        headings: [
          'Main Heading',
          'Secondary Topic',
          'Important Information',
          'Additional Resources'
        ],
        keywords: ['AI', 'Web Scraping', 'Data Extraction', 'Automation', 'Machine Learning']
      },
      structured: {
        articles: [
          { title: 'Article 1', author: 'John Doe', date: '2024-01-15' },
          { title: 'Article 2', author: 'Jane Smith', date: '2024-01-16' }
        ],
        products: [
          { name: 'Product A', price: '$99.99', rating: 4.5 },
          { name: 'Product B', price: '$149.99', rating: 4.8 }
        ]
      },
      status: 'success',
      duration: 3450
    };

    return mockData;
  };

  const startScraping = async () => {
    if (!url.trim()) {
      toast.error('Please enter a URL');
      return;
    }

    // Basic URL validation
    try {
      new URL(url);
    } catch (e) {
      toast.error('Invalid URL format');
      return;
    }

    setIsScraping(true);

    try {
      const result = await mockScrapeWebsite(url);
      setScrapedHistory(prev => [result, ...prev]);
      setSelectedScrape(result);
      setActiveTab('results');
      toast.success(`Successfully scraped ${url}`);
      onResult?.(result);
    } catch (error) {
      toast.error('Scraping failed');
    } finally {
      setIsScraping(false);
    }
  };

  const exportData = (data: ScrapedData, format: 'json' | 'csv' | 'markdown') => {
    let content = '';
    let filename = '';

    switch (format) {
      case 'json':
        content = JSON.stringify(data, null, 2);
        filename = `scrape-${data.id}.json`;
        break;
      case 'markdown':
        content = `# ${data.title}\n\n${data.content.text}\n\n## Metadata\n- URL: ${data.url}\n- Timestamp: ${data.timestamp}\n- Images: ${data.metadata.images.length}\n- Links: ${data.metadata.links.length}`;
        filename = `scrape-${data.id}.md`;
        break;
      case 'csv':
        content = `URL,Title,Timestamp,Images,Links\n"${data.url}","${data.title}","${data.timestamp}",${data.metadata.images.length},${data.metadata.links.length}`;
        filename = `scrape-${data.id}.csv`;
        break;
    }

    // Create and trigger download
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);

    toast.success(`Exported as ${format.toUpperCase()}`);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard');
  };

  const addExtractionRule = () => {
    if (!newRuleName || !newRuleSelector) {
      toast.error('Please provide rule name and selector');
      return;
    }

    const newRule: ExtractionRule = {
      id: Date.now().toString(),
      name: newRuleName,
      selector: newRuleSelector,
      type: 'text'
    };

    setExtractionRules(prev => [...prev, newRule]);
    setNewRuleName('');
    setNewRuleSelector('');
    toast.success('Extraction rule added');
  };

  return (
    <div className="flex flex-col h-full bg-gradient-to-br from-slate-900 via-blue-900/20 to-slate-900">
      <div className="flex items-center justify-between p-4 border-b border-white/10">
        <div className="flex items-center gap-2">
          <Globe className="w-5 h-5 text-blue-400" />
          <h2 className="text-lg font-semibold text-white">Hyperagent Scraper</h2>
          <Badge variant="outline" className="text-xs">AI-Powered</Badge>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>
          <XCircle className="w-4 h-4" />
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
        <TabsList className="mx-4 mt-4 bg-black/40">
          <TabsTrigger value="scraper" className="text-xs">
            <Search className="w-3 h-3 mr-1" />
            Scraper
          </TabsTrigger>
          <TabsTrigger value="results" className="text-xs">
            <Eye className="w-3 h-3 mr-1" />
            Results
          </TabsTrigger>
          <TabsTrigger value="rules" className="text-xs">
            <Filter className="w-3 h-3 mr-1" />
            Rules
          </TabsTrigger>
          <TabsTrigger value="history" className="text-xs">
            <Clock className="w-3 h-3 mr-1" />
            History ({scrapedHistory.length})
          </TabsTrigger>
        </TabsList>

        {/* Scraper Tab */}
        <TabsContent value="scraper" className="flex-1 p-4 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="space-y-4">
              {/* URL Input */}
              <Card className="bg-black/40 border-blue-500/20">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm text-white flex items-center gap-2">
                    <Brain className="w-4 h-4 text-blue-400" />
                    AI-Powered Web Scraping
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Extract structured data from any website using intelligent content analysis
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-xs text-white/60">Website URL</label>
                    <div className="flex gap-2">
                      <Input
                        placeholder="https://example.com"
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && !isScrapting && startScraping()}
                        className="bg-black/40 border-white/20 text-white"
                        disabled={isScrapting}
                      />
                      <Button
                        onClick={startScraping}
                        disabled={isScrapting}
                        className="bg-blue-600 hover:bg-blue-700"
                      >
                        {isScrapting ? (
                          <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            Scraping...
                          </>
                        ) : (
                          <>
                            <Play className="w-4 h-4 mr-2" />
                            Scrape
                          </>
                        )}
                      </Button>
                    </div>
                  </div>

                  {/* Extraction Mode */}
                  <div className="space-y-2">
                    <label className="text-xs text-white/60">Extraction Mode</label>
                    <div className="grid grid-cols-3 gap-2">
                      <button
                        onClick={() => setExtractionMode('auto')}
                        className={`p-3 rounded border transition-all ${
                          extractionMode === 'auto'
                            ? 'border-blue-500 bg-blue-500/20'
                            : 'border-white/10 bg-black/40 hover:border-white/20'
                        }`}
                      >
                        <Zap className="w-5 h-5 mx-auto mb-1 text-yellow-400" />
                        <p className="text-xs text-white">Auto</p>
                      </button>
                      <button
                        onClick={() => setExtractionMode('smart')}
                        className={`p-3 rounded border transition-all ${
                          extractionMode === 'smart'
                            ? 'border-blue-500 bg-blue-500/20'
                            : 'border-white/10 bg-black/40 hover:border-white/20'
                        }`}
                      >
                        <Brain className="w-5 h-5 mx-auto mb-1 text-purple-400" />
                        <p className="text-xs text-white">Smart AI</p>
                      </button>
                      <button
                        onClick={() => setExtractionMode('custom')}
                        className={`p-3 rounded border transition-all ${
                          extractionMode === 'custom'
                            ? 'border-blue-500 bg-blue-500/20'
                            : 'border-white/10 bg-black/40 hover:border-white/20'
                        }`}
                      >
                        <Code className="w-5 h-5 mx-auto mb-1 text-green-400" />
                        <p className="text-xs text-white">Custom</p>
                      </button>
                    </div>
                  </div>

                  {/* Smart AI Prompt */}
                  {extractionMode === 'smart' && (
                    <div className="space-y-2">
                      <label className="text-xs text-white/60">AI Extraction Instructions</label>
                      <Textarea
                        placeholder="e.g., Extract all product names, prices, and ratings..."
                        value={customPrompt}
                        onChange={(e) => setCustomPrompt(e.target.value)}
                        className="bg-black/40 border-white/20 text-white text-sm min-h-[80px]"
                      />
                    </div>
                  )}

                  {/* Options */}
                  <div className="grid grid-cols-2 gap-4 p-3 bg-black/40 rounded border border-white/10">
                    <label className="flex items-center gap-2 text-xs text-white cursor-pointer">
                      <input
                        type="checkbox"
                        checked={filterImages}
                        onChange={(e) => setFilterImages(e.target.checked)}
                        className="rounded"
                      />
                      <ImageIcon className="w-3 h-3" />
                      Extract Images
                    </label>
                    <label className="flex items-center gap-2 text-xs text-white cursor-pointer">
                      <input
                        type="checkbox"
                        checked={filterLinks}
                        onChange={(e) => setFilterLinks(e.target.checked)}
                        className="rounded"
                      />
                      <LinkIcon className="w-3 h-3" />
                      Extract Links
                    </label>
                    <div className="flex items-center gap-2 text-xs text-white">
                      <span>Max Depth:</span>
                      <input
                        type="number"
                        min="1"
                        max="5"
                        value={maxDepth}
                        onChange={(e) => setMaxDepth(parseInt(e.target.value))}
                        className="w-16 bg-black/40 border border-white/20 rounded px-2 py-1"
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Quick Actions */}
              <Card className="bg-black/40 border-white/10">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm text-white">Quick Presets</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { name: 'E-commerce', icon: '🛒', prompt: 'Extract product information' },
                      { name: 'News', icon: '📰', prompt: 'Extract articles and headlines' },
                      { name: 'Social Media', icon: '💬', prompt: 'Extract posts and profiles' },
                      { name: 'Documentation', icon: '📚', prompt: 'Extract documentation structure' }
                    ].map((preset) => (
                      <button
                        key={preset.name}
                        onClick={() => {
                          setExtractionMode('smart');
                          setCustomPrompt(preset.prompt);
                        }}
                        className="p-2 bg-black/40 hover:bg-black/60 border border-white/10 rounded text-xs text-white transition-all"
                      >
                        <span className="text-lg mb-1 block">{preset.icon}</span>
                        {preset.name}
                      </button>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          </ScrollArea>
        </TabsContent>

        {/* Results Tab */}
        <TabsContent value="results" className="flex-1 p-4 overflow-hidden">
          {selectedScrape ? (
            <ScrollArea className="h-full">
              <div className="space-y-4">
                {/* Header */}
                <Card className="bg-black/40 border-blue-500/20">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <h3 className="font-medium text-white mb-1">{selectedScrape.title}</h3>
                        <div className="flex items-center gap-2 text-xs text-white/60 mb-2">
                          <ExternalLink className="w-3 h-3" />
                          <a href={selectedScrape.url} target="_blank" rel="noopener noreferrer" className="hover:text-blue-400">
                            {selectedScrape.url}
                          </a>
                        </div>
                        <div className="flex items-center gap-4 text-xs text-white/60">
                          <span>{new Date(selectedScrape.timestamp).toLocaleString()}</span>
                          <span>{selectedScrape.duration}ms</span>
                          <Badge variant="outline" className="text-xs">
                            <CheckCircle className="w-3 h-3 mr-1" />
                            Success
                          </Badge>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" onClick={() => exportData(selectedScrape, 'json')}>
                          <Download className="w-3 h-3 mr-1" />
                          JSON
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => exportData(selectedScrape, 'markdown')}>
                          <Download className="w-3 h-3 mr-1" />
                          MD
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Content */}
                <Card className="bg-black/40 border-white/10">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm text-white flex items-center gap-2">
                      <FileText className="w-4 h-4" />
                      Extracted Content
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <pre className="bg-black/40 p-4 rounded text-xs text-white/80 whitespace-pre-wrap overflow-x-auto">
                      {selectedScrape.content.text}
                    </pre>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => copyToClipboard(selectedScrape.content.text || '')}
                      className="mt-2"
                    >
                      <Copy className="w-3 h-3 mr-1" />
                      Copy
                    </Button>
                  </CardContent>
                </Card>

                {/* Images */}
                {selectedScrape.metadata.images.length > 0 && (
                  <Card className="bg-black/40 border-white/10">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm text-white flex items-center gap-2">
                        <ImageIcon className="w-4 h-4" />
                        Images ({selectedScrape.metadata.images.length})
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-3 gap-2">
                        {selectedScrape.metadata.images.slice(0, 6).map((img, idx) => (
                          <div key={idx} className="aspect-video bg-black/40 rounded overflow-hidden border border-white/10">
                            <img src={img} alt={`Image ${idx + 1}`} className="w-full h-full object-cover" />
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Links */}
                {selectedScrape.metadata.links.length > 0 && (
                  <Card className="bg-black/40 border-white/10">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm text-white flex items-center gap-2">
                        <LinkIcon className="w-4 h-4" />
                        Links ({selectedScrape.metadata.links.length})
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-1">
                        {selectedScrape.metadata.links.slice(0, 10).map((link, idx) => (
                          <a
                            key={idx}
                            href={link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block text-xs text-blue-400 hover:text-blue-300 truncate"
                          >
                            {link}
                          </a>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Structured Data */}
                {selectedScrape.structured && (
                  <Card className="bg-black/40 border-white/10">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm text-white flex items-center gap-2">
                        <Table className="w-4 h-4" />
                        Structured Data
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <pre className="bg-black/40 p-4 rounded text-xs text-white/80 overflow-x-auto">
                        {JSON.stringify(selectedScrape.structured, null, 2)}
                      </pre>
                    </CardContent>
                  </Card>
                )}
              </div>
            </ScrollArea>
          ) : (
            <Card className="bg-black/40 border-white/10 h-full">
              <CardContent className="p-8 text-center h-full flex items-center justify-center">
                <div>
                  <Eye className="w-12 h-12 text-white/20 mx-auto mb-3" />
                  <p className="text-sm text-white/60">No results to display</p>
                  <p className="text-xs text-white/40 mt-1">Scrape a website to see results</p>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Rules Tab */}
        <TabsContent value="rules" className="flex-1 p-4 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="space-y-4">
              <Card className="bg-black/40 border-blue-500/20">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm text-white">Custom Extraction Rules</CardTitle>
                  <CardDescription className="text-xs">Define CSS selectors for targeted data extraction</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex gap-2">
                    <Input
                      placeholder="Rule name"
                      value={newRuleName}
                      onChange={(e) => setNewRuleName(e.target.value)}
                      className="bg-black/40 border-white/20 text-white text-sm"
                    />
                    <Input
                      placeholder="CSS selector"
                      value={newRuleSelector}
                      onChange={(e) => setNewRuleSelector(e.target.value)}
                      className="bg-black/40 border-white/20 text-white text-sm"
                    />
                    <Button onClick={addExtractionRule} className="bg-blue-600 hover:bg-blue-700">
                      <Sparkles className="w-4 h-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <div className="space-y-2">
                {extractionRules.map((rule) => (
                  <Card key={rule.id} className="bg-black/40 border-white/10">
                    <CardContent className="p-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="font-medium text-white text-sm">{rule.name}</h4>
                          <p className="text-xs text-white/60 font-mono">{rule.selector}</p>
                          <Badge variant="outline" className="text-xs mt-1">{rule.type}</Badge>
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setExtractionRules(prev => prev.filter(r => r.id !== rule.id))}
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          </ScrollArea>
        </TabsContent>

        {/* History Tab */}
        <TabsContent value="history" className="flex-1 p-4 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="space-y-2">
              {scrapedHistory.length > 0 ? (
                scrapedHistory.map((scrape) => (
                  <Card
                    key={scrape.id}
                    className={`bg-black/40 border cursor-pointer transition-all hover:border-blue-500/40 ${
                      selectedScrape?.id === scrape.id ? 'border-blue-500/60' : 'border-white/10'
                    }`}
                    onClick={() => {
                      setSelectedScrape(scrape);
                      setActiveTab('results');
                    }}
                  >
                    <CardContent className="p-3">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <h4 className="font-medium text-white text-sm mb-1">{scrape.title}</h4>
                          <p className="text-xs text-white/60 truncate mb-2">{scrape.url}</p>
                          <div className="flex items-center gap-3 text-xs text-white/60">
                            <span>{new Date(scrape.timestamp).toLocaleTimeString()}</span>
                            <span>{scrape.duration}ms</span>
                            <Badge variant="outline" className="text-xs">
                              {scrape.metadata.images.length} images
                            </Badge>
                            <Badge variant="outline" className="text-xs">
                              {scrape.metadata.links.length} links
                            </Badge>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={(e) => {
                              e.stopPropagation();
                              exportData(scrape, 'json');
                            }}
                          >
                            <Download className="w-3 h-3" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={(e) => {
                              e.stopPropagation();
                              setScrapedHistory(prev => prev.filter(s => s.id !== scrape.id));
                              if (selectedScrape?.id === scrape.id) {
                                setSelectedScrape(null);
                              }
                            }}
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))
              ) : (
                <Card className="bg-black/40 border-white/10">
                  <CardContent className="p-8 text-center">
                    <Clock className="w-12 h-12 text-white/20 mx-auto mb-3" />
                    <p className="text-sm text-white/60">No scraping history</p>
                  </CardContent>
                </Card>
              )}
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default HyperagentScraperPlugin;
