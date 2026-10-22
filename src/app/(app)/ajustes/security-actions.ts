'use server';

import QRCode from 'qrcode';
import { signOut } from '@/auth';
import { type ActionResult, fail, ok } from '@/lib/action-result';
import {
  changePassword,
  changePasswordInput,
  confirmAuthenticatorChange,
  logoutEverywhere,
  regenerateRecoveryCodes,
  startAuthenticatorChange,
} from '@/server/auth/account-security';
import { appKey } from '@/server/auth/secret-box';
import { runAction } from '@/server/context';
import { firstIssue } from '@/server/schemas';
import { getServiceCtx } from '@/server/session';

const deps = () => ({ key: appKey(), nowMs: Date.now() });
const code = (fd: FormData) => String(fd.get('code') ?? '');

export async function changePasswordAction(
  _p: ActionResult<null> | null,
  fd: FormData,
): Promise<ActionResult<null>> {
  const parsed = changePasswordInput.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const r = await runAction(async () => {
    const ctx = await getServiceCtx();
    await changePassword(ctx.db, ctx.userId, parsed.data);
  });
  if (!r.ok) return r;
  await signOut({ redirectTo: '/login' }); // a sessão atual também caiu: entra de novo com a senha nova
  return ok(null);
}

export async function logoutEverywhereAction(): Promise<ActionResult<null>> {
  const r = await runAction(async () => {
    const ctx = await getServiceCtx();
    await logoutEverywhere(ctx.db, ctx.userId);
  });
  if (!r.ok) return r;
  await signOut({ redirectTo: '/login' });
  return ok(null);
}

export async function regenerateRecoveryCodesAction(
  _p: ActionResult<string[]> | null,
  fd: FormData,
): Promise<ActionResult<string[]>> {
  return runAction(async () => {
    const ctx = await getServiceCtx();
    return regenerateRecoveryCodes(ctx.db, ctx.userId, code(fd), deps());
  });
}

export type AuthenticatorChange = { secret: string; qrDataUrl: string } | { done: true };

export async function changeAuthenticatorAction(
  _p: ActionResult<AuthenticatorChange> | null,
  fd: FormData,
): Promise<ActionResult<AuthenticatorChange>> {
  return runAction(async (): Promise<AuthenticatorChange> => {
    const ctx = await getServiceCtx();
    if (fd.get('stage') === 'confirm') {
      await confirmAuthenticatorChange(ctx.db, ctx.userId, code(fd), deps());
      return { done: true };
    }
    const e = await startAuthenticatorChange(ctx.db, ctx.userId, code(fd), deps());
    return { secret: e.secret, qrDataUrl: await QRCode.toDataURL(e.otpauthUri, { margin: 1, width: 220 }) };
  });
}
