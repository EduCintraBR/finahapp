import {
  Baby,
  Briefcase,
  Car,
  CircleEllipsis,
  CircleHelp,
  CirclePlus,
  Coins,
  Gift,
  GraduationCap,
  HeartPulse,
  House,
  PartyPopper,
  Plane,
  Plug,
  Receipt,
  Repeat,
  ShoppingBag,
  ShoppingCart,
  Sparkles,
  Tag,
  Utensils,
  Wrench,
  type LucideIcon,
} from 'lucide-react';

/** Ícones das categorias (nome do Lucide gravado em categories.icon, ver seed-data.ts); desconhecido → etiqueta. */
const ICONS: Record<string, LucideIcon> = {
  baby: Baby,
  briefcase: Briefcase,
  car: Car,
  'circle-ellipsis': CircleEllipsis,
  'circle-help': CircleHelp,
  'circle-plus': CirclePlus,
  coins: Coins,
  gift: Gift,
  'graduation-cap': GraduationCap,
  'heart-pulse': HeartPulse,
  house: House,
  'party-popper': PartyPopper,
  plane: Plane,
  plug: Plug,
  receipt: Receipt,
  repeat: Repeat,
  'shopping-bag': ShoppingBag,
  'shopping-cart': ShoppingCart,
  sparkles: Sparkles,
  utensils: Utensils,
  wrench: Wrench,
};

export function CategoryIcon({ name, className }: { name: string | null; className?: string }) {
  const Icon = (name && ICONS[name]) || Tag;
  return <Icon className={className} aria-hidden />;
}
