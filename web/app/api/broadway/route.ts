/**
 * Broadway Deals API
 *
 * GET /api/broadway - List Broadway show deals
 * POST /api/broadway - Search with custom parameters
 */

import { NextRequest, NextResponse } from "next/server";

const TICKETMASTER_API = 'https://app.ticketmaster.com/discovery/v2';

interface TicketmasterConfig {
  apiKey: string;
}

function getTicketmasterConfig(): TicketmasterConfig | null {
  const apiKey = process.env.TICKETMASTER_API_KEY;
  if (!apiKey) return null;
  return { apiKey };
}

const BROADWAY_SHOWS = [
  'Hamilton', 'The Lion King', 'Wicked', 'The Phantom of the Opera',
  'Moulin Rouge', 'Harry Potter', 'Chicago', 'The Music Man',
  'Sweeney Todd', 'Funny Girl',
];

interface BroadwayDeal {
  show: string; price: string; originalPrice?: string;
  savings?: string; time: string; venue: string; date: string;
  url?: string; source: string;
}

async function searchBroadwayDeals(config: TicketmasterConfig, query?: string): Promise<BroadwayDeal[]> {
  try {
    const searchQuery = query || 'broadway show';
    const encodedQuery = encodeURIComponent(searchQuery);
    const tmUrl = `${TICKETMASTER_API}/events.json?apikey=${config.apiKey}&keyword=${encodedQuery}&city=New York&classificationName=theatre&size=20&sort=date,asc`;
    const response = await fetch(tmUrl);
    if (!response.ok) throw new Error(`Ticketmaster API error: ${response.status}`);
    const data = await response.json();
    if (!data._embedded?.events || data._embedded.events.length === 0) return generateSampleDeals();
    return data._embedded.events.map((event: any) => {
      const venue = event._embedded?.venues?.[0]?.name || 'Broadway Theatre';
      const priceRange = event.priceRanges?.[0];
      const minPrice = priceRange?.min || 49;
      const maxPrice = priceRange?.max || minPrice * 2;
      const dates = event.dates?.start;
      const dateStr = dates?.localDate ? new Date(dates.localDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : getNextWeekday(0);
      const timeStr = dates?.localTime ? new Date(`2000-01-01T${dates.localTime}`).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '7:00 PM';
      return {
        show: event.name, price: `$${Math.round(minPrice)}`,
        originalPrice: maxPrice > minPrice ? `$${Math.round(maxPrice)}` : undefined,
        savings: maxPrice > minPrice ? `Save $${Math.round(maxPrice - minPrice)}` : undefined,
        time: timeStr, venue, date: dateStr, url: event.url || undefined, source: 'Ticketmaster',
      };
    });
  } catch (error) {
    return generateSampleDeals();
  }
}

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
    show: show.name, price: `$${show.price}`,
    originalPrice: show.original ? `$${show.original}` : undefined,
    savings: show.original ? `Save $${show.original - show.price}` : undefined,
    time: show.time, venue: show.venue, date: getNextWeekday(i), source: 'Demo',
  }));
}

function getNextWeekday(dayOffset: number): string {
  const date = new Date(); date.setDate(date.getDate() + dayOffset);
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function sanitizeQuery(query?: string): string | undefined {
  if (!query) return undefined;
  const maxLength = 100;
  let sanitized = query.trim().slice(0, maxLength);
  const allowedPattern = /^[a-zA-Z0-9\s\-'.]+$/;
  if (!allowedPattern.test(sanitized)) sanitized = sanitized.replace(/[^a-zA-Z0-9\s\-'.]/g, '');
  return sanitized || undefined;
}

export async function GET(request: NextRequest) {
  const config = getTicketmasterConfig();
  const rawQuery = new URL(request.url).searchParams.get('q') || undefined;
  const query = sanitizeQuery(rawQuery);
  const deals = config && config.apiKey
    ? await searchBroadwayDeals(config, query)
    : generateSampleDeals();
  return NextResponse.json({
    success: true, source: config ? 'Ticketmaster' : 'Demo',
    deals, message: config ? 'Real Ticketmaster data' : 'Using demo data - configure TICKETMASTER_API_KEY',
    setupHint: !config ? 'Get free API key at https://developer.ticketmaster.com/' : undefined,
  });
}

export async function POST(request: NextRequest) {
  const config = getTicketmasterConfig();
  try {
    const body = await request.json();
    const show = sanitizeQuery(body?.show);
    const maxPrice = typeof body?.maxPrice === 'number' ? Math.min(body.maxPrice, 10000) : undefined;
    let query = show || 'broadway';
    if (maxPrice) query += ` under ${maxPrice}`;
    let deals = config && config.apiKey
      ? await searchBroadwayDeals(config, query)
      : generateSampleDeals();
    if (maxPrice) deals = deals.filter(d => parseInt(d.price.replace('$', '')) <= maxPrice);
    return NextResponse.json({ success: true, source: config ? 'Ticketmaster' : 'Demo', deals });
  } catch (error) {
    return NextResponse.json({ success: false, error: 'Failed to search deals', deals: generateSampleDeals() }, { status: 500 });
  }
}
