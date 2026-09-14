import Link from 'next/link';
import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  ComponentProps,
  ReactElement,
  ReactNode,
} from 'react';
import { classes } from './classes';
import { Icon, type IconName } from './icon';

/**
 * Buttons as the Organic sheet draws them: `.btn` with a primary, secondary or ghost fill,
 * a pill in this frame.
 *
 * Hover and pressed fills come from the accent ramp in the sheet, and keyboard focus is its
 * `:focus-visible` ring, so no screen restyles any of them. There is no className or style
 * prop: a screen that wants a different button is asking for a change to the system, not to
 * itself. The variant defaults to secondary, so the one primary action on a screen is
 * always a choice somebody wrote down (CLAUDE.md, interface).
 *
 * Icons keep the prototype's order. A leading icon comes before the words, which in a right
 * to left row puts it on the right; a trailing icon comes after them and carries direction,
 * as the arrow does in «متابعة».
 */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';

interface ButtonLook {
  variant?: ButtonVariant | undefined;
  icon?: IconName | undefined;
  iconEnd?: IconName | undefined;
  /** Full width, as «شراء رصيد» under the balance. */
  block?: boolean | undefined;
  /** The wider padding of a bar's closing action, «تحقق من الكل» (README, screen 02). */
  wide?: boolean | undefined;
  children: ReactNode;
}

export function buttonClass(
  variant: ButtonVariant,
  options: {
    block?: boolean | undefined;
    wide?: boolean | undefined;
    iconOnly?: boolean | undefined;
  } = {},
): string {
  return classes(
    'btn',
    `btn-${variant}`,
    options.block === true && 'btn-block',
    options.wide === true && 'btn-wide',
    options.iconOnly === true && 'btn-icon',
  );
}

function Content({
  icon,
  iconEnd,
  children,
}: Pick<ButtonLook, 'icon' | 'iconEnd' | 'children'>): ReactElement {
  return (
    <>
      {icon === undefined ? null : <Icon name={icon} size={15} />}
      {children}
      {iconEnd === undefined ? null : <Icon name={iconEnd} size={15} />}
    </>
  );
}

export type ButtonProps = ButtonLook &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'className' | 'style'> & {
    /** A submission under way: the button says so and cannot be pressed a second time. */
    pending?: boolean | undefined;
  };

export function Button({
  variant = 'secondary',
  icon,
  iconEnd,
  block,
  wide,
  pending = false,
  type = 'button',
  disabled,
  children,
  ...rest
}: ButtonProps): ReactElement {
  return (
    <button
      {...rest}
      type={type}
      className={buttonClass(variant, { block, wide })}
      disabled={disabled === true || pending}
      aria-busy={pending ? true : undefined}
    >
      <Content icon={icon} iconEnd={iconEnd}>
        {children}
      </Content>
    </button>
  );
}

export type ButtonLinkProps = ButtonLook &
  Omit<
    AnchorHTMLAttributes<HTMLAnchorElement>,
    'children' | 'className' | 'style' | 'href' | 'download'
  > & {
    href: string;
    /**
     * A file rather than a screen, such as «تصدير التقرير». The browser fetches it itself: the
     * router neither moves to it nor fetches it ahead, which for an export would build it.
     */
    download?: boolean | undefined;
  };

/**
 * A link that goes somewhere, drawn as a button: «تحقق جديد» opens a screen, it submits nothing.
 * The move stays inside the console, without reloading the page (unit C4).
 */
export function ButtonLink({
  variant = 'secondary',
  icon,
  iconEnd,
  block,
  wide,
  href,
  download = false,
  children,
  ...rest
}: ButtonLinkProps): ReactElement {
  const className = buttonClass(variant, { block, wide });
  const content = (
    <Content icon={icon} iconEnd={iconEnd}>
      {children}
    </Content>
  );
  return download ? (
    <a {...rest} href={href} download className={className}>
      {content}
    </a>
  ) : (
    // The anchor attributes a screen passes are the ones Link forwards to its anchor; the cast
    // only reconciles how the two type an optional handler.
    <Link
      {...(rest as Omit<ComponentProps<typeof Link>, 'href'>)}
      href={href}
      className={className}
    >
      {content}
    </Link>
  );
}

export type IconButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'children' | 'className' | 'style' | 'aria-label'
> & {
  icon: IconName;
  /** An icon alone says nothing to a screen reader, so the words are required. */
  label: string;
  variant?: ButtonVariant | undefined;
};

export function IconButton({
  icon,
  label,
  variant = 'ghost',
  type = 'button',
  ...rest
}: IconButtonProps): ReactElement {
  return (
    <button
      {...rest}
      type={type}
      className={buttonClass(variant, { iconOnly: true })}
      aria-label={label}
      title={label}
    >
      <Icon name={icon} size={16} />
    </button>
  );
}
