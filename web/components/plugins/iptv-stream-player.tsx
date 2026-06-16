"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import Hls from 'hls.js';
import { Search, Play, Loader2, AlertCircle, Tv, Monitor } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';

const CHANNELS_URL = 'https://iptv-org.github.io/api/channels.json';
const STREAMS_URL = 'https://iptv-org.github.io/api/streams.json';
const CACHE_KEYS = {
  channels: 'iptv-channels-cache',
  streams: 'iptv-streams-cache',
};
const CACHE_TTL = 10 * 60 * 1000;

interface Channel {
  id: string;
  name: string;
  alt_names?: string[];
  country?: string;
  categories?: string[];
  network?: string | null;
  is_nsfw?: boolean;
  website?: string | null;
}

interface Stream {
  channel: string | null;
  feed: string | null;
  title: string;
  url: string;
  quality: string | null;
  label: string | null;
  user_agent?: string | null;
  referrer?: string | null;
}

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const countryNames: Record<string, string> = {
  US: 'United States', GB: 'United Kingdom', FR: 'France', DE: 'Germany',
  JP: 'Japan', CN: 'China', IN: 'India', BR: 'Brazil', CA: 'Canada',
  AU: 'Australia', RU: 'Russia', KR: 'South Korea', IT: 'Italy',
  ES: 'Spain', NL: 'Netherlands', SE: 'Sweden', NO: 'Norway',
  DK: 'Denmark', FI: 'Finland', PT: 'Portugal', PL: 'Poland',
  AR: 'Argentina', MX: 'Mexico', ZA: 'South Africa', TR: 'Turkey',
};

function getFromCache<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const entry: CacheEntry<T> = JSON.parse(raw);
    if (Date.now() - entry.timestamp > CACHE_TTL) {
      localStorage.removeItem(key);
      return null;
    }
    return entry.data;
  } catch {
    return null;
  }
}

function setCache<T>(key: string, data: T): void {
  try {
    const entry: CacheEntry<T> = { data, timestamp: Date.now() };
    localStorage.setItem(key, JSON.stringify(entry));
  } catch {
    // Storage full — ignore
  }
}

