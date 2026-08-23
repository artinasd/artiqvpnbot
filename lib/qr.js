const path = require('path');
const QRCode = require('qrcode');
const sharp = require('sharp');

async function createSubscriptionQr(subscriptionUrl, backgroundFile = 'bg.png') {
  const safeBackground = path.basename(String(backgroundFile || 'bg.png')) || 'bg.png';
  const backgroundPath = path.join(process.cwd(), safeBackground);
  const background = await sharp(backgroundPath).resize(1080, 1080, { fit: 'cover' }).png().toBuffer();

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
