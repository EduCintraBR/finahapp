'use server';

import { headers } from 'next/headers';
import { AuthError, CredentialsSignin } from 'next-auth';
import QRCode from 'qrcode';
import { signIn } from '@/auth';
import { getDb } from '@/db/client';
import { type ActionResult, fail, ok } from '@/lib/action-result';
import { beginLogin, clientIp, credentialsSchema } from '@/server/auth/authenticate';
import { loginLimiter } from '@/server/auth/limiter';
import { appKey } from '@/server/auth/secret-box';

/** Próxima etapa do login, depois da senha certa. */
export type LoginStep =
  { step: 'code' } | { step: 'enroll'; secret: string; qrDataUrl: string; recoveryCodes: string[] };

const RATE_LIMITED = 'Muitas tentativas. Aguarde alguns minutos e tente de novo.';

/** Aceita só caminhos internos ("/x"), nunca URLs externas ("//evil", "/\\evil", "https://..."). */
function safeRedirect(value: FormDataEntryValue | null): string {
  return typeof value === 'string' && /^\/(?![/\\])/.test(value) && !value.includes('\\') ? value : '/';
}

/**
 * Login em duas etapas (D64). Sem `code`: confere a senha e devolve a próxima etapa (código, ou cadastro do
 * autenticador no 1º login). Com `code`: entra de verdade (senha + código conferidos de novo no authorize).
 */
export async function login(
  _prev: ActionResult<LoginStep> | null,
  formData: FormData,
): Promise<ActionResult<LoginStep>> {
  const parsed = credentialsSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });
  if (!parsed.success) return fail('Informe email e senha.');
  const code = String(formData.get('code') ?? '').trim();

  if (!code) {
    const ip = clientIp(await headers());
    const r = await beginLogin(getDb(), loginLimiter(), { ...parsed.data, ip }, appKey());
    if (!r.ok) return fail(r.reason === 'rate_limited' ? RATE_LIMITED : 'Email ou senha incorretos.');
    if (r.step === 'code') return ok({ step: 'code' });
    const qrDataUrl = await QRCode.toDataURL(r.enrollment.otpauthUri, { margin: 1, width: 220 });
    return ok({
      step: 'enroll',
      secret: r.enrollment.secret,
      qrDataUrl,
      recoveryCodes: r.enrollment.recoveryCodes,
    });
  }

  try {
    // Em caso de sucesso, signIn lança o redirect do Next (que precisa propagar).
    await signIn('credentials', {
      ...parsed.data,
      code,
      redirectTo: safeRedirect(formData.get('callbackUrl')),
    });
  } catch (error) {
    if (error instanceof CredentialsSignin && error.code === 'rate_limited') return fail(RATE_LIMITED);
    if (error instanceof AuthError) return fail('Código inválido ou já usado. Confira o app autenticador.');
    throw error;
  }
  return fail('Não foi possível entrar.');
}
