const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const sharp = require('sharp');

function resolveBackground(backgroundFile) {
  const safeBackground = path.basename(String(backgroundFile || 'bg.png')) || 'bg.png';
  const candidates = [
    path.join(process.cwd(), safeBackground),
    path.join(__dirname, '..', safeBackground),
    path.join(__dirname, safeBackground),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

async function createSubscriptionQr(subscriptionUrl, backgroundFile = 'bg.png') {
  if (!subscriptionUrl || !/^https?:\/\//i.test(subscriptionUrl)) throw new Error('INVALID_SUBSCRIPTION_URL_FOR_QR');

  const backgroundPath = resolveBackground(backgroundFile);
  if (!backgroundPath) throw new Error(`QR_BACKGROUND_NOT_FOUND:${path.basename(String(backgroundFile || 'bg.png'))}`);

  const metadata = await sharp(backgroundPath).metadata();
  const width = Number(metadata.width) || 1080;
  const height = Number(metadata.height) || 1080;
  const size = Math.min(width, height);
  const background = await sharp(backgroundPath).resize(width, height, { fit: 'cover' }).png().toBuffer();

  const qrSize = Math.min(720, Math.floor(size * 0.68));
  const qr = await QRCode.toBuffer(subscriptionUrl, {
    type: 'png', width: qrSize, margin: 4, errorCorrectionLevel: 'H',
    color: { dark: '#111111', light: '#FFFFFF' },
  });

  // Keep bg.png visible across the entire image. A translucent white panel preserves QR contrast
  // without replacing the repository background with an opaque white card.
  const panelSize = Math.min(Math.floor(size * 0.78), qrSize + 100);
  const panel = await sharp({
    create: {
      width: panelSize,
      height: panelSize,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 0.78 },
    },
  }).png().toBuffer();

  const qrRounded = await sharp(qr).resize(qrSize, qrSize, { fit: 'contain' }).png().toBuffer();
  const panelLeft = Math.floor((width - panelSize) / 2);
  const panelTop = Math.floor((height - panelSize) / 2);
  const qrLeft = Math.floor((width - qrSize) / 2);
  const qrTop = Math.floor((height - qrSize) / 2);

  return sharp(background)
    .composite([
      { input: panel, left: panelLeft, top: panelTop },
      { input: qrRounded, left: qrLeft, top: qrTop },
    ])
    .png()
    .toBuffer();
}

module.exports = { createSubscriptionQr };
