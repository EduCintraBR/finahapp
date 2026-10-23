import { redirect } from 'next/navigation';

/** Os cartões de benefícios ficam na tela de Cartões. */
export default function BenefitsIndexPage() {
  redirect('/cartoes');
}
