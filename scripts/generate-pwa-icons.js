#!/usr/bin/env node

/**
 * PWA Icon Generator Script
 *
 * This script generates PNG icons from the SVG source.
 * Run: node scripts/generate-icons.js
 *
 * Requires: sharp (npm install sharp)
 */

import fs from 'fs';
import path from 'path';

const ICON_SIZES = [
  { size: 72, filename: 'icon-72x72.png' },
  { size: 96, filename: 'icon-96x96.png' },
  { size: 128, filename: 'icon-128x128.png' },
  { size: 144, filename: 'icon-144x144.png' },
  { size: 152, filename: 'icon-152x152.png' },
  { size: 180, filename: 'icon-180x180.png' },
  { size: 192, filename: 'icon-192x192.png' },
  { size: 384, filename: 'icon-384x384.png' },
  { size: 512, filename: 'icon-512x512.png' },
];

async function generateIcons() {
  const svgPath = path.join(__dirname, '../public/icons/icon.svg');
  const outputDir = path.join(__dirname, '../public/icons');

  // Check if sharp is available
  let sharp;
  try {
    sharp = require('sharp');
  } catch (e) {
    console.error('Sharp not installed. Please run: npm install sharp');
    console.log('\nAlternatively, you can:');
    console.log('1. Use an online converter (e.g., cloudconvert.com/svg-to-png)');
    console.log('2. Use the SVG directly and reference it in manifest.json');
    console.log('3. Manually create PNG icons from icon.svg');
    process.exit(1);
  }

  // Check if SVG exists
  if (!fs.existsSync(svgPath)) {
    console.error('SVG icon not found at:', svgPath);
    process.exit(1);
  }

  console.log('Generating PWA icons...\n');

  for (const { size, filename } of ICON_SIZES) {
    const outputPath = path.join(outputDir, filename);
    
    try {
      await sharp(svgPath)
        .resize(size, size)
        .png()
        .toFile(outputPath);
      
      console.log(`✓ Generated ${filename} (${size}x${size})`);
    } catch (error) {
      console.error(`✗ Failed to generate ${filename}:`, error.message);
    }
  }

  console.log('\n✓ Icon generation complete!');
  console.log('\nIcons saved to:', outputDir);
}

generateIcons().catch(console.error);
