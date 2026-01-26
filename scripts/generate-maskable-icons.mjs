/**
 * Generate maskable PWA icons from existing icons
 * Maskable icons need content within the safe zone (inner 80%)
 * and a solid background that extends to all edges
 */

import sharp from 'sharp';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const iconsDir = path.join(__dirname, '../public/icons');

// Background color from the existing icon (dark blue)
const BACKGROUND_COLOR = '#2c4a7c';

async function generateMaskableIcon(inputFile, outputFile, size) {
  // For maskable icons, content should be within 80% safe zone
  // So we scale the icon to 80% and center it on a solid background
  const safeZoneSize = Math.round(size * 0.8);
  const padding = Math.round((size - safeZoneSize) / 2);

  // Read the original icon and resize to safe zone size
  const resizedIcon = await sharp(inputFile)
    .resize(safeZoneSize, safeZoneSize, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
    .toBuffer();

  // Create new image with solid background and composite the icon centered
  await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: BACKGROUND_COLOR
    }
  })
    .composite([{
      input: resizedIcon,
      left: padding,
      top: padding
    }])
    .png()
    .toFile(outputFile);

  console.log(`Created ${outputFile}`);
}

async function main() {
  try {
    // Generate 192x192 maskable icon
    await generateMaskableIcon(
      path.join(iconsDir, 'icon-192.png'),
      path.join(iconsDir, 'maskable-192.png'),
      192
    );

    // Generate 512x512 maskable icon
    await generateMaskableIcon(
      path.join(iconsDir, 'icon-512.png'),
      path.join(iconsDir, 'maskable-512.png'),
      512
    );

    console.log('Maskable icons generated successfully!');
  } catch (error) {
    console.error('Error generating maskable icons:', error);
    process.exit(1);
  }
}

main();
