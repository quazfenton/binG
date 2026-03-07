"use client";

import React, { useState, useEffect } from 'react';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs';
import { ScrollArea } from '../ui/scroll-area';
import {
  Map as MapIcon,
  X,
  ExternalLink,
  RefreshCw,
  Maximize2,
  Minimize2,
  Search,
  Bookmark,
  BookmarkCheck,
  MapPin,
  Navigation,
  Plus,
  Minus,
  Share2,
  Layers,
  Compass,
} from 'lucide-react';
import { toast } from 'sonner';

interface BookmarkEntry {
  url: string;
  title: string;
  lat?: number;
  lon?: number;
  zoom?: number;
  timestamp: number;
}

interface LocationEntry {
  name: string;
  lat: number;
  lon: number;
  zoom: number;
}

const OpenStreetMapEmbedPlugin: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [iframeUrl, setIframeUrl] = useState('https://www.openstreetmap.org/export/embed.html');
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [iframeError, setIframeError] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [bookmarks, setBookmarks] = useState<BookmarkEntry[]>([]);
  const [isReloading, setIsReloading] = useState(false);
  const [iframeKey, setIframeKey] = useState(0);
  const [activeTab, setActiveTab] = useState<'map' | 'bookmarks' | 'locations'>('map');
  const [coordinates, setCoordinates] = useState({ lat: 51.505, lon: -0.09, zoom: 12 });

  const defaultLocations: LocationEntry[] = [
    { name: 'London, UK', lat: 51.5074, lon: -0.1278, zoom: 12 },
    { name: 'New York, USA', lat: 40.7128, lon: -74.0060, zoom: 12 },
    { name: 'Paris, France', lat: 48.8566, lon: 2.3522, zoom: 12 },
    { name: 'Tokyo, Japan', lat: 35.6762, lon: 139.6503, zoom: 12 },
    { name: 'Sydney, Australia', lat: -33.8688, lon: 151.2093, zoom: 12 },
    { name: 'Berlin, Germany', lat: 52.5200, lon: 13.4050, zoom: 12 },
    { name: 'San Francisco, USA', lat: 37.7749, lon: -122.4194, zoom: 13 },
    { name: 'Singapore', lat: 1.3521, lon: 103.8198, zoom: 13 },
  ];

  useEffect(() => {
    try {
      const savedBookmarks = localStorage.getItem('osm-bookmarks');
      if (savedBookmarks) setBookmarks(JSON.parse(savedBookmarks));
    } catch (e) {
      console.error('Failed to load from localStorage:', e);
    }
  }, []);

  useEffect(() => {
    updateMapUrl();
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsLoading(false);
    }, 2000);
    return () => clearTimeout(timer);
  }, [iframeKey]);

  const updateMapUrl = (lat?: number, lon?: number, zoom?: number) => {
    const newLat = lat ?? coordinates.lat;
    const newLon = lon ?? coordinates.lon;
    const newZoom = zoom ?? coordinates.zoom;
    
    const bbox = calculateBbox(newLat, newLon, newZoom);
    const url = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik`;
    
    setIframeUrl(url);
    setCoordinates({ lat: newLat, lon: newLon, zoom: newZoom });
  };

  const calculateBbox = (lat: number, lon: number, zoom: number): string => {
    const range = 360 / Math.pow(2, zoom);
    const latRange = range * 0.5;
    const lonRange = range;
    
    const minLon = lon - lonRange / 2;
    const maxLon = lon + lonRange / 2;
    const minLat = lat - latRange / 2;
    const maxLat = lat + latRange / 2;
    
    return `${minLon.toFixed(4)},${minLat.toFixed(4)},${maxLon.toFixed(4)},${maxLat.toFixed(4)}`;
  };

  const handleSearch = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!searchQuery.trim()) return;

    // Use Nominatim for geocoding
    fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}&limit=1`)
      .then(res => res.json())
      .then(data => {
        if (data && data.length > 0) {
          const { lat, lon, display_name } = data[0];
          const newLat = parseFloat(lat);
          const newLon = parseFloat(lon);
          updateMapUrl(newLat, newLon, 14);
          toast.success(`Found: ${display_name}`);
        } else {
          toast.error('Location not found');
        }
      })
      .catch(() => {
        toast.error('Search failed');
      });
  };

  const handleZoom = (delta: number) => {
    const newZoom = Math.max(1, Math.min(19, coordinates.zoom + delta));
    updateMapUrl(coordinates.lat, coordinates.lon, newZoom);
    setIsReloading(true);
    setIframeKey(prev => prev + 1);
    setTimeout(() => setIsReloading(false), 500);
  };

  const handleReload = () => {
    setIframeError(null);
    setIsReloading(true);
    setIframeKey(prev => prev + 1);
    setTimeout(() => setIsReloading(false), 1000);
  };

  const handleOpenExternal = () => {
    const fullUrl = `https://www.openstreetmap.org/?mlat=${coordinates.lat}&mlon=${coordinates.lon}#map=${coordinates.zoom}/${coordinates.lat}/${coordinates.lon}`;
    window.open(fullUrl, '_blank', 'noopener,noreferrer');
  };

  const toggleBookmark = () => {
    const title = `Map: ${coordinates.lat.toFixed(4)}, ${coordinates.lon.toFixed(4)}`;
    const existing = bookmarks.find(b => 
      Math.abs(b.lat! - coordinates.lat) < 0.001 && 
      Math.abs(b.lon! - coordinates.lon) < 0.001
    );
    
    let newBookmarks;
    if (existing) {
      newBookmarks = bookmarks.filter(b => b !== existing);
      toast.success('Removed from bookmarks');
    } else {
      newBookmarks = [{
        url: iframeUrl,
        title,
        lat: coordinates.lat,
        lon: coordinates.lon,
        zoom: coordinates.zoom,
        timestamp: Date.now(),
      }, ...bookmarks];
      toast.success('Location bookmarked');
    }
    
    setBookmarks(newBookmarks);
    localStorage.setItem('osm-bookmarks', JSON.stringify(newBookmarks));
  };

  const toggleFullscreen = () => {
    setIsFullscreen(!isFullscreen);
  };

  const loadBookmark = (bookmark: BookmarkEntry) => {
    if (bookmark.lat && bookmark.lon && bookmark.zoom) {
      updateMapUrl(bookmark.lat, bookmark.lon, bookmark.zoom);
    } else {
      setIframeUrl(bookmark.url);
    }
    setActiveTab('map');
    setIsReloading(true);
    setIframeKey(prev => prev + 1);
    setTimeout(() => setIsReloading(false), 1000);
  };

  const loadLocation = (location: LocationEntry) => {
    updateMapUrl(location.lat, location.lon, location.zoom);
    setIsReloading(true);
    setIframeKey(prev => prev + 1);
    setTimeout(() => setIsReloading(false), 500);
  };

  const isBookmarked = bookmarks.some(b => 
    b.lat && b.lon &&
    Math.abs(b.lat - coordinates.lat) < 0.001 && 
    Math.abs(b.lon - coordinates.lon) < 0.001
  );

  return (
    <div className={`h-full flex flex-col bg-gradient-to-br from-emerald-950 via-teal-950 to-slate-900 text-white ${isFullscreen ? 'fixed inset-0 z-50' : ''}`}>
      {/* Header */}
      <CardHeader className="p-4 border-b border-emerald-800/50 bg-emerald-950/80 backdrop-blur">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-500">
              <MapIcon className="w-5 h-5 text-white" />
            </div>
            <div>
              <CardTitle className="text-lg font-bold bg-gradient-to-r from-emerald-400 to-teal-400 bg-clip-text text-transparent">
                OpenStreetMap
              </CardTitle>
              <p className="text-xs text-emerald-200/60">The Free Wiki World Map</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={handleReload}
              disabled={isReloading}
              className="hover:bg-emerald-800/50"
            >
              <RefreshCw className={`w-4 h-4 ${isReloading ? 'animate-spin' : ''}`} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleFullscreen}
              className="hover:bg-emerald-800/50"
            >
              {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleBookmark}
              className="hover:bg-emerald-800/50"
            >
              {isBookmarked ? (
                <BookmarkCheck className="w-4 h-4 text-emerald-400" />
              ) : (
                <Bookmark className="w-4 h-4" />
              )}
            </Button>
            <Button variant="ghost" size="icon" onClick={onClose} className="hover:bg-emerald-800/50">
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex-1 overflow-hidden p-0">
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="h-full">
          <TabsList className="w-full justify-start rounded-none border-b border-emerald-800/50 bg-emerald-950/50 px-4 py-2">
            <TabsTrigger value="map" className="data-[state=active]:bg-emerald-800/50">
              <MapIcon className="w-4 h-4 mr-2" />
              Map
            </TabsTrigger>
            <TabsTrigger value="bookmarks" className="data-[state=active]:bg-emerald-800/50">
              <Bookmark className="w-4 h-4 mr-2" />
              Bookmarks
            </TabsTrigger>
            <TabsTrigger value="locations" className="data-[state=active]:bg-emerald-800/50">
              <MapPin className="w-4 h-4 mr-2" />
              Locations
            </TabsTrigger>
          </TabsList>

          <TabsContent value="map" className="h-[calc(100%-60px)] m-0">
            <div className="flex flex-col h-full">
              {/* Search & Controls */}
              <div className="p-3 border-b border-emerald-800/50 bg-emerald-950/30 space-y-3">
                <form onSubmit={handleSearch} className="flex gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-emerald-400/60" />
                    <Input
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search for a location..."
                      className="bg-emerald-900/30 border-emerald-700 text-white placeholder:text-emerald-400/60 pl-10"
                    />
                  </div>
                  <Button type="submit" className="bg-emerald-600 hover:bg-emerald-500">
                    <Search className="w-4 h-4" />
                  </Button>
                  <Button type="button" onClick={handleOpenExternal} variant="outline" className="border-emerald-700 hover:bg-emerald-800/50">
                    <ExternalLink className="w-4 h-4" />
                  </Button>
                </form>

                {/* Zoom Controls */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs text-emerald-200/60">
                    <Compass className="w-4 h-4" />
                    <span>Lat: {coordinates.lat.toFixed(4)} | Lon: {coordinates.lon.toFixed(4)}</span>
                    <span className="px-2 py-0.5 bg-emerald-800/50 rounded">Zoom: {coordinates.zoom}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleZoom(-1)}
                      className="border-emerald-700 hover:bg-emerald-800/50 w-8 h-8 p-0"
                    >
                      <Minus className="w-4 h-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleZoom(1)}
                      className="border-emerald-700 hover:bg-emerald-800/50 w-8 h-8 p-0"
                    >
                      <Plus className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </div>

              {/* Iframe */}
              <div className="flex-1 relative bg-emerald-950">
                {isLoading && (
                  <div className="absolute inset-0 flex items-center justify-center bg-emerald-950/80 z-10">
                    <div className="text-center space-y-4">
                      <RefreshCw className="w-8 h-8 animate-spin mx-auto text-emerald-500" />
                      <p className="text-emerald-200/60">Loading OpenStreetMap...</p>
                    </div>
                  </div>
                )}
                
                {iframeError ? (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="text-center space-y-4 max-w-md p-6">
                      <MapIcon className="w-12 h-12 mx-auto text-emerald-500/60" />
                      <p className="text-emerald-200/60">{iframeError}</p>
                      <Button onClick={handleReload} className="bg-emerald-600 hover:bg-emerald-500">
                        <RefreshCw className="w-4 h-4 mr-2" />
                        Retry
                      </Button>
                    </div>
                  </div>
                ) : (
                  <iframe
                    key={iframeKey}
                    src={iframeUrl}
                    className="w-full h-full border-0"
                    title="OpenStreetMap"
                    onLoad={() => setIsLoading(false)}
                    onError={() => {
                      setIframeError('Failed to load OpenStreetMap.');
                      setIsLoading(false);
                    }}
                    sandbox="allow-same-origin allow-scripts allow-popups allow-forms allow-top-navigation allow-top-navigation-by-user-activation"
                    allow="fullscreen"
                    referrerPolicy="no-referrer"
                  />
                )}
              </div>

              {/* Info Footer */}
              <div className="p-2 border-t border-emerald-800/50 bg-emerald-950/50 flex items-center justify-between text-xs">
                <div className="flex items-center gap-3 text-emerald-200/60">
                  <Layers className="w-3 h-3" />
                  <span>Open Data License</span>
                </div>
                <div className="flex items-center gap-2 text-emerald-200/60">
                  <Share2 className="w-3 h-3" />
                  <span>Community Edited</span>
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="bookmarks" className="h-[calc(100%-60px)] m-0">
            <ScrollArea className="h-full p-4">
              {bookmarks.length === 0 ? (
                <div className="flex items-center justify-center h-64">
                  <div className="text-center space-y-4">
                    <Bookmark className="w-12 h-12 mx-auto text-emerald-500/40" />
                    <p className="text-emerald-200/60">No bookmarked locations</p>
                    <p className="text-xs text-emerald-400/40">Navigate to a location and click bookmark</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  {bookmarks.map((bookmark, idx) => (
                    <div
                      key={idx}
                      className="p-3 rounded-lg border border-emerald-800/50 bg-emerald-900/30 hover:bg-emerald-900/50 transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <MapPin className="w-5 h-5 text-emerald-400 flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="font-medium truncate">{bookmark.title}</p>
                            {bookmark.lat && bookmark.lon && (
                              <p className="text-xs text-emerald-200/40">
                                {bookmark.lat.toFixed(4)}, {bookmark.lon.toFixed(4)}
                              </p>
                            )}
                            <p className="text-xs text-emerald-200/30">
                              {new Date(bookmark.timestamp).toLocaleDateString()}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => loadBookmark(bookmark)}
                            className="hover:bg-emerald-800/50"
                          >
                            <Navigation className="w-4 h-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              const newBookmarks = bookmarks.filter((_, i) => i !== idx);
                              setBookmarks(newBookmarks);
                              localStorage.setItem('osm-bookmarks', JSON.stringify(newBookmarks));
                              toast.success('Bookmark removed');
                            }}
                            className="hover:bg-red-900/30 text-red-400"
                          >
                            <X className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </TabsContent>

          <TabsContent value="locations" className="h-[calc(100%-60px)] m-0">
            <ScrollArea className="h-full p-4">
              <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
                <MapPin className="w-4 h-4 text-emerald-400" />
                Quick Navigate
              </h3>
              <div className="grid grid-cols-2 gap-3">
                {defaultLocations.map((location, idx) => (
                  <button
                    key={idx}
                    onClick={() => loadLocation(location)}
                    className="p-3 rounded-lg border border-emerald-800/50 bg-emerald-900/30 hover:bg-emerald-900/50 transition-colors text-left"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <Navigation className="w-4 h-4 text-emerald-400" />
                      <span className="font-medium text-sm">{location.name}</span>
                    </div>
                    <p className="text-xs text-emerald-200/40">
                      {location.lat.toFixed(4)}, {location.lon.toFixed(4)}
                    </p>
                  </button>
                ))}
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </CardContent>
    </div>
  );
};

export default OpenStreetMapEmbedPlugin;
