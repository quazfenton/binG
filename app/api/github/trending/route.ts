import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

interface ScrapedRepo {
  rank: number;
  name: string;
  full_name: string;
  owner: string;
  description: string;
  language: string;
  stars: number;
  forks: number;
  todayStars: number;
  url: string;
}

/**
 * Fetch GitHub trending repositories by scraping the trending page.
 * This avoids API rate limits by parsing the HTML directly.
 */
async function scrapeTrendingRepos(timeframe: 'daily' | 'weekly' | 'monthly' = 'daily'): Promise<ScrapedRepo[]> {
  const url = `https://github.com/trending?since=${timeframe}`;
  
  const response = await fetch(url, {
    headers: {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch trending page: ${response.statusText}`);
  }

  const html = await response.text();
  const repos: ScrapedRepo[] = [];

  // Parse the HTML to extract repository information
  // GitHub's trending page structure: articles with class "Box-row"
  const articleRegex = /<article[^>]*class="Box-row"[^>]*>([\s\S]*?)<\/article>/g;
  let articleMatch;
  let rank = 1;

  while ((articleMatch = articleRegex.exec(html)) !== null) {
    const articleHtml = articleMatch[1];
    
    // Extract repo name and owner
    const nameMatch = articleHtml.match(/href="\/([^"]+\/[^"]+)"[^>]*>\s*([\s\S]*?)<\//);
    if (!nameMatch) continue;

    const fullName = nameMatch[1].replace(/"/g, '').trim();
    const [owner, name] = fullName.split('/');
    
    // Extract description
    const descMatch = articleHtml.match(/<p[^>]*class="col-9 color-fg-muted text-sm mt-1"[^>]*>\s*([\s\S]*?)\s*<\/p>/);
    const description = descMatch 
      ? descMatch[1].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim() 
      : '';

    // Extract language
    const langMatch = articleHtml.match(/<span[^>]*class="color-fg-default text-sm ml-2"[^>]*>([^<]+)<\/span>/);
    const language = langMatch ? langMatch[1].trim() : '';

    // Extract stars
    const starsMatch = articleHtml.match(/href="\/[^"]+\/stargazers"[^>]*>\s*([\d,\.]+[kKmM]?)\s*<\//);
    const stars = parseNumber(starsMatch ? starsMatch[1] : '0');

    // Extract forks
    const forksMatch = articleHtml.match(/href="\/[^"]+\/forks"[^>]*>\s*([\d,\.]+[kKmM]?)\s*<\//);
    const forks = parseNumber(forksMatch ? forksMatch[1] : '0');

    // Extract today's stars (for daily trending)
    let todayStars = 0;
    if (timeframe === 'daily') {
      const todayStarsMatch = articleHtml.match(/<svg[^>]*class="octicon octicon-star"[^>]*<\/svg>[^<]*([\d,\.]+[kKmM]?)/);
      if (todayStarsMatch) {
        todayStars = parseNumber(todayStarsMatch[1]);
      }
    }

    repos.push({
      rank,
      name,
      full_name: fullName,
      owner,
      description,
      language,
      stars,
      forks,
      todayStars,
      url: `https://github.com/${fullName}`,
    });

    rank++;
  }

  return repos;
}

/**
 * Parse number strings that may contain k/m suffixes or commas
 */
function parseNumber(str: string): number {
  if (!str) return 0;
  
  const clean = str.toLowerCase().trim();
  
  if (clean.includes('k')) {
    return Math.round(parseFloat(clean.replace('k', '')) * 1000);
  }
  
  if (clean.includes('m')) {
    return Math.round(parseFloat(clean.replace('m', '')) * 1000000);
  }
  
  return parseInt(clean.replace(/,/g, ''), 10) || 0;
}

/**
 * Fallback: Use GitHub API to fetch popular repos if scraping fails
 */
async function fetchPopularRepos(): Promise<ScrapedRepo[]> {
  const response = await fetch(
    'https://api.github.com/search/repositories?q=stars:>10000&sort=stars&order=desc&per_page=25',
    {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'GitHub-Trending-Explorer',
      },
    }
  );

  if (!response.ok) {
    throw new Error('Failed to fetch popular repositories from GitHub API');
  }

  const data = await response.json();
  
  return (data.items || []).map((repo: any, idx: number) => ({
    rank: idx + 1,
    name: repo.name,
    full_name: repo.full_name,
    owner: repo.owner.login,
    description: repo.description || '',
    language: repo.language || '',
    stars: repo.stargazers_count,
    forks: repo.forks_count,
    todayStars: 0,
    url: repo.html_url,
  }));
}

export async function GET() {
  try {
    // Try scraping first, fallback to API
    let repos: ScrapedRepo[];
    
    try {
      repos = await scrapeTrendingRepos('daily');
    } catch (scrapeError) {
      console.warn('Scraping failed, using API fallback:', scrapeError);
      repos = await fetchPopularRepos();
    }

    if (repos.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No repositories found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        repos,
        fetchedAt: new Date().toISOString(),
        source: 'github-trending',
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to fetch trending repositories';
    console.error('Error fetching trending repos:', error);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
