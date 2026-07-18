import sharp from 'sharp'
import { writeFileSync } from 'fs'

const makeSvg = (size, textSize, barY) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#2563eb"/>
  <text x="256" y="270" font-family="Arial,Helvetica,sans-serif" font-size="${textSize}" font-weight="700" fill="#ffffff" text-anchor="middle">BMSC</text>
  <rect x="96" y="${barY}" width="320" height="24" rx="12" fill="#ffffff" opacity="0.9"/>
  <rect x="128" y="${barY + 40}" width="256" height="16" rx="8" fill="#ffffff" opacity="0.6"/>
</svg>`

const anySvg = makeSvg(512, 110, 320)
const maskableSvg = makeSvg(512, 90, 310)

await sharp(Buffer.from(anySvg)).png().toFile('public/pwa-512.png')
await sharp(Buffer.from(anySvg)).resize(192, 192).png().toFile('public/pwa-192.png')
await sharp(Buffer.from(anySvg)).resize(180, 180).png().toFile('public/apple-touch-icon.png')
await sharp(Buffer.from(maskableSvg)).png().toFile('public/pwa-512-maskable.png')

console.log('PWA icons written to public/')
