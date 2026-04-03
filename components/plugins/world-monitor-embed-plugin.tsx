"use client";

import React, { useState, useEffect } from 'react';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { Input } from '../ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs';
import { ScrollArea } from '../ui/scroll-area';
import useIframeLoader from '@/hooks/use-iframe-loader';
import { IframeUnavailableScreen } from '../ui/iframe-unavailable-screen';
import { IframeLoadingOverlay } from '../ui/iframe-loading-overlay';
import {
  Globe,
  X,
  ExternalLink,
  RefreshCw,
  Maximize2,
  Minimize2,
  Search,
  Filter,
  Star,
  TrendingUp,
  AlertCircle,
  CheckCircle,
  Clock,
  MapPin,
  BarChart3,
  Eye,
  Share2,
  Bookmark,
  BookmarkCheck,
} from 'lucide-react';
import { toast } from 'sonner';

interface CountryData {
  name: string;
  code: string;
  status: 'online' | 'offline' | 'degraded';
  uptime: number;
  responseTime: number;
  lastChecked: string;
  incidents?: number;
}

interface ServiceStatus {
  service: string;
  status: 'operational' | 'degraded' | 'outage';
  uptime: number;
  incidents24h: number;
}

const WorldMonitorEmbedPlugin: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [iframeUrl, setIframeUrl] = useState('https://www.worldmonitor.app');
  const [isLoading, setIsLoading] = useState(true);
  const [iframeError, setIframeError] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [bookmarks, setBookmarks] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'embed' | 'status' | 'bookmarks'>('embed');
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null);
  const [isReloading, setIsReloading] = useState(false);
  const [iframeKey, setIframeKey] = useState(0);

  // Use iframe loader hook with fallback
  const {
    isLoading: hookIsLoading,
    isLoaded,
    isFailed,
    failureReason,
    errorMessage,
    retryCount,
    canRetry,
    isUsingFallback,
    fallbackLevel,
    fallbackUrl,
    loadingProgress,
    handleLoad,
    handleRetry,
    handleReset,
    handleFallback,
    handleLoadSuccess,
  } = useIframeLoader({
    url: iframeUrl,
    timeout: 30000,
    maxRetries: 3,
    retryDelay: 5000,
    enableAutoRetry: true,
    enableFallback: true,
    onLoaded: () => {
      setIsLoading(false);
      setIframeError(null);
    },
    onFailed: (reason, error) => {
      setIsLoading(false);
      setIframeError(error || 'Failed to load World Monitor');
    },
  });

  // Sample status data (in production, this would be fetched from an API)
  const [countryData, setCountryData] = useState<CountryData[]>([
    { name: 'United States', code: 'US', status: 'online', uptime: 99.9, responseTime: 45, lastChecked: new Date().toISOString() },
    { name: 'United Kingdom', code: 'GB', status: 'online', uptime: 99.8, responseTime: 52, lastChecked: new Date().toISOString() },
    { name: 'Germany', code: 'DE', status: 'online', uptime: 99.7, responseTime: 48, lastChecked: new Date().toISOString() },
    { name: 'France', code: 'FR', status: 'online', uptime: 99.6, responseTime: 55, lastChecked: new Date().toISOString() },
    { name: 'Japan', code: 'JP', status: 'degraded', uptime: 98.5, responseTime: 120, lastChecked: new Date().toISOString(), incidents: 2 },
    { name: 'Australia', code: 'AU', status: 'online', uptime: 99.4, responseTime: 85, lastChecked: new Date().toISOString() },
    { name: 'Brazil', code: 'BR', status: 'offline', uptime: 95.2, responseTime: 0, lastChecked: new Date().toISOString(), incidents: 5 },
    { name: 'India', code: 'IN', status: 'online', uptime: 99.1, responseTime: 95, lastChecked: new Date().toISOString() },
    { name: 'Canada', code: 'CA', status: 'online', uptime: 99.8, responseTime: 42, lastChecked: new Date().toISOString() },
    { name: 'Singapore', code: 'SG', status: 'online', uptime: 99.5, responseTime: 78, lastChecked: new Date().toISOString() },
  ]);

  const [serviceStatus, setServiceStatus] = useState<ServiceStatus[]>([
    { service: 'API Services', status: 'operational', uptime: 99.9, incidents24h: 0 },
    { service: 'Web Application', status: 'operational', uptime: 99.8, incidents24h: 0 },
    { service: 'Database', status: 'operational', uptime: 99.95, incidents24h: 0 },
    { service: 'CDN', status: 'degraded', uptime: 98.5, incidents24h: 1 },
    { service: 'Authentication', status: 'operational', uptime: 99.99, incidents24h: 0 },
  ]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('world-monitor-bookmarks');
      if (saved) {
        setBookmarks(JSON.parse(saved));
      }
    } catch (e) {
      console.error('Failed to load bookmarks:', e);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsLoading(false);
    }, 2000);
    return () => clearTimeout(timer);
  }, [iframeKey]);

  const handleReload = () => {
    setIframeError(null);
    setIsReloading(true);
    setIframeKey(prev => prev + 1);
    setTimeout(() => setIsReloading(false), 1000);
  };

  const handleOpenExternal = () => {
    window.open(iframeUrl, '_blank', 'noopener,noreferrer');
  };

  const toggleBookmark = (url: string) => {
    const newBookmarks = bookmarks.includes(url)
      ? bookmarks.filter(b => b !== url)
      : [...bookmarks, url];
    
    setBookmarks(newBookmarks);
    localStorage.setItem('world-monitor-bookmarks', JSON.stringify(newBookmarks));
    toast.success(bookmarks.includes(url) ? 'Removed from bookmarks' : 'Added to bookmarks');
  };

  const toggleFullscreen = () => {
    setIsFullscreen(!isFullscreen);
  };

  const filteredCountries = countryData.filter(country =>
    country.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    country.code.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'online':
      case 'operational':
        return 'bg-green-500';
      case 'degraded':
        return 'bg-yellow-500';
      case 'offline':
      case 'outage':
        return 'bg-red-500';
      default:
        return 'bg-gray-500';
    }
  };

  const getStatusBadgeVariant = (status: string) => {
    switch (status) {
      case 'online':
      case 'operational':
        return 'default' as const;
      case 'degraded':
        return 'secondary' as const;
      case 'offline':
      case 'outage':
        return 'destructive' as const;
      default:
        return 'outline' as const;
    }
  };

  return (
    <div className={`h-full flex flex-col bg-gradient-to-br from-slate-950 via-blue-950 to-slate-900 text-white ${isFullscreen ? 'fixed inset-0 z-50' : ''}`}>
      {/* Header */}
      <CardHeader className="p-4 border-b border-slate-700 bg-slate-900/80 backdrop-blur">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-gradient-to-br from-blue-500 to-cyan-500">
              <Globe className="w-5 h-5 text-white" />
            </div>
            <div>
              <CardTitle className="text-lg font-bold bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">
                World Monitor
              </CardTitle>
              <p className="text-xs text-slate-400">Global service status & monitoring</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={handleReload}
              disabled={isReloading}
              className="hover:bg-slate-800"
            >
              <RefreshCw className={`w-4 h-4 ${isReloading ? 'animate-spin' : ''}`} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleFullscreen}
              className="hover:bg-slate-800"
            >
              {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => toggleBookmark(iframeUrl)}
              className="hover:bg-slate-800"
            >
              {bookmarks.includes(iframeUrl) ? (
                <BookmarkCheck className="w-4 h-4 text-blue-400" />
              ) : (
                <Bookmark className="w-4 h-4" />
              )}
            </Button>
            <Button variant="ghost" size="icon" onClick={onClose} className="hover:bg-slate-800">
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex-1 overflow-hidden p-0">
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="h-full">
          <TabsList className="w-full justify-start rounded-none border-b border-slate-700 bg-slate-900/50 px-4 py-2">
            <TabsTrigger value="embed" className="data-[state=active]:bg-slate-800">
              <Globe className="w-4 h-4 mr-2" />
              Live Monitor
            </TabsTrigger>
            <TabsTrigger value="status" className="data-[state=active]:bg-slate-800">
              <BarChart3 className="w-4 h-4 mr-2" />
              Status Overview
            </TabsTrigger>
            <TabsTrigger value="bookmarks" className="data-[state=active]:bg-slate-800">
              <Bookmark className="w-4 h-4 mr-2" />
              Bookmarks
            </TabsTrigger>
          </TabsList>

          <TabsContent value="embed" className="h-[calc(100%-60px)] m-0">
            <div className="flex flex-col h-full">
              {/* URL Bar */}
              <div className="p-3 border-b border-slate-700 bg-slate-900/30 flex gap-2">
                <div className="relative flex-1">
                  <Input
                    value={iframeUrl}
                    onChange={(e) => setIframeUrl(e.target.value)}
                    placeholder="Enter URL..."
                    className="bg-slate-800/50 border-slate-600 text-white placeholder:text-slate-500 pr-10"
                  />
                  <ExternalLink className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                </div>
                <Button onClick={handleOpenExternal} className="bg-blue-600 hover:bg-blue-500">
                  <ExternalLink className="w-4 h-4" />
                </Button>
              </div>

              {/* Iframe */}
              <div className="flex-1 relative bg-slate-950">
                {isFailed || iframeError ? (
                  <div className="absolute inset-0">
                    <IframeUnavailableScreen
                      url={iframeUrl}
                      reason={failureReason || 'failed'}
                      errorMessage={errorMessage || iframeError || undefined}
                      onRetry={handleRetry}onOpenExternal={handleOpenExternal}
                      onClose={onClose}
                      autoRetryCount={retryCount}
                      maxRetries={3}
                    />
                  </div>
                ) : iframeUrl ? (
                  <>
                    {/* Shared loading overlay with progress bar */}
                    <IframeLoadingOverlay
                      progress={loadingProgress}
                      isLoading={hookIsLoading || isLoading}
                      isUsingFallback={isUsingFallback}
                      fallbackLevel={fallbackLevel}
                      label="Loading World Monitor"
                    />
                    <iframe
                      key={iframeKey}
                      src={isUsingFallback && fallbackUrl ? fallbackUrl : iframeUrl}
                      className="w-full h-full border-0"
                      title="World Monitor"
                      onLoad={() => {
                        setIsLoading(false);
                        handleLoadSuccess();
                      }}
                      onError={() => {
                        setIframeError('Failed to load the website. The site may not allow embedding.');
                        setIsLoading(false);
                      }}
                      sandbox="allow-same-origin allow-scripts allow-popups allow-forms allow-top-navigation allow-top-navigation-by-user-activation"
                      allow="fullscreen"
                      referrerPolicy="no-referrer"
                    />
                  </>
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center text-slate-500">
                    <p>Enter a URL to load content</p>
                  </div>
                )}
              </div>

              {/* Quick Stats Footer */}
              <div className="p-3 border-t border-slate-700 bg-slate-900/50">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-4">
                    <span className="flex items-center gap-1 text-slate-400">
                      <CheckCircle className="w-3 h-3 text-green-500" />
                      {countryData.filter(c => c.status === 'online').length} Online
                    </span>
                    <span className="flex items-center gap-1 text-slate-400">
                      <AlertCircle className="w-3 h-3 text-yellow-500" />
                      {countryData.filter(c => c.status === 'degraded').length} Degraded
                    </span>
                    <span className="flex items-center gap-1 text-slate-400">
                      <X className="w-3 h-3 text-red-500" />
                      {countryData.filter(c => c.status === 'offline').length} Offline
                    </span>
                  </div>
                  <span className="text-slate-500">Last updated: {new Date().toLocaleTimeString()}</span>
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="status" className="h-[calc(100%-60px)] m-0 overflow-auto">
            <ScrollArea className="h-full p-4 space-y-4">
              {/* Search & Filter */}
              <div className="flex gap-2 mb-4">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <Input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search countries..."
                    className="bg-slate-800/50 border-slate-600 text-white placeholder:text-slate-500 pl-10"
                  />
                </div>
                <Button variant="outline" className="border-slate-600 hover:bg-slate-800">
                  <Filter className="w-4 h-4" />
                </Button>
              </div>

              {/* Service Status Cards */}
              <div className="mb-6">
                <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-blue-400" />
                  Service Status
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {serviceStatus.map((service) => (
                    <div
                      key={service.service}
                      className="p-3 rounded-lg border border-slate-700 bg-slate-800/50 hover:bg-slate-800 transition-colors"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-medium text-sm">{service.service}</span>
                        <Badge variant={getStatusBadgeVariant(service.status)} className="text-xs">
                          <div className={`w-2 h-2 rounded-full ${getStatusColor(service.status)} mr-1`} />
                          {service.status}
                        </Badge>
                      </div>
                      <div className="flex items-center justify-between text-xs text-slate-400">
                        <span>Uptime: {service.uptime}%</span>
                        <span>24h: {service.incidents24h} incidents</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Country Status Table */}
              <div>
                <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-cyan-400" />
                  Country Status
                </h3>
                <div className="space-y-2">
                  {filteredCountries.map((country) => (
                    <div
                      key={country.code}
                      onClick={() => setSelectedCountry(selectedCountry === country.code ? null : country.code)}
                      className={`p-3 rounded-lg border transition-all cursor-pointer ${
                        selectedCountry === country.code
                          ? 'border-blue-500 bg-blue-900/20'
                          : 'border-slate-700 bg-slate-800/50 hover:bg-slate-800'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className={`w-3 h-3 rounded-full ${getStatusColor(country.status)}`} />
                          <div>
                            <p className="font-medium">{country.name}</p>
                            <p className="text-xs text-slate-400">{country.code}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-4 text-sm">
                          <div className="text-right">
                            <p className="text-slate-400 text-xs">Uptime</p>
                            <p className="font-medium">{country.uptime}%</p>
                          </div>
                          <div className="text-right">
                            <p className="text-slate-400 text-xs">Response</p>
                            <p className="font-medium">{country.responseTime > 0 ? `${country.responseTime}ms` : 'N/A'}</p>
                          </div>
                          {country.incidents && (
                            <Badge variant="destructive" className="text-xs">
                              <AlertCircle className="w-3 h-3 mr-1" />
                              {country.incidents}
                            </Badge>
                          )}
                        </div>
                      </div>
                      
                      {selectedCountry === country.code && (
                        <div className="mt-3 pt-3 border-t border-slate-700 text-xs text-slate-400">
                          <div className="grid grid-cols-3 gap-4">
                            <div>
                              <p className="text-slate-500">Last Checked</p>
                              <p className="text-white">{new Date(country.lastChecked).toLocaleString()}</p>
                            </div>
                            <div>
                              <p className="text-slate-500">24h Uptime</p>
                              <p className="text-white">{country.uptime}%</p>
                            </div>
                            <div>
                              <p className="text-slate-500">Avg Response</p>
                              <p className="text-white">{country.responseTime > 0 ? `${country.responseTime}ms` : 'N/A'}</p>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="bookmarks" className="h-[calc(100%-60px)] m-0">
            <ScrollArea className="h-full p-4">
              {bookmarks.length === 0 ? (
                <div className="flex items-center justify-center h-64">
                  <div className="text-center space-y-4">
                    <Bookmark className="w-12 h-12 mx-auto text-slate-600" />
                    <p className="text-slate-400">No bookmarked URLs</p>
                    <p className="text-xs text-slate-500">Click the bookmark icon to save URLs</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  {bookmarks.map((url, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between p-3 rounded-lg border border-slate-700 bg-slate-800/50 hover:bg-slate-800 transition-colors"
                    >
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <Globe className="w-5 h-5 text-blue-400 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate">{url}</p>
                          <p className="text-xs text-slate-400">Bookmarked</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setIframeUrl(url);
                            setActiveTab('embed');
                          }}
                          className="border-slate-600 hover:bg-slate-700"
                        >
                          <Eye className="w-4 h-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}
                          className="hover:bg-slate-700"
                        >
                          <ExternalLink className="w-4 h-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => toggleBookmark(url)}
                          className="hover:bg-red-900/30 text-red-400"
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </CardContent>
    </div>
  );
};

export default WorldMonitorEmbedPlugin;
