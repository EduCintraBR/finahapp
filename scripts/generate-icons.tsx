/**
 * Gera os ícones PNG do PWA em public/icons/ a partir do mesmo desenho de public/icon.svg.
 * Rodar só quando o ícone mudar: `pnpm tsx scripts/generate-icons.tsx` (os PNGs são versionados).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { ImageResponse } from 'next/og';

const BRAND = '#1f7a68';

/** "F" do logo; `scale` = fração do lado ocupada pelo desenho (maskable precisa de margem de segurança). */
function Icon({ size, rounded, scale }: { size: number; rounded: boolean; scale: number }) {
  const s = (size * scale) / 64;
  return (
    <div
      style={{
        width: size,
        height: size,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: BRAND,
        borderRadius: rounded ? size * 0.22 : 0,
      }}
    >
      <svg width={64 * s} height={64 * s} viewBox="0 0 64 64">
        <path d="M22 48V16h22v6H29v7h13v6H29v13z" fill="#ffffff" />
      </svg>
    </div>
  );
}

const targets = [
  { file: 'icon-192.png', size: 192, rounded: true, scale: 1 },
  { file: 'icon-512.png', size: 512, rounded: true, scale: 1 },
  { file: 'maskable-512.png', size: 512, rounded: false, scale: 0.7 },
  { file: 'apple-touch-icon.png', size: 180, rounded: false, scale: 0.9 },
];

mkdirSync('public/icons', { recursive: true });
for (const t of targets) {
  const res = new ImageResponse(<Icon size={t.size} rounded={t.rounded} scale={t.scale} />, {
    width: t.size,
    height: t.size,
  });
  writeFileSync(`public/icons/${t.file}`, Buffer.from(await res.arrayBuffer()));
  console.log(`public/icons/${t.file}`);
}
