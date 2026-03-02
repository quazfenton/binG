import { NextRequest, NextResponse } from 'next/server';

type NpmSearchResponse = {
  objects?: Array<{
    package?: {
      name?: string;
      description?: string;
      version?: string;
      date?: string;
      publisher?: { username?: string };
      keywords?: string[];
    };
    score?: { final?: number };
  }>;
};

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const search = searchParams.get('search') || 'bing-plugin';
    const category = searchParams.get('category') || 'utility';

    const npmRes = await fetch(
      `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(search)}&size=50`,
      { cache: 'no-store' }
    );
    
    // Check if npm API request was successful
    if (!npmRes.ok) {
      console.error('Marketplace npm API error:', npmRes.status, npmRes.statusText);
      return NextResponse.json(
        { error: 'Failed to fetch plugins from npm registry' },
        { status: npmRes.status === 429 ? 429 : 502 }
      );
    }
    
    const data = (await npmRes.json()) as NpmSearchResponse;
    const objects = data.objects || [];

    const plugins = objects.map((obj) => {
      const pkg = obj.package || {};
      const score = obj.score?.final || 0;
      return {
        id: pkg.name || '',
        name: pkg.name || '',
        description: pkg.description || 'No description',
        version: pkg.version || '0.0.0',
        author: pkg.publisher?.username || 'Unknown',
        // Use plugin's own keywords for category, not the request category
        // This ensures category filtering works correctly
        category: pkg.keywords?.[0] || 'utility',
        rating: Math.min(5, Math.max(1, Number((score * 5).toFixed(1)))),
        downloads: 0,
        size: 'Unknown',
        lastUpdated: pkg.date || new Date(0).toISOString(),
        verified: false,
        featured: false,
        tags: pkg.keywords || [],
        // NPM Search API doesn't include dependencies; would need separate registry.npmjs.org/{pkg} call
        permissions: ['network'],
        screenshots: [],
        price: 0,
        installed: false,
        compatible: true,
      };
    });

    return NextResponse.json(plugins);
  } catch (error) {
    console.error('Marketplace fetch error:', error);
    return NextResponse.json({ error: 'Failed to fetch marketplace' }, { status: 500 });
  }
}
