import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, Clock, ExternalLink, RefreshCw, Zap, Search, Ticket, MapPin, Calendar } from "lucide-react";
import { toast } from "sonner";

interface BroadwayDeal {
  show: string;
  price: string;
  originalPrice?: string;
  savings?: string;
  time: string;
  venue: string;
  date: string;
  url?: string;
  source: string;
}

// Sanitize search input - remove potentially dangerous characters
function sanitizeSearchInput(input: string): string {
  // Limit length to 100 characters
  const maxLength = 100;
  // Only allow alphanumeric, spaces, hyphens, apostrophes, and basic punctuation
  const allowedPattern = /^[a-zA-Z0-9\s\-'.]+$/;
  
  let sanitized = input.trim().slice(0, maxLength);
  
  // If input contains disallowed characters, filter them out
  if (!allowedPattern.test(sanitized)) {
    sanitized = sanitized.replace(/[^a-zA-Z0-9\s\-'.]/g, '');
  }
  
  return sanitized;
}

export default function BroadwayDealHunterTab() {
  const [deals, setDeals] = useState<BroadwayDeal[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [dataSource, setDataSource] = useState<string>('Demo');

  // Check for deals using the new Deals API
  const checkForDeals = async (query?: string) => {
    setLoading(true);
    setError(null);

    try {
      // Call our backend API for deals
      const params = new URLSearchParams();
      if (query) params.set('search', query);
      params.set('category', 'Entertainment');
      
      const response = await fetch(`/api/deals?${params}`);

      if (!response.ok) {
        throw new Error(`Failed to fetch deals: ${response.statusText}`);
      }

      const result = await response.json();

      if (result.success) {
        // Transform deals API response to BroadwayDeal format
        const transformedDeals = result.deals.map((deal: any) => ({
          show: deal.title,
          price: `$${deal.dealPrice}`,
          originalPrice: `$${deal.originalPrice}`,
          savings: `${deal.discount}% off`,
          time: new Date(deal.createdAt).toLocaleTimeString(),
          venue: deal.store,
          date: deal.expiresAt ? new Date(deal.expiresAt).toLocaleDateString() : 'No expiry',
          url: deal.dealUrl,
          source: deal.store,
        }));
        
        setDeals(transformedDeals);
        setDataSource('Broadway Deals');
        setLastChecked(new Date());

        if (transformedDeals.length > 0) {
          toast.success(`Found ${transformedDeals.length} deals`);
        } else {
          setError("No deals found");
        }
      } else {
        throw new Error(result.error || "Failed to fetch deals");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unknown error occurred");
      setDeals([]);
    } finally {
      setLoading(false);
    }
  };

  // Handle search submit
  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    checkForDeals(searchQuery);
  };

  // Check for deals when component mounts
  useEffect(() => {
    checkForDeals();
  }, []);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-white flex items-center gap-2">
          <Ticket className="h-5 w-5 text-yellow-400" />
          Broadway Deal Hunter
        </h3>
        <Button 
          variant="outline" 
          size="sm" 
          onClick={() => checkForDeals(searchQuery)}
          disabled={loading}
          className="text-white/60 hover:text-white border-white/20"
        >
          {loading ? (
            <RefreshCw className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
        </Button>
      </div>

      {/* Search Input */}
      <form onSubmit={handleSearch} className="flex gap-2">
        <Input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search shows (e.g., Hamilton, Lion King)..."
          className="bg-black/40 border-white/20 text-white placeholder:text-white/40"
        />
        <Button 
          type="submit"
          variant="ghost"
          size="sm"
          disabled={loading}
          className="text-white/60 hover:text-white"
        >
          <Search className="h-4 w-4" />
        </Button>
      </form>

      {/* Last checked timestamp & source */}
      {lastChecked && (
        <div className="flex items-center justify-between text-xs text-white/40">
          <span>Last checked: {lastChecked.toLocaleTimeString()}</span>
          <span className={dataSource === 'Ticketmaster' || dataSource === 'Ticketmaster API' ? 'text-green-400' : ''}>
            Source: {dataSource}
          </span>
        </div>
      )}

      {/* Deals Display */}
      {deals.length > 0 ? (
        <div className="space-y-3 max-h-[400px] overflow-y-auto">
          {deals.map((deal, index) => (
            <Card key={index} className="bg-white/5 border border-white/10 hover:bg-white/10 transition-all">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="bg-yellow-500/20 rounded-full p-2">
                      <Ticket className="h-5 w-5 text-yellow-400" />
                    </div>
                    <div>
                      <h4 className="text-base font-semibold text-white">{deal.show}</h4>
                      <div className="flex items-center gap-2 text-xs text-white/50">
                        <MapPin className="h-3 w-3" />
                        {deal.venue}
                      </div>
                    </div>
                  </div>
                  {deal.savings && (
                    <Badge className="bg-green-500/20 text-green-400 border-green-500/30">
                      {deal.savings}
                    </Badge>
                  )}
                </div>
                
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-white/5 rounded-lg p-2">
                    <p className="text-xs text-white/50">Price</p>
                    <div className="flex items-baseline gap-2">
                      <span className="text-lg font-bold text-white">{deal.price}</span>
                      {deal.originalPrice && (
                        <span className="text-xs text-white/40 line-through">{deal.originalPrice}</span>
                      )}
                    </div>
                    {deal.savings && (
                      <p className="text-xs text-green-400 mt-1">{deal.savings}</p>
                    )}
                  </div>
                  <div className="bg-white/5 rounded-lg p-2">
                    <p className="text-xs text-white/50">Show Time</p>
                    <div className="flex items-center gap-1 text-white">
                      <Clock className="h-3 w-3 text-white/50" />
                      {deal.time}
                    </div>
                    <div className="flex items-center gap-1 text-xs text-white/50">
                      <Calendar className="h-3 w-3" />
                      {deal.date}
                    </div>
                  </div>
                </div>
                
                {deal.url && (
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => window.open(deal.url, "_blank")}
                    className="w-full mt-2 border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/10"
                  >
                    <ExternalLink className="h-4 w-4 mr-2" />
                    Get Tickets
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      ) : error ? (
        <div className="bg-white/5 border border-white/10 rounded-lg p-4">
          <AlertCircle className="h-4 w-4 text-red-400 mb-2" />
          <p className="text-white/60 text-sm">{error}</p>
        </div>
      ) : (
        <div className="bg-white/5 border border-white/10 rounded-lg p-8 text-center">
          <Ticket className="h-12 w-12 text-white/20 mx-auto mb-3" />
          <p className="text-white/60">No Broadway deals found. Try a different search or click refresh.</p>
        </div>
      )}
    </div>
  );
}
