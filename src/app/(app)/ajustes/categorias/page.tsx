import { redirect } from 'next/navigation';

/** Categorias saíram de Ajustes e viraram um menu próprio (D77); o endereço antigo continua valendo. */
export default function OldCategoriesPage() {
  redirect('/categorias');
}
