import sharp from "sharp";
import { mkdir } from "node:fs/promises";

const SRC = process.argv[2];
const BG = process.argv[3] ?? "#ffffff";
if (!SRC) {
  console.error("Usage: node scripts/make-icons.mjs <logo-path> [background-color]");
  process.exit(1);
}

await mkdir("public/icons", { recursive: true });

async function squareIcon(size, padFraction, outPath) {
  const inner = Math.round(size * (1 - padFraction * 2));
  const logo = await sharp(SRC)
    .resize(inner, inner, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: BG } })
    .composite([{ input: logo, gravity: "center" }])
    .png()
    .toFile(outPath);
}

await squareIcon(192, 0.08, "public/icons/icon-192.png");
await squareIcon(512, 0.08, "public/icons/icon-512.png");
await squareIcon(512, 0.2, "public/icons/maskable-512.png");
await squareIcon(180, 0.08, "public/icons/apple-touch-icon.png");

const ogLogo = await sharp(SRC)
  .resize(360, 360, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toBuffer();
await sharp({ create: { width: 1200, height: 630, channels: 4, background: BG } })
  .composite([{ input: ogLogo, gravity: "center" }])
  .png()
  .toFile("public/og.png");

console.log("Icons written to public/icons and public/og.png");