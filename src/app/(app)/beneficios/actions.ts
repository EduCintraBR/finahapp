'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { MAX_BENEFIT_WALLETS } from '@/domain/benefits/credits';
import { type ActionResult, fail } from '@/lib/action-result';
import {
  createBenefitCard,
  createBenefitSpend,
  deleteBenefitSpend,
  endBenefitCard,
  updateBenefitCard,
} from '@/server/benefits';
import { runAction } from '@/server/context';
import {
  benefitCardInput,
  benefitCardUpdateInput,
  benefitSpendInput,
  endBenefitInput,
  firstIssue,
} from '@/server/schemas';
import { getServiceCtx } from '@/server/session';

type Prev = ActionResult<null> | null;
const refresh = () => revalidatePath('/', 'layout');
const text = (fd: FormData, key: string) => String(fd.get(key) ?? '');

/** Carteiras do formulário: campos `w0name`, `w0credit`, `w0opening`, `w1name`… (linhas sem nome são ignoradas). */
function walletsFromForm(fd: FormData) {
  const out: { name: string; monthlyCredit: string; openingBalance: string }[] = [];
  for (let i = 0; i < MAX_BENEFIT_WALLETS + 4; i++) {
    const name = text(fd, `w${i}name`).trim();
    if (!name) continue;
    out.push({ name, monthlyCredit: text(fd, `w${i}credit`), openingBalance: text(fd, `w${i}opening`) });
  }
  return out;
}

export async function createBenefitCardAction(_p: Prev, fd: FormData): Promise<ActionResult<null>> {
  const parsed = benefitCardInput.safeParse({
    name: fd.get('name'),
    issuer: fd.get('issuer'),
    last4: fd.get('last4'),
    creditRule: fd.get('creditRule'),
    creditDay: fd.get('creditDay'),
    startMonth: fd.get('startMonth'),
    wallets: walletsFromForm(fd),
  });
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const r = await runAction(async () => createBenefitCard(await getServiceCtx(), parsed.data));
  if (!r.ok) return r;
  refresh();
  redirect(`/beneficios/${r.data.id}`);
}

export async function updateBenefitCardAction(_p: Prev, fd: FormData): Promise<ActionResult<null>> {
  const ids = fd.getAll('walletId').map(String);
  const credits = fd.getAll('walletCredit').map(String);
  const parsed = benefitCardUpdateInput.safeParse({
    name: fd.get('name'),
    issuer: fd.get('issuer'),
    last4: fd.get('last4'),
    creditRule: fd.get('creditRule'),
    creditDay: fd.get('creditDay'),
    wallets: ids.map((id, i) => ({ id, monthlyCredit: credits[i] ?? '' })),
  });
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const r = await runAction(async () =>
    updateBenefitCard(await getServiceCtx(), text(fd, 'id'), parsed.data),
  );
  if (!r.ok) return r;
  refresh();
  return { ok: true, data: null };
}

export async function endBenefitCardAction(_p: Prev, fd: FormData): Promise<ActionResult<null>> {
  const parsed = endBenefitInput.safeParse({ lastMonth: fd.get('lastMonth') });
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const r = await runAction(async () =>
    endBenefitCard(await getServiceCtx(), text(fd, 'id'), parsed.data.lastMonth),
  );
  if (!r.ok) return r;
  refresh();
  return { ok: true, data: null };
}

/** Gasto no cartão de benefícios; depois de lançar, volta para a tela do cartão (D59). */
export async function benefitSpendAction(_p: Prev, fd: FormData): Promise<ActionResult<null>> {
  const parsed = benefitSpendInput.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const r = await runAction(async () => createBenefitSpend(await getServiceCtx(), parsed.data));
  if (!r.ok) return r;
  refresh();
  redirect(`/beneficios/${r.data.cardId}`);
}

export async function deleteBenefitSpendAction(_p: Prev, fd: FormData): Promise<ActionResult<null>> {
  const r = await runAction(async () => deleteBenefitSpend(await getServiceCtx(), text(fd, 'id')));
  if (!r.ok) return r;
  refresh();
  return { ok: true, data: null };
}
