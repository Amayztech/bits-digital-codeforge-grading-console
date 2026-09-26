/**
 * Generates the optimised brand assets from the supplied crest.
 *
 *   node tools/brand-assets.js
 *
 * The source is a 1200x1200 WebP. The header mark renders at 40 CSS pixels, so
 * shipping 1200px would waste ~90 KB per page load. Chromium's canvas is used as
 * the resampler, which keeps this dependency-free.
 *
 * Outputs to assets/brand/:
 *   bits-pilani-crest.webp   256px  header mark (6x density at 40 CSS px)
 *   bits-pilani-crest.png    128px  fallback, only fetched without WebP
 * and to assets/:
 *   favicon.png               64px
 *   favicon-32.png            32px
 *   apple-touch-icon.png     180px
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { server, PORT } = require('./serve.js');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'artifacts', 'bitspilanilogo.webp');
const BRAND = path.join(ROOT, 'assets', 'brand');

const TARGETS = [
  { file: path.join(BRAND, 'bits-pilani-crest.webp'), size: 256, type: 'image/webp', quality: 0.94 },
  { file: path.join(BRAND, 'bits-pilani-crest.png'), size: 128, type: 'image/png' },
  { file: path.join(ROOT, 'assets', 'favicon.png'), size: 64, type: 'image/png' },
  { file: path.join(ROOT, 'assets', 'favicon-32.png'), size: 32, type: 'image/png' },
  { file: path.join(ROOT, 'assets', 'apple-touch-icon.png'), size: 180, type: 'image/png' }
];

(async () => {
  if (!fs.existsSync(SOURCE)) {
    console.error('Missing source crest: ' + SOURCE);
    process.exit(1);
  }
  fs.mkdirSync(BRAND, { recursive: true });
  await new Promise((r) => server.listen(PORT, r));

  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('http://localhost:' + PORT + '/index.html', { waitUntil: 'domcontentloaded' });

  const sourceBytes = fs.statSync(SOURCE).size;

  // Report what we are actually working with, so the choice to keep the alpha
  // channel is informed rather than assumed.
  const probe = await page.evaluate(async () => {
    const img = new Image();
    img.src = '/artifacts/bitspilanilogo.webp';
    await img.decode();
    const c = document.createElement('canvas');
    c.width = c.height = img.naturalWidth;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    const at = (x, y) => d[(y * c.width + x) * 4 + 3];
    const corners = [at(0, 0), at(c.width - 1, 0), at(0, c.height - 1), at(c.width - 1, c.height - 1)];
    // How much of the frame carries ink?
    let opaque = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 16) opaque++;
    return {
      w: img.naturalWidth,
      h: img.naturalHeight,
      cornerAlpha: corners,
      coverage: opaque / (c.width * c.height)
    };
  });
  console.log(
    '  source ' + probe.w + 'x' + probe.h +
      '  corner alpha ' + probe.cornerAlpha.join(',') +
      '  ink coverage ' + (probe.coverage * 100).toFixed(1) + '%'
  );
  console.log(
    probe.cornerAlpha.every((a) => a === 0)
      ? '  transparent corners: the crest is a clean alpha cutout, no background to remove'
      : '  WARNING: corners are opaque, the crest may carry a solid background'
  );

  for (const t of TARGETS) {
    const dataUrl = await page.evaluate(
      async ({ url, size, type, quality }) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.src = url;
        await img.decode();
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        // The crest has an alpha channel; keep it clean rather than compositing
        // onto white, so it sits correctly on any surface.
        ctx.clearRect(0, 0, size, size);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        // Scale by the smaller axis so the crest is never distorted.
        const side = Math.min(img.naturalWidth, img.naturalHeight);
        const dw = (size * img.naturalWidth) / side;
        const dh = (size * img.naturalHeight) / side;
        ctx.drawImage(img, (size - dw) / 2, (size - dh) / 2, dw, dh);
        return canvas.toDataURL(type, quality);
      },
      {
        url: '/artifacts/bitspilanilogo.webp',
        size: t.size,
        type: t.type,
        quality: t.quality
      }
    );
    const base64 = dataUrl.split(',')[1];
    const buf = Buffer.from(base64, 'base64');
    fs.writeFileSync(t.file, buf);
    const rel = path.relative(ROOT, t.file).replace(/\\/g, '/');
    console.log(
      '  ' + rel.padEnd(42) + t.size + 'px  ' + String(buf.length).padStart(7) + ' B  (' +
        (buf.length / 1024).toFixed(1) + ' KB)'
    );
  }

  await browser.close();
  server.close();

  const total = TARGETS.reduce((n, t) => n + fs.statSync(t.file).size, 0);
  console.log(
    '\n  source ' + (sourceBytes / 1024).toFixed(1) + ' KB  ->  shipped ' +
      (total / 1024).toFixed(1) + ' KB across ' + TARGETS.length + ' files'
  );
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
