/**
 * Hacker News Daily Handler
 * 
 * Fetches top stories from Hacker News and optionally summarizes them.
 */

import { z } from 'zod';
import type { HACKER_NEWS_DAILY_EVENT } from '../../schema';

const HN_API_URL = 'https://hacker-news.firebaseio.com/v0';

export async function handleHackerNews(event: z.infer<typeof HACKER_NEWS_DAILY_EVENT>) {
  console.log(`[HNHandler] Fetching top stories for user ${event.userId}`);
  
  try {
    // Fetch top stories
    const topStoriesResp = await fetch(`${HN_API_URL}/topstories.json`);
    const storyIds: number[] = await topStoriesResp.json();
    
    // Get first 10 stories with details
    const topStories = await Promise.all(
      storyIds.slice(0, 10).map(async (id) => {
        const storyResp = await fetch(`${HN_API_URL}/item/${id}.json`);
        return storyResp.json();
      })
    );
    
    const formattedStories = topStories.map((s: any) => ({
      title: s.title,
      url: s.url,
      score: s.score,
      by: s.by,
      time: s.time,
      descendants: s.descendants,
    }));
    
    // If destination is provided, could send via webhook/email (placeholder)
    if (event.destination) {
      console.log(`[HNHandler] Would send digest to ${event.destination}`);
    }
    
    return {
      success: true,
      stories: formattedStories,
      count: formattedStories.length,
    };
  } catch (error: any) {
    console.error('[HNHandler] Error:', error.message);
    throw new Error(`Failed to fetch Hacker News: ${error.message}`);
  }
}