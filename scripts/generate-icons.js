#!/usr/bin/env node
/**
 * Generates PNG icons for the PWA from the SVG source.
 * Run: node scripts/generate-icons.js
 * Requires: npm install (sharp is a devDependency)
 */
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const SVG = path.join(__dirname, '../public/icons/icon.svg');
const OUT = path.join(__dirname, '../public/icons');

async function make(svg, size, filename, background = '#050a0f') {
  const buf = fs.readFileSync(svg);
  await sharp(buf)
    .resize(size, size)
    .flatten({ background })
    .png()
    .toFile(path.join(OUT, filename));
  console.log(`  ✓ ${filename} (${size}x${size})`);
}

// Maskable icon: add safe-zone padding (80% of canvas = icon, 10% padding each side)
async function makeMaskable(svg, size, filename) {
  const iconSize = Math.round(size * 0.72);
  const padding = Math.round((size - iconSize) / 2);
  const buf = fs.readFileSync(svg);
  const resized = await sharp(buf).resize(iconSize, iconSize).png().toBuffer();
  await sharp({
    create: { width: size, height: size, channels: 4, background: '#050a0f' },
  })
    .composite([{ input: resized, top: padding, left: padding }])
    .png()
    .toFile(path.join(OUT, filename));
  console.log(`  ✓ ${filename} (${size}x${size} maskable)`);
}

(async () => {
  console.log('Generating PWA icons...');
  await make(SVG, 192, 'icon-192.png');
  await make(SVG, 512, 'icon-512.png');
  await makeMaskable(SVG, 512, 'icon-maskable.png');
  // Apple touch icon (180x180, white bg not needed for dark app)
  await make(SVG, 180, 'apple-touch-icon.png');
  // Favicon sizes
  await make(SVG, 32, 'favicon-32.png');
  await make(SVG, 16, 'favicon-16.png');
  console.log('Done.');
})().catch((e) => {
  console.error('Icon generation failed:', e.message);
  console.error('Run: npm install');
  process.exit(1);
});
