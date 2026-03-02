/**
 * SRI Hash Generator CLI
 *
 * Generates Subresource Integrity hashes for CDN resources.
 * Run with: pnpm tsx scripts/generate-sri.ts <url>
 *
 * @example
 * ```bash
 * # Generate SRI hash for a CDN script
 * pnpm tsx scripts/generate-sri.ts https://cdn.example.com/script.js
 *
 * # Generate with specific algorithm
 * pnpm tsx scripts/generate-sri.ts https://cdn.example.com/script.js --algorithm sha512
 *
 * # Generate for multiple resources
 * pnpm tsx scripts/generate-sri.ts --batch urls.txt
 * ```
 */

import { generateSRIHash, generateSRIHashes, fetchAndHashResource } from '../lib/security/sri-generator';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

interface CLIOptions {
  algorithm?: 'sha256' | 'sha384' | 'sha512';
  batch?: string;
  output?: string;
  help?: boolean;
}

function parseArgs(args: string[]): CLIOptions {
  const options: CLIOptions = {};
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--algorithm' || arg === '-a') {
      options.algorithm = args[++i] as 'sha256' | 'sha384' | 'sha512';
    } else if (arg === '--batch' || arg === '-b') {
      options.batch = args[++i];
    } else if (arg === '--output' || arg === '-o') {
      options.output = args[++i];
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (!arg.startsWith('-')) {
      positional.push(arg);
    }
  }

  if (positional.length > 0 && !options.batch) {
    // First positional is the URL
    return { ...options, batch: undefined };
  }

  return options;
}

function printHelp() {
  console.log(`
SRI Hash Generator - Generate Subresource Integrity hashes

Usage:
  pnpm tsx scripts/generate-sri.ts <url> [options]
  pnpm tsx scripts/generate-sri.ts --batch <file> [options]

Options:
  -a, --algorithm <algo>  Hash algorithm: sha256, sha384, sha512 (default: sha384)
  -b, --batch <file>      Process multiple URLs from a file (one per line)
  -o, --output <file>     Write results to a file instead of stdout
  -h, --help              Show this help message

Examples:
  # Single URL
  pnpm tsx scripts/generate-sri.ts https://cdn.example.com/script.js

  # With specific algorithm
  pnpm tsx scripts/generate-sri.ts https://cdn.example.com/script.js -a sha512

  # Batch processing
  pnpm tsx scripts/generate-sri.ts --batch urls.txt -o sri-hashes.json

Output Format:
  {
    "url": "https://cdn.example.com/script.js",
    "algorithm": "sha384",
    "hash": "base64-encoded-hash",
    "integrity": "sha384-base64-encoded-hash",
    "html": "<script src=\"...\" integrity=\"sha384-...\" crossorigin=\"anonymous\"></script>"
  }
`);
}

async function generateForUrl(
  url: string,
  algorithm?: 'sha256' | 'sha384' | 'sha512'
): Promise<any> {
  try {
    const result = await fetchAndHashResource(url, { algorithm });

    // Generate HTML snippets
    const isScript = url.endsWith('.js');
    const isStyle = url.endsWith('.css');

    let html = '';
    if (isScript) {
      html = `<script src="${url}" integrity="${result.integrity}" crossorigin="anonymous"></script>`;
    } else if (isStyle) {
      html = `<link rel="stylesheet" href="${url}" integrity="${result.integrity}" crossorigin="anonymous" />`;
    }

    return {
      url,
      algorithm: result.algorithm,
      hash: result.hash,
      integrity: result.integrity,
      html,
      success: true,
    };
  } catch (error) {
    return {
      url,
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

async function main() {
  const args = process.argv.slice(2);
  const options = parseArgs(args);

  if (options.help) {
    printHelp();
    process.exit(0);
  }

  const results: any[] = [];

  if (options.batch) {
    // Batch processing from file
    const batchFile = join(process.cwd(), options.batch);
    let urls: string[];

    try {
      const content = readFileSync(batchFile, 'utf-8');
      urls = content
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'));
    } catch (error) {
      console.error(`Error reading batch file: ${error}`);
      process.exit(1);
    }

    console.log(`Processing ${urls.length} URLs...`);

    for (const url of urls) {
      console.log(`  Fetching: ${url}`);
      const result = await generateForUrl(url, options.algorithm);
      results.push(result);

      if (result.success) {
        console.log(`  ✓ ${result.integrity.substring(0, 50)}...`);
      } else {
        console.log(`  ✗ ${result.error}`);
      }
    }
  } else if (args.length > 0 && !args[0].startsWith('-')) {
    // Single URL
    const url = args[0];
    console.log(`Fetching: ${url}`);
    const result = await generateForUrl(url, options.algorithm);
    results.push(result);

    if (result.success) {
      console.log('\n✅ SRI Hash Generated:\n');
      console.log(`Algorithm: ${result.algorithm}`);
      console.log(`Hash: ${result.hash}`);
      console.log(`Integrity: ${result.integrity}`);
      console.log(`\nHTML:\n${result.html}\n`);
    } else {
      console.log(`\n❌ Error: ${result.error}\n`);
      process.exit(1);
    }
  } else {
    console.error('Error: Please provide a URL or use --batch for batch processing');
    console.error('Use --help for usage information');
    process.exit(1);
  }

  // Write to file if specified
  if (options.output) {
    const outputFile = join(process.cwd(), options.output);
    writeFileSync(outputFile, JSON.stringify(results, null, 2));
    console.log(`\nResults written to: ${outputFile}`);
  } else if (options.batch) {
    // Always output JSON for batch processing
    console.log('\n--- Results ---');
    console.log(JSON.stringify(results, null, 2));
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
