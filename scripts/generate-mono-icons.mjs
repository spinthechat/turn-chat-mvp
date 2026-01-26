/**
 * Generate monochrome PWA icons for Android status bar/task switcher
 * Monochrome icons should be single-color (white on transparent) for Android to tint
 */

import sharp from 'sharp';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const iconsDir = path.join(__dirname, '../public/icons');

async function generateMonochromeIcon(inputFile, outputFile, size) {
  // Read the original icon
  const image = sharp(inputFile);
  const metadata = await image.metadata();

  // Convert to grayscale, then threshold to create a silhouette
  // For monochrome icons, we want white shapes on transparent background
  // Android will apply its own tint color
  await sharp(inputFile)
    .resize(size, size)
    // Extract alpha channel and use it as the white shape
    .ensureAlpha()
    .extractChannel('alpha')
    // Create white pixels where the original had content
    .negate()
    .toColourspace('b-w')
    .png()
    .toFile(outputFile);

  console.log(`Created ${outputFile}`);
}

async function generateSimpleMonochrome(inputFile, outputFile, size) {
  // Simpler approach: create a white silhouette from the alpha channel
  const input = await sharp(inputFile)
    .resize(size, size)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { data, info } = input;
  const { width, height, channels } = info;

  // Create new buffer with white where alpha > 0
  const outputData = Buffer.alloc(width * height * 4);

  for (let i = 0; i < width * height; i++) {
    const alpha = data[i * channels + (channels - 1)]; // Get alpha channel
    if (alpha > 50) {
      // White pixel with original alpha
      outputData[i * 4] = 255;     // R
      outputData[i * 4 + 1] = 255; // G
      outputData[i * 4 + 2] = 255; // B
      outputData[i * 4 + 3] = alpha; // A
    } else {
      // Transparent
      outputData[i * 4] = 0;
      outputData[i * 4 + 1] = 0;
      outputData[i * 4 + 2] = 0;
      outputData[i * 4 + 3] = 0;
    }
  }

  await sharp(outputData, {
    raw: {
      width,
      height,
      channels: 4
    }
  })
    .png()
    .toFile(outputFile);

  console.log(`Created ${outputFile}`);
}

async function main() {
  try {
    // Generate 192x192 monochrome icon
    await generateSimpleMonochrome(
      path.join(iconsDir, 'icon-192.png'),
      path.join(iconsDir, 'mono-192.png'),
      192
    );

    console.log('Monochrome icons generated successfully!');
  } catch (error) {
    console.error('Error generating monochrome icons:', error);
    process.exit(1);
  }
}

main();
