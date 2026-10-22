/**
 * Content-Security-Policy com nonce por requisição (D64): só roda script com o nonce da página (os do Next e o
 * do tema), e o 'strict-dynamic' deixa esses carregarem os chunks. Nada de script de outro domínio, iframe do
 * app em outro site, nem formulário mandando dados para fora.
 * Estilos inline ficam liberados: o React/Recharts usa atributos style e injetar CSS não executa código.
 */
export function buildCsp(nonce: string, opts: { dev: boolean; https: boolean }): string {
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${opts.dev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self'${opts.dev ? ' ws: wss:' : ''}`,
    "manifest-src 'self'",
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(opts.https ? ['upgrade-insecure-requests'] : []),
  ];
  return directives.join('; ');
}

/** Cabeçalhos fixos de todas as respostas (o HSTS vem do nginx, que é quem fala HTTPS). */
export const SECURITY_HEADERS = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'same-origin' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  },
];
