#!/usr/bin/env node

/**
 * GitHub Trending CLI Helper
 *
 * A command-line tool to fetch trending GitHub repositories and clone them.
 * Usage:
 *   node scripts/github-trending-cli.js              # Fetch and display trending repos
 *   node scripts/github-trending-cli.js --clone 1    # Clone the #1 trending repo
 *   node scripts/github-trending-cli.js --clone 1,2,3 # Clone multiple repos
 *   node scripts/github-trending-cli.js --help       # Show help
 *
 * SECURITY: Uses spawn with args array to prevent command injection
 */

import https from 'https';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

const GITHUB_TRENDING_URL = 'https://github.com/trending?since=daily';
const CLONE_BASE_PATH = path.join(process.cwd(), 'repos');

/**
 * Fetch HTML content from a URL
 */
function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Request failed: ${res.statusCode}`));
        return;
      }

      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

/**
 * Parse trending repositories from GitHub HTML
 */
function parseTrendingRepos(html) {
  const repos = [];
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
      : 'No description';

    // Extract language
    const langMatch = articleHtml.match(/<span[^>]*class="color-fg-default text-sm ml-2"[^>]*>([^<]+)<\/span>/);
    const language = langMatch ? langMatch[1].trim() : 'Unknown';

    // Extract stars (simplified)
    const starsMatch = articleHtml.match(/href="\/[^"]+\/stargazers"[^>]*>\s*([\d,\.]+[kKmM]?)\s*<\//);
    const stars = parseNumber(starsMatch ? starsMatch[1] : '0');

    // Extract forks
    const forksMatch = articleHtml.match(/href="\/[^"]+\/forks"[^>]*>\s*([\d,\.]+[kKmM]?)\s*<\//);
    const forks = parseNumber(forksMatch ? forksMatch[1] : '0');

    repos.push({
      rank,
      name,
      full_name: fullName,
      owner,
      description,
      language,
      stars,
      forks,
      url: `https://github.com/${fullName}`,
    });

    rank++;
  }

  return repos;
}

/**
 * Parse number strings with k/m suffixes
 */
function parseNumber(str) {
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
 * Display repos in a formatted table
 */
function displayRepos(repos) {
  console.log('\n🔥 GitHub Trending Repositories (Daily)\n');
  console.log('='.repeat(80));
  
  repos.forEach((repo, idx) => {
    const rank = `#${repo.rank}`.padEnd(4);
    const name = repo.full_name.padEnd(40);
    const stars = `⭐ ${repo.stars.toLocaleString()}`.padEnd(15);
    const forks = `🍴 ${repo.forks.toLocaleString()}`.padEnd(12);
    const lang = repo.language ? `📦 ${repo.language}`.padEnd(15) : ''.padEnd(15);
    
    console.log(`${rank} ${name} ${stars} ${forks} ${lang}`);
    console.log(`   ${repo.description.substring(0, 70)}${repo.description.length > 70 ? '...' : ''}`);
    console.log('   ' + '-'.repeat(76));
  });
  
  console.log('\n💡 Tip: Use --clone <rank> to clone a repository (e.g., --clone 1)');
  console.log('   Example: node scripts/github-trending-cli.js --clone 1,2,3\n');
}

/**
 * Clone a repository securely using spawn with args array
 * SECURITY: Prevents command injection by using args array instead of string interpolation
 */
function cloneRepo(repoUrl, rank) {
  const repoName = repoUrl.replace('https://github.com/', '').replace('.git', '');
  const destPath = path.join(CLONE_BASE_PATH, repoName.split('/')[1]);

  console.log(`\n🔄 Cloning #${rank}: ${repoName}...`);
  console.log(`   Destination: ${destPath}\n`);

  // Ensure base directory exists
  if (!fs.existsSync(CLONE_BASE_PATH)) {
    fs.mkdirSync(CLONE_BASE_PATH, { recursive: true });
  }

  return new Promise((resolve, reject) => {
    // SECURITY: Use spawn with args array to prevent command injection
    const child = spawn('git', ['clone', repoUrl, destPath], {
      stdio: 'inherit',
      cwd: process.cwd(),
      shell: false, // Explicitly disable shell interpretation
    });

    child.on('close', (code) => {
      if (code === 0) {
        console.log(`\n✅ Successfully cloned ${repoName} to ${destPath}\n`);
        resolve(true);
      } else {
        console.error(`\n❌ Failed to clone ${repoName}: git clone failed with exit code ${code}\n`);
        resolve(false);
      }
    });

    child.on('error', (error) => {
      console.error(`\n❌ Failed to clone ${repoName}: ${error.message}\n`);
      resolve(false);
    });
  });
}

/**
 * Show help message
 */
function showHelp() {
  console.log(`
GitHub Trending CLI Helper
==========================

Usage:
  node scripts/github-trending-cli.js [options]

Options:
  --help, -h          Show this help message
  --clone <ranks>     Clone repositories by rank (comma-separated)
  --weekly            Fetch weekly trending instead of daily
  --monthly           Fetch monthly trending instead of daily
  --json              Output as JSON instead of formatted text

Examples:
  # Fetch and display trending repos
  node scripts/github-trending-cli.js

  # Clone the #1 trending repository
  node scripts/github-trending-cli.js --clone 1

  # Clone multiple repositories
  node scripts/github-trending-cli.js --clone 1,2,3

  # Fetch weekly trending
  node scripts/github-trending-cli.js --weekly

  # Output as JSON
  node scripts/github-trending-cli.js --json
`);
}

/**
 * Main function
 */
async function main() {
  const args = process.argv.slice(2);
  
  // Parse arguments
  if (args.includes('--help') || args.includes('-h')) {
    showHelp();
    process.exit(0);
  }
  
  const cloneIndex = args.indexOf('--clone');
  const ranksToClone = cloneIndex !== -1 
    ? args[cloneIndex + 1].split(',').map(n => parseInt(n.trim(), 10))
    : null;
  
  const useWeekly = args.includes('--weekly');
  const useMonthly = args.includes('--monthly');
  const outputJson = args.includes('--json');
  
  const timeframe = useMonthly ? 'monthly' : useWeekly ? 'weekly' : 'daily';
  
  try {
    // Fetch trending page
    const url = `${GITHUB_TRENDING_URL}&since=${timeframe}`;
    const html = await fetchUrl(url);
    
    // Parse repositories
    const repos = parseTrendingRepos(html);
    
    if (repos.length === 0) {
      console.error('❌ No repositories found. GitHub may have changed their HTML structure.');
      process.exit(1);
    }
    
    // Output results
    if (outputJson) {
      console.log(JSON.stringify({ repos, fetchedAt: new Date().toISOString() }, null, 2));
    } else if (ranksToClone) {
      // Clone specified repositories
      const successful = [];
      const failed = [];

      for (const rank of ranksToClone) {
        const repo = repos.find(r => r.rank === rank);
        if (!repo) {
          console.error(`❌ Repository #${rank} not found`);
          failed.push(rank);
          continue;
        }

        // SECURITY: cloneRepo now returns a Promise, so we await it
        const success = await cloneRepo(repo.url, rank);
        if (success) {
          successful.push(rank);
        } else {
          failed.push(rank);
        }
      }

      console.log(`\n📊 Summary: ${successful.length} cloned, ${failed.length} failed`);
      if (failed.length > 0) {
        process.exit(1);
      }
    } else {
      // Display formatted list
      displayRepos(repos);
    }
    
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    process.exit(1);
  }
}

// Run main function
main();
