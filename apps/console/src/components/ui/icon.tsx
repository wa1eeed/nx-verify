import type { ReactElement } from 'react';
import {
  ArrowLeft,
  BadgeCheck,
  Building2,
  ChartColumn,
  Check,
  Clock,
  Download,
  Info,
  LayoutDashboard,
  Minus,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Shield,
  SlidersHorizontal,
  Tag,
  TriangleAlert,
  Users,
  Wallet,
  X,
  type LucideIcon,
} from 'lucide-react';

/**
 * The icons of the interface, and the only door to them.
 *
 * Lucide at a stroke of 2.75 everywhere (README, icons), so no screen chooses a weight or
 * imports the library itself. The keys are the names the handoff uses, which keeps a screen
 * and its reference readable side by side. Lucide has since renamed two of them, and the
 * key keeps the handoff's name while the value is the current glyph.
 */
export const ICONS = {
  'layout-dashboard': LayoutDashboard,
  users: Users,
  'badge-check': BadgeCheck,
  wallet: Wallet,
  settings: Settings,
  plus: Plus,
  download: Download,
  'refresh-cw': RefreshCw,
  'arrow-left': ArrowLeft,
  check: Check,
  'alert-triangle': TriangleAlert,
  clock: Clock,
  info: Info,
  'building-2': Building2,
  tag: Tag,
  'sliders-horizontal': SlidersHorizontal,
  'bar-chart-3': ChartColumn,
  shield: Shield,
  // Past the handoff's list: glyphs the controls themselves need.
  minus: Minus,
  search: Search,
  x: X,
} as const satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;

/** README, icons: a rounder, heavier line throughout. */
export const ICON_STROKE = 2.75;

/** 14 to 17px in buttons and lists; 13px only for the check inside a checkbox. */
export type IconSize = 13 | 14 | 15 | 16 | 17;

export function Icon({
  name,
  size = 16,
  label,
}: {
  name: IconName;
  size?: IconSize | undefined;
  /** Only for an icon that stands alone. Beside words, the words already say it. */
  label?: string | undefined;
}): ReactElement {
  const Glyph = ICONS[name];
  return label === undefined ? (
    <Glyph size={size} strokeWidth={ICON_STROKE} aria-hidden="true" focusable="false" />
  ) : (
    <Glyph size={size} strokeWidth={ICON_STROKE} role="img" aria-label={label} focusable="false" />
  );
}
