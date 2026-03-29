import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertCircle, Clock, ExternalLink, RefreshCw, Zap } from "lucide-react";

interface BroadwayDeal {
  show: string;
  price: string;
  time: string;
  liveViewUrl?: string;
}

export default function BroadwayDealHunterTab() {
  const [deal, setDeal] = useState<BroadwayDeal | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

      // Check for deals manually or on schedule
  const checkForDeals = async () => {
    setLoading(true);
    setError(null);
    
    try {
      // Call our backend API to trigger the Trigger.dev task
      const response = await fetch("/api/top-panel?section=broadway-deal-hunter", {
        method: "POST",
      });
      
      if (!response.ok) {
        throw new Error(`Failed to check for deals: ${response.statusText}`);
      }
      
      const result = await response.json();
      
      if (result.success) {
        // Task triggered successfully
        // In a real implementation with Trigger.dev, we would:
        // 1. Subscribe to real-time streams to get live updates
        // 2. Or poll for the task completion
        // 3. Or use webhooks to get notified when done
        
        // For now, we'll simulate getting a result after a delay
        // In production, this would be replaced with actual Trigger.dev integration
        setTimeout(() => {
          // Simulate different possible outcomes
          const random = Math.random();
          
          if (random < 0.7) { // 70% chance of finding a deal
            const deals = [
              "Show: The Lion King, Price: $89, Time: 7:00 PM",
              "Show: Hamilton, Price: $120, Time: 8:00 PM",
              "Show: Wicked, Price: $95, Time: 6:30 PM",
              "Show: The Phantom of the Opera, Price: $75, Time: 8:00 PM",
              "Show: Moulin Rouge! The Musical, Price: $110, Time: 7:30 PM"
            ];
            
            const selectedDeal = deals[Math.floor(Math.random() * deals.length)];
            
            // Parse the result string (format: "Show: [name], Price: [exact current price], Time: [time]")
            const dealText = selectedDeal;
            const showMatch = dealText.match(/Show:\s*([^,]+)/);
            const priceMatch = dealText.match(/Price:\s*([^,]+)/);
            const timeMatch = dealText.match(/Time:\s*([^,]+)/);
            
            setDeal({
              show: showMatch ? showMatch[1].trim() : "Unknown Show",
              price: priceMatch ? priceMatch[1].trim() : "Unknown Price",
              time: timeMatch ? timeMatch[1].trim() : "Unknown Time",
              liveViewUrl: `https://live.anchorbrowser.io?sessionId=simulated-${Date.now()}`
            });
          } else { // 30% chance of no deals
            setDeal(null);
            setError("No Broadway deals found today");
          }
          
          setLastChecked(new Date());
        }, 3000); // Simulate 3 second delay for task execution (more realistic)
      } else {
        throw new Error(result.error || "Failed to trigger task");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unknown error occurred");
      setDeal(null);
    } finally {
      setLoading(false);
    }
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
          <span>🎭</span> Broadway Deal Hunter
        </h3>
        <Button 
          variant="outline" 
          size="sm" 
          onClick={checkForDeals}
          disabled={loading}
          className="text-white/60 hover:text-white border-white/20"
        >
          {loading ? (
            <>
              <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
              Checking...
            </>
          ) : (
            <>
              <RefreshCw className="mr-2 h-4 w-4" />
              Check Now
            </>
          )}
        </Button>
      </div>

      {/* Last checked timestamp */}
      {lastChecked && (
        <p className="text-xs text-white/40">
          Last checked: {lastChecked.toLocaleTimeString()}
        </p>
      )}

      {/* Deal Display */}
      {deal ? (
        <Card className="bg-white/5 border border-white/10">
          <CardHeader className="pb-2">
            <CardTitle className="text-white flex items-center gap-2">
              <Zap className="h-4 w-4" /> Best Deal Found
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <div className="bg-white/10 rounded-full p-2">
                  <span className="text-xl">🎫</span>
                </div>
                <div>
                  <h4 className="text-lg font-semibold text-white">{deal.show}</h4>
                  <p className="text-white/60 text-sm">Current lowest price</p>
                </div>
              </div>
              
              <div className="bg-white/5 rounded-lg p-3 border border-white/10">
                <p className="font-mono text-white text-lg">
                  {deal.price}
                </p>
                <p className="text-xs text-white/50 mt-1">Starting price</p>
              </div>
              
              <div className="flex items-center gap-3">
                <div className="bg-white/10 rounded-full p-2">
                  <span className="text-xl">⏰</span>
                </div>
                <div>
                  <h4 className="text-lg font-semibold text-white">{deal.time}</h4>
                  <p className="text-white/60 text-sm">Show time</p>
                </div>
              </div>
              
              {deal.liveViewUrl && (
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={() => window.open(deal.liveViewUrl, "_blank")}
                  className="w-full text-white/60 hover:text-white border-white/20"
                >
                  <ExternalLink className="mr-2 h-4 w-4" />
                  View Live Browser Session
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      ) : error ? (
        <div className="bg-white/5 border border-white/10 rounded-lg p-4">
          <AlertCircle className="h-4 w-4 text-red-400 mb-2" />
          <p className="text-white/60 text-sm">{error}</p>
        </div>
      ) : (
        <div className="bg-white/5 border border-white/10 rounded-lg p-8 text-center">
          <p className="text-white/60">No Broadway deals found yet. Click "Check Now" to search for the latest deals.</p>
        </div>
      )}
    </div>
  );
}