const IPTVStreamPlayer: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [streams, setStreams] = useState<Stream[]>([]);
  const [selectedChannel, setSelectedChannel] = useState<Channel | null>(null);
  const [selectedStream, setSelectedStream] = useState<Stream | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [channelsLoading, setChannelsLoading] = useState(true);
  const [streamsLoading, setStreamsLoading] = useState(false);
  const [channelsError, setChannelsError] = useState<string | null>(null);
  const [streamsError, setStreamsError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<any>(null);

  const filteredChannels = useMemo(() => {
    if (!searchQuery.trim()) return channels.slice(0, 200);
    const q = searchQuery.toLowerCase();
    return channels.filter(ch =>
      ch.name.toLowerCase().includes(q) ||
      ch.id.toLowerCase().includes(q) ||
      ch.country?.toLowerCase().includes(q) ||
      ch.categories?.some(c => c.toLowerCase().includes(q))
    ).slice(0, 200);
  }, [channels, searchQuery]);

  useEffect(() => {
    const cached = getFromCache<Channel[]>(CACHE_KEYS.channels);
    if (cached) {
      setChannels(cached);
      setChannelsLoading(false);
      return;
    }

    setChannelsLoading(true);
    fetch(CHANNELS_URL)
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: Channel[]) => {
        const filtered = data.filter(ch => !ch.is_nsfw);
        setChannels(filtered);
        setCache(CACHE_KEYS.channels, filtered);
        setChannelsLoading(false);
      })
      .catch(err => {
        setChannelsError(err.message);
        setChannelsLoading(false);
      });
  }, []);

  const loadStreams = useCallback(async (channelId: string) => {
    const cached = getFromCache<Stream[]>(CACHE_KEYS.streams);
    let allStreams: Stream[];
    if (cached) {
      allStreams = cached;
    } else {
      setStreamsLoading(true);
      setStreamsError(null);
      try {
        const res = await fetch(STREAMS_URL);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        allStreams = await res.json();
        setCache(CACHE_KEYS.streams, allStreams);
      } catch (err: any) {
        setStreamsError(err.message);
        setStreamsLoading(false);
        return;
      }
      setStreamsLoading(false);
    }
    const filtered = allStreams.filter(s => s.channel === channelId);
    setStreams(filtered);
  }, []);

  const handleSelectChannel = useCallback((ch: Channel) => {
    setSelectedChannel(ch);
    setSelectedStream(null);
    setStreams([]);
    destroyPlayer();
    loadStreams(ch.id);
  }, [loadStreams]);

  const destroyPlayer = useCallback(() => {
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.removeAttribute('src');
      videoRef.current.load();
    }
  }, []);

  const handleSelectStream = useCallback(async (stream: Stream) => {
    setSelectedStream(stream);
    destroyPlayer();

    if (!videoRef.current) return;
    initializePlayer(stream.url);
  }, [destroyPlayer]);

  const initializePlayer = useCallback((url: string) => {
    const video = videoRef.current;
    if (!video) return;

    if (url.endsWith('.m3u8')) {
      if (Hls.isSupported()) {
        const hls = new Hls();
        hlsRef.current = hls;
        hls.loadSource(url);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          video.play().catch(() => {});
        });
        hls.on(Hls.Events.ERROR, (_event: any, data: any) => {
          if (data.fatal) {
            switch (data.type) {
              case Hls.ErrorTypes.NETWORK_ERROR:
                hls.startLoad();
                break;
              case Hls.ErrorTypes.MEDIA_ERROR:
                hls.recoverMediaError();
                break;
              default:
                destroyPlayer();
                break;
            }
          }
        });
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = url;
        video.addEventListener('loadedmetadata', () => {
          video.play().catch(() => {});
        });
      }
    } else {
      video.src = url;
      video.addEventListener('loadedmetadata', () => {
        video.play().catch(() => {});
      });
    }
  }, [destroyPlayer]);

  useEffect(() => {
    return () => {
      destroyPlayer();
    };
  }, [destroyPlayer]);

  return (
    <div className="flex h-full w-full gap-2 p-2">
      {/* Channel List */}
      <div className="flex flex-col w-72 shrink-0 bg-white/5 rounded-lg overflow-hidden">
        <div className="p-2 border-b border-white/10">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/40" />
            <Input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search channels..."
              className="pl-7 h-8 text-xs bg-white/5 border-white/10"
            />
          </div>
        </div>
        <ScrollArea className="flex-1">
          {channelsLoading ? (
            <div className="flex items-center justify-center h-32 text-white/40">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              Loading channels...
            </div>
          ) : channelsError ? (
            <div className="flex items-center justify-center h-32 text-red-400 text-xs px-4">
              <AlertCircle className="w-4 h-4 mr-1.5 shrink-0" />
              {channelsError}
            </div>
          ) : filteredChannels.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-white/30 text-xs">
              {searchQuery ? 'No matching channels' : 'No channels available'}
            </div>
          ) : (
            <div className="py-1">
              {filteredChannels.map(ch => (
                <button
                  key={ch.id}
                  onClick={() => handleSelectChannel(ch)}
                  className={`w-full text-left px-3 py-2 text-xs transition-colors hover:bg-white/10 ${
                    selectedChannel?.id === ch.id ? 'bg-purple-500/20 text-purple-300' : 'text-white/70'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Tv className="w-3 h-3 shrink-0 opacity-50" />
                    <span className="truncate flex-1">{ch.name}</span>
                    {ch.country && (
                      <span className="text-[10px] text-white/30 shrink-0">{ch.country}</span>
                    )}
                  </div>
                  {ch.categories && ch.categories.length > 0 && (
                    <div className="flex gap-1 mt-0.5">
                      {ch.categories.slice(0, 2).map(cat => (
                        <span key={cat} className="text-[10px] text-white/25 bg-white/5 px-1 rounded">
                          {cat}
                        </span>
                      ))}
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </ScrollArea>
      </div>

      {/* Stream + Player */}
      <div className="flex-1 flex flex-col gap-2 min-w-0">
        {/* Video Player */}
        <div className="relative bg-black/60 rounded-lg overflow-hidden aspect-video flex items-center justify-center">
          {selectedStream ? (
            <video
              ref={videoRef}
              controls
              className="w-full h-full object-contain"
              playsInline
            />
          ) : (
            <div className="flex flex-col items-center gap-2 text-white/30">
              <Monitor className="w-10 h-10" />
              <p className="text-xs">Select a channel and stream</p>
            </div>
          )}
          {streamsLoading && (
            <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-purple-400" />
            </div>
          )}
        </div>

        {/* Channel Info */}
        {selectedChannel && (
          <div className="bg-white/5 rounded-lg p-2">
            <div className="flex items-center gap-2">
              <Tv className="w-4 h-4 text-white/50" />
              <span className="text-sm font-medium text-white/80">{selectedChannel.name}</span>
              {selectedChannel.country && (
                <Badge variant="outline" className="text-[10px] h-5 px-1.5 text-white/40 border-white/10">
                  {countryNames[selectedChannel.country] || selectedChannel.country}
                </Badge>
              )}
              {selectedChannel.categories?.map(cat => (
                <Badge key={cat} variant="outline" className="text-[10px] h-5 px-1.5 text-white/40 border-white/10">
                  {cat}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Stream List */}
        {selectedChannel && (
          <div className="flex-1 bg-white/5 rounded-lg overflow-hidden min-h-0">
            {streamsError ? (
              <div className="flex items-center justify-center h-full text-red-400 text-xs">
                <AlertCircle className="w-4 h-4 mr-1.5" />
                {streamsError}
              </div>
            ) : streams.length === 0 && !streamsLoading ? (
              <div className="flex items-center justify-center h-full text-white/30 text-xs">
                No streams available for this channel
              </div>
            ) : (
              <ScrollArea className="h-full">
                <div className="p-1 space-y-0.5">
                  {streams.map((s, i) => (
                    <button
                      key={`${s.feed ?? 'stream'}-${i}`}
                      onClick={() => handleSelectStream(s)}
                      className={`w-full text-left px-3 py-2 rounded text-xs transition-colors flex items-center gap-2 ${
                        selectedStream?.url === s.url
                          ? 'bg-purple-500/20 text-purple-300'
                          : 'text-white/60 hover:bg-white/10'
                      }`}
                    >
                      <Play className="w-3 h-3 shrink-0" />
                      <span className="flex-1 truncate">{s.title}</span>
                      {s.quality && (
                        <Badge variant="outline" className="text-[10px] h-5 px-1 border-white/10 text-white/40">
                          {s.quality}
                        </Badge>
                      )}
                      {s.label && (
                        <span className="text-[10px] text-yellow-400/60">{s.label}</span>
                      )}
                    </button>
                  ))}
                </div>
              </ScrollArea>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default IPTVStreamPlayer;
