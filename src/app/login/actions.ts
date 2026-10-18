'use server';

import { AuthError, CredentialsSignin } from 'next-auth';
import { signIn } from '@/auth';
import { type ActionResult, fail } from '@/lib/action-result';
import { credentialsSchema } from '@/server/auth/authenticate';

/** Aceita só caminhos internos ("/x"), nunca URLs externas ("//evil", "https://..."). */
function safeRedirect(value: FormDataEntryValue | null): string {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? value : '/';
}

export async function login(
  _prev: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  const parsed = credentialsSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });
  if (!parsed.success) return fail('Informe email e senha.');

  try {
    // Em caso de sucesso, signIn lança o redirect do Next (que precisa propagar).
    await signIn('credentials', { ...parsed.data, redirectTo: safeRedirect(formData.get('callbackUrl')) });
  } catch (error) {
    if (error instanceof CredentialsSignin && error.code === 'rate_limited') {
      return fail('Muitas tentativas. Aguarde alguns minutos e tente de novo.');
    }
    if (error instanceof AuthError) return fail('Email ou senha incorretos.');
    throw error;
  }
  return fail('Não foi possível entrar.');
}
