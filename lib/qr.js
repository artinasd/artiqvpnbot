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
  if (!subscriptionUrl || !/^https?:\/\//i.test(subscriptionUrl)) {
    throw new Error('INVALID_SUBSCRIPTION_URL_FOR_QR');
  }

  const backgroundPath = resolveBackground(backgroundFile);
  let background;
  if (backgroundPath) {
    background = await sharp(backgroundPath).resize(1080, 1080, { fit: 'cover' }).png().toBuffer();
  } else {
    background = await sharp({
      create: {
        width: 1080,
        height: 1080,
        channels: 4,
        background: { r: 245, g: 245, b: 245, alpha: 1 },
      },
    }).png().toBuffer();
  }

  const qr = await QRCode.toBuffer(subscriptionUrl, {
    type: 'png',
    width: 720,
    margin: 4,
    errorCorrectionLevel: 'H',
    color: { dark: '#111111', light: '#FFFFFF' },
  });

  const card = await sharp({
    create: {
      width: 820,
      height: 820,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 0.98 },
    },
  }).png().toBuffer();

  const qrRounded = await sharp(qr)
    .resize(720, 720, { fit: 'contain' })
    .png()
    .toBuffer();

  return sharp(background)
    .composite([
      { input: card, left: 130, top: 130 },
      { input: qrRounded, left: 180, top: 180 },
    ])
    .png()
    .toBuffer();
}

module.exports = { createSubscriptionQr };
