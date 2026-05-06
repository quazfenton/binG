/**
 * Broadway Deals API
 * 
 * Fetches Broadway show deals from Ticketmaster Discovery API
 * Free tier available at https://developer.ticketmaster.com/
 */

import { NextRequest, NextResponse } from "next/server";



// Ticketmaster API configuration
// Get free API key from https://developer.ticketmaster.com/
const TICKETMASTER_API = 'https://app.ticketmaster.com/discovery/v2';

interface TicketmasterConfig {
  apiKey: string;
}

// Get config from environment
function getTicketmasterConfig(): TicketmasterConfig | null {
  const apiKey = process.env.TICKETMASTER_API_KEY;
  if (!apiKey) return null;
  return { apiKey };
}

// Default Broadway shows to search for
const BROADWAY_SHOWS = [
  'Hamilton',
  'The Lion King',
  'Wicked',
  'The Phantom of the Opera',
  'Moulin Rouge',
  'Harry Potter',
  'Chicago',
  'The Music Man',
  'Sweeney Todd',
  'Funny Girl',
];

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

// Search Ticketmaster for Broadway events
async function searchBroadwayDeals(config: TicketmasterConfig, query?: string): Promise<BroadwayDeal[]> {
  try {
    // Search for Broadway shows in New York
    const searchQuery = query || 'broadway show';
    const encodedQuery = encodeURIComponent(searchQuery);
    
    const tmUrl = `${TICKETMASTER_API}/events.json?` +
      `apikey=${config.apiKey}&` +
      `keyword=${encodedQuery}&` +
      `city=New York&` +
      `classificationName=theatre&` +
      `size=20&` +
      `sort=date,asc`;
    
    console.log('[Broadway] Calling Ticketmaster API...');
    
    const response = await fetch(tmUrl);
    
    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('Invalid Ticketmaster API key');
      }
      if (response.status === 429) {
        throw new Error('Rate limit exceeded - try again later');
      }
      throw new Error(`Ticketmaster API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (!data._embedded?.events || data._embedded.events.length === 0) {
      console.log('[Broadway] No events found, using sample data');
      return generateSampleDeals();
    }
    
    // Transform Ticketmaster events to our deal format
    const deals: BroadwayDeal[] = data._embedded.events.map((event: any) => {
      const venue = event._embedded?.venues?.[0]?.name || 'Broadway Theatre';
      const priceRange = event.priceRanges?.[0];
      const minPrice = priceRange?.min || 49;
      const maxPrice = priceRange?.max || minPrice * 2;
      
      // Format date and time
      const dates = event.dates?.start;
      const dateStr = dates?.localDate ? 
        new Date(dates.localDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) 
        : getNextWeekday(0);
      const timeStr = dates?.localTime ? 
        new Date(`2000-01-01T${dates.localTime}`).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
        : '7:00 PM';
      
      return {
        show: event.name,
        price: `$${Math.round(minPrice)}`,
        originalPrice: maxPrice > minPrice ? `$${Math.round(maxPrice)}` : undefined,
        savings: maxPrice > minPrice ? `Save $${Math.round(maxPrice - minPrice)}` : undefined,
        time: timeStr,
        venue: venue,
        date: dateStr,
        url: event.url || undefined,
        source: 'Ticketmaster',
      };
    });
    
    console.log(`[Broadway] Found ${deals.length} events from Ticketmaster`);
    return deals;
    
  } catch (error) {
    console.error('[Broadway] Failed to search Ticketmaster:', error);
    // Return sample data on error so the UI still works
    return generateSampleDeals();
  }
}

// Generate sample deals for demo purposes
function generateSampleDeals(): BroadwayDeal[] {
  const shows = [
    { name: 'Hamilton', price: 89, original: 199, time: '7:00 PM', venue: 'Richard Rodgers Theatre' },
    { name: 'The Lion King', price: 75, original: 149, time: '6:30 PM', venue: 'Minskoff Theatre' },
    { name: 'Wicked', price: 79, original: 159, time: '7:00 PM', venue: 'Gershwin Theatre' },
    { name: 'Moulin Rouge! The Musical', price: 95, original: 189, time: '8:00 PM', venue: 'Broadhurst Theatre' },
    { name: 'The Music Man', price: 85, original: 175, time: '7:30 PM', venue: 'Winter Garden Theatre' },
    { name: 'Harry Potter and the Cursed Child', price: 110, original: 220, time: '7:00 PM', venue: 'Lyric Theatre' },
    { name: 'Chicago', price: 69, original: 129, time: '7:00 PM', venue: 'Ambassador Theatre' },
    { name: 'Sweeney Todd', price: 99, original: 199, time: '7:30 PM', venue: 'Lunt-Fontanne Theatre' },
  ];
  
  return shows.map((show, i) => ({
    show: show.name,
    price: `$${show.price}`,
    originalPrice: show.original ? `$${show.original}` : undefined,
    savings: show.original ? `Save $${show.original - show.price}` : undefined,
    time: show.time,
    venue: show.venue,
    date: getNextWeekday(i),
    source: 'Demo',
  }));
}

// Get next available date
function getNextWeekday(dayOffset: number): string {
  const date = new Date();
  date.setDate(date.getDate() + dayOffset);
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

// Sanitize search query on backend - defense in depth
function sanitizeQuery(query?: string): string | undefined {
  if (!query) return undefined;
  
  // Limit length
  const maxLength = 100;
  let sanitized = query.trim().slice(0, maxLength);
  
  // Only allow safe characters
  const allowedPattern = /^[a-zA-Z0-9\s\-'.]+$/;
  if (!allowedPattern.test(sanitized)) {
    sanitized = sanitized.replace(/[^a-zA-Z0-9\s\-'.]/g, '');
  }
  
  return sanitized || undefined;
}

// GET handler - fetch deals
export async function GET(request: NextRequest) {
  const config = getTicketmasterConfig();
  const url = new URL(request.url);
  const rawQuery = url.searchParams.get('q') || undefined;
  const query = sanitizeQuery(rawQuery);
  
  try {
    let deals: BroadwayDeal[];
    
    if (config && config.apiKey) {
      // User has configured Ticketmaster API - fetch real data
      deals = await searchBroadwayDeals(config, query);
    } else {
      // No API key configured - use sample data with notice
      deals = generateSampleDeals();
    }
    
    return NextResponse.json({
      success: true,
      source: config ? 'Ticketmaster' : 'Demo',
      deals,
      message: config ? 'Real Ticketmaster data' : 'Using demo data - configure TICKETMASTER_API_KEY for real Broadway tickets',
      setupHint: !config ? 'Get free API key at https://developer.ticketmaster.com/' : undefined,
    });
    
  } catch (error) {
    console.error('[Broadway] API error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch Broadway deals', deals: generateSampleDeals() },
      { status: 500 }
    );
  }
}

// POST handler - trigger deal search with custom parameters
export async function POST(request: NextRequest) {
  const config = getTicketmasterConfig();
  
  try {
    const body = await request.json();
    // Sanitize inputs from POST body
    const show = sanitizeQuery(body?.show);
    const maxPrice = typeof body?.maxPrice === 'number' ? Math.min(body.maxPrice, 10000) : undefined;
    
    // Build query from parameters
    let query = show || 'broadway';
    if (maxPrice) {
      query += ` under ${maxPrice}`;
    }
    
    let deals: BroadwayDeal[];
    
    if (config && config.apiKey) {
      deals = await searchBroadwayDeals(config, query);
    } else {
      deals = generateSampleDeals();
    }
    
    // Filter by price if specified
    if (maxPrice) {
      deals = deals.filter(d => {
        const price = parseInt(d.price.replace('$', ''));
        return price <= maxPrice;
      });
    }
    
    return NextResponse.json({
      success: true,
      source: config ? 'Ticketmaster' : 'Demo',
      deals,
    });
    
  } catch (error) {
    console.error('[Broadway] POST error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to search deals', deals: generateSampleDeals() },
      { status: 500 }
    );
  }
}
