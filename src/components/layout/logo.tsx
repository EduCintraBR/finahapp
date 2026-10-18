import Link from 'next/link';

export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
      {/* eslint-disable-next-line @next/next/no-img-element -- SVG estático pequeno */}
      <img src="/icon.svg" alt="" width={28} height={28} className="rounded-md" />
      <span className="text-lg">Finah</span>
    </Link>
  );
}
