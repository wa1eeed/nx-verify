import type { ReactElement, ReactNode } from 'react';

/**
 * Small labels tinted from the ramps (`.tag` in the Organic sheet), a pill in this frame.
 *
 * A screen names a tone, never a colour: it says what the label means, and the sheets decide
 * how that looks, light in the portal and dark in the administration panel.
 */

export type TagTone = 'accent' | 'accent-2' | 'neutral' | 'outline' | 'critical';

export function Tag({
  tone = 'neutral',
  title,
  role,
  children,
}: {
  tone?: TagTone | undefined;
  title?: string | undefined;
  /** A name for tests and styles to find the tag by, written as data-role. */
  role?: string | undefined;
  children: ReactNode;
}): ReactElement {
  return (
    <span className={`tag tag-${tone}`} title={title} data-role={role}>
      {children}
    </span>
  );
}

/**
 * What each state looks like, decided once for every screen.
 *
 * README, tags: verified is sage, in progress is neutral, a mismatch is the accent. CLAUDE.md
 * adds the rule this map exists to hold: expired is neutral, and a detected change or a
 * conflict is the accent, so the two can never be mistaken for each other.
 */
export const STATE_TONES = {
  VERIFIED: 'accent-2',
  COMPLETE: 'accent-2',
  ACTIVE: 'accent-2',
  PROCESSING: 'neutral',
  PENDING: 'neutral',
  IN_PROGRESS: 'neutral',
  NOT_VERIFIED: 'neutral',
  NOT_APPLICABLE: 'neutral',
  EXPIRED: 'neutral',
  CHANGED: 'accent',
  CONFLICT: 'accent',
  MISMATCH: 'accent',
  INCOMPLETE: 'accent',
  EXPIRING_SOON: 'accent',
  LOW_BALANCE: 'accent',
  SUSPENDED: 'critical',
} as const satisfies Record<string, TagTone>;

export type TagState = keyof typeof STATE_TONES;

/** A tag for a state. The words stay the screen's, because the approved text is per screen. */
export function StateTag({
  state,
  role,
  children,
}: {
  state: TagState;
  role?: string | undefined;
  children: ReactNode;
}): ReactElement {
  return (
    <Tag tone={STATE_TONES[state]} role={role}>
      {children}
    </Tag>
  );
}
