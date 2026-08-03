import {
  Car,
  CircleDashed,
  CircleHelp,
  GraduationCap,
  HeartPulse,
  House,
  Landmark,
  PartyPopper,
  PiggyBank,
  Plane,
  Repeat,
  ShoppingBag,
  ShoppingCart,
  Undo2,
  Utensils,
  Wallet,
  Wrench,
  type LucideIcon,
} from 'lucide-react';

/**
 * The icons a category can use, keyed by the lucide name stored in `categories.icon`.
 *
 * Deliberately a fixed map rather than a dynamic lookup: it is also the list the category
 * form offers, and it keeps the client bundle to the icons actually in use.
 */
export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  'shopping-cart': ShoppingCart,
  utensils: Utensils,
  car: Car,
  house: House,
  'heart-pulse': HeartPulse,
  'graduation-cap': GraduationCap,
  'party-popper': PartyPopper,
  'shopping-bag': ShoppingBag,
  repeat: Repeat,
  wrench: Wrench,
  plane: Plane,
  landmark: Landmark,
  wallet: Wallet,
  'undo-2': Undo2,
  'piggy-bank': PiggyBank,
  'circle-dashed': CircleDashed,
};

export const CATEGORY_ICON_NAMES = Object.keys(CATEGORY_ICONS);

const FALLBACK_COLOR = 'var(--color-ink-muted)';

/** Round icon chip tinted with the category colour. Falls back to a neutral "?" chip. */
export function CategoryIcon({
  icon,
  color,
  className = 'size-9',
}: {
  icon: string | null;
  color: string | null;
  className?: string;
}) {
  const Icon = (icon && CATEGORY_ICONS[icon]) || CircleHelp;
  const tint = color ?? FALLBACK_COLOR;

  return (
    <span
      aria-hidden
      className={`grid shrink-0 place-items-center rounded-full ${className}`}
      style={{ backgroundColor: `color-mix(in oklab, ${tint} 18%, transparent)`, color: tint }}
    >
      <Icon className="size-[55%]" />
    </span>
  );
}
