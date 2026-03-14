#!/usr/bin/env node
/**
 * Generates PNG icons for the PWA from the SVG source.
 * Run: node scripts/generate-icons.js
 * Requires: npm install (sharp is a devDependency)
 */
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const SVG      = path.join(__dirname, '../public/icons/icon.svg');
const OUT_PUBLIC = path.join(__dirname, '../public/icons');
const OUT_DOCS   = path.join(__dirname, '../docs/icons');

async function make(svg, size, filename, background = '#050a0f') {
  const buf = fs.readFileSync(svg);
  const img = await sharp(buf).resize(size, size).flatten({ background }).png().toBuffer();
  for (const out of [OUT_PUBLIC, OUT_DOCS]) {
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, filename), img);
  }
  console.log(`  ✓ ${filename} (${size}x${size})`);
}

async function makeMaskable(svg, size, filename) {
  const iconSize = Math.round(size * 0.72);
  const padding  = Math.round((size - iconSize) / 2);
  const buf      = fs.readFileSync(svg);
  const resized  = await sharp(buf).resize(iconSize, iconSize).png().toBuffer();
  const img = await sharp({
    create: { width: size, height: size, channels: 4, background: '#050a0f' },
  })
    .composite([{ input: resized, top: padding, left: padding }])
    .png()
    .toBuffer();
  for (const out of [OUT_PUBLIC, OUT_DOCS]) {
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, filename), img);
  }
  console.log(`  ✓ ${filename} (${size}x${size} maskable)`);
}

(async () => {
  console.log('Generating PWA icons → public/icons/ + docs/icons/');
  await make(SVG, 192, 'icon-192.png');
  await make(SVG, 512, 'icon-512.png');
  await makeMaskable(SVG, 512, 'icon-maskable.png');
  await make(SVG, 180, 'apple-touch-icon.png');
  await make(SVG, 32,  'favicon-32.png');
  await make(SVG, 16,  'favicon-16.png');
  console.log('Done.');
})().catch((e) => {
  console.error('Icon generation failed:', e.message);
  console.error('Run: npm install');
  process.exit(1);
});
