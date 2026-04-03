/**
 * Broadway Deals API
 *
 * Aggregates deals and discounts from multiple sources
 * Supports retail, tech, travel, and entertainment deals
 */

import { NextRequest, NextResponse } from 'next/server';

export interface Deal {
  id: string;
  title: string;
  description: string;
  originalPrice: number;
  dealPrice: number;
  discount: number;
  store: string;
  category: string;
  imageUrl: string;
  dealUrl: string;
  expiresAt?: number;
  rating: number;
  votes: number;
  createdAt: number;
}

// Sample deals (in production, aggregate from real deal APIs)
const DEALS: Deal[] = [
  {
    id: 'deal-1',
    title: 'MacBook Pro M3 - 20% Off',
    description: 'Latest MacBook Pro with M3 chip, 16GB RAM, 512GB SSD',
    originalPrice: 1999,
    dealPrice: 1599,
    discount: 20,
    store: 'Best Buy',
    category: 'Tech',
    imageUrl: 'https://picsum.photos/seed/macbook/400/300',
    dealUrl: '#',
    expiresAt: Date.now() + 86400000 * 3,
    rating: 4.8,
    votes: 234,
    createdAt: Date.now() - 86400000 * 1,
  },
  {
    id: 'deal-2',
    title: 'Sony WH-1000XM5 Headphones',
    description: 'Industry-leading noise canceling headphones',
    originalPrice: 399,
    dealPrice: 299,
    discount: 25,
    store: 'Amazon',
    category: 'Tech',
    imageUrl: 'https://picsum.photos/seed/sony/400/300',
    dealUrl: '#',
    expiresAt: Date.now() + 86400000 * 5,
    rating: 4.9,
    votes: 567,
    createdAt: Date.now() - 86400000 * 2,
  },
  {
    id: 'deal-3',
    title: 'Nike Air Max - Buy 1 Get 1 50% Off',
    description: 'Select styles of Nike Air Max sneakers',
    originalPrice: 150,
    dealPrice: 112,
    discount: 25,
    store: 'Nike',
    category: 'Fashion',
    imageUrl: 'https://picsum.photos/seed/nike/400/300',
    dealUrl: '#',
    expiresAt: Date.now() + 86400000 * 7,
    rating: 4.5,
    votes: 189,
    createdAt: Date.now() - 86400000 * 3,
  },
  {
    id: 'deal-4',
    title: 'Disney+ Annual Subscription',
    description: 'Full year of Disney+ streaming for the price of 10 months',
    originalPrice: 140,
    dealPrice: 100,
    discount: 29,
    store: 'Disney',
    category: 'Entertainment',
    imageUrl: 'https://picsum.photos/seed/disney/400/300',
    dealUrl: '#',
    expiresAt: Date.now() + 86400000 * 10,
    rating: 4.7,
    votes: 423,
    createdAt: Date.now() - 86400000 * 4,
  },
  {
    id: 'deal-5',
    title: 'Dell XPS 15 Laptop',
    description: '15.6" OLED, Intel i7, 32GB RAM, 1TB SSD',
    originalPrice: 2299,
    dealPrice: 1799,
    discount: 22,
    store: 'Dell',
    category: 'Tech',
    imageUrl: 'https://picsum.photos/seed/dell/400/300',
    dealUrl: '#',
    expiresAt: Date.now() + 86400000 * 4,
    rating: 4.6,
    votes: 312,
    createdAt: Date.now() - 86400000 * 5,
  },
  {
    id: 'deal-6',
    title: 'Hawaii Vacation Package',
    description: '5 nights hotel + flights for 2 from LAX',
    originalPrice: 2500,
    dealPrice: 1899,
    discount: 24,
    store: 'Expedia',
    category: 'Travel',
    imageUrl: 'https://picsum.photos/seed/hawaii/400/300',
    dealUrl: '#',
    expiresAt: Date.now() + 86400000 * 14,
    rating: 4.8,
    votes: 678,
    createdAt: Date.now() - 86400000 * 6,
  },
];

const CATEGORIES = ['All', 'Tech', 'Fashion', 'Entertainment', 'Travel', 'Home', 'Gaming'];

/**
 * GET /api/deals - List deals
 * 
 * Query parameters:
 * - category: Filter by category
 * - store: Filter by store
 * - minDiscount: Minimum discount percentage
 * - sort: Sort by 'discount', 'rating', 'recent', 'expiring' (default: recent)
 * - limit: Max results (default: 50)
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const category = searchParams.get('category');
    const store = searchParams.get('store');
    const minDiscount = parseInt(searchParams.get('minDiscount') || '0');
    const sort = searchParams.get('sort') || 'recent';
    const limit = parseInt(searchParams.get('limit') || '50');

    let deals = [...DEALS];

    // Filter by category
    if (category && category !== 'All') {
      deals = deals.filter(d => d.category === category);
    }

    // Filter by store
    if (store) {
      deals = deals.filter(d => d.store.toLowerCase().includes(store.toLowerCase()));
    }

    // Filter by minimum discount
    if (minDiscount > 0) {
      deals = deals.filter(d => d.discount >= minDiscount);
    }

    // Sort
    deals.sort((a, b) => {
      switch (sort) {
        case 'discount':
          return b.discount - a.discount;
        case 'rating':
          return b.rating - a.rating;
        case 'expiring':
          return (a.expiresAt || Infinity) - (b.expiresAt || Infinity);
        case 'recent':
        default:
          return b.createdAt - a.createdAt;
      }
    });

    // Apply limit
    deals = deals.slice(0, limit);

    return NextResponse.json({
      success: true,
      deals,
      total: deals.length,
      categories: CATEGORIES,
      stores: [...new Set(DEALS.map(d => d.store))],
    });
  } catch (error: any) {
    console.error('[Deals API] Error:', error);
    return NextResponse.json(
      { error: 'Failed to load deals' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/deals/:id - Vote on deal
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, action } = body;

    if (!id || !action) {
      return NextResponse.json(
        { error: 'Deal ID and action are required' },
        { status: 400 }
      );
    }

    // In production, update database
    // For now, just return success
    return NextResponse.json({
      success: true,
      message: `Deal ${action}ed`,
    });
  } catch (error: any) {
    console.error('[Deals API] PUT error:', error);
    return NextResponse.json(
      { error: 'Failed to update deal' },
      { status: 500 }
    );
  }
}
