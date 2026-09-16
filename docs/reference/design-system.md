# Design system reference

The appearance of every screen, and the rules a screen obeys. The authority is the handoff in
`design_handoff_verification_platform/` and the design rules at the end of
[CLAUDE.md](../../CLAUDE.md); where this page and those disagree, they win.

---

## Where a value comes from

**Never from a screen.** No colour, spacing, radius, shadow or size is written as a value
anywhere in `apps/console/src`. Every one comes from a token, and `pnpm design:check` refuses a
violation across all 210 source files.

| File                                   | Holds                                                               |
| -------------------------------------- | -------------------------------------------------------------------- |
| `src/styles/organic.css`               | The delivered token sheet, byte for byte, plus 248 tokens this product adds |
| `src/styles/product.css`               | What this product draws with those tokens                            |
| `src/styles/tailwind.css`              | Tailwind's theme, with every variable bound to an Organic token       |
| `src/styles/legacy.css`                | The transitional sheet for screens not yet rebuilt                    |

The cascade order is deliberate and is set in the root layout: legacy first, so the system's base
type, links and focus ring outrank it, then Organic, then the product, then Tailwind in layers
everything above outranks.

A test proves the token sheet still begins with the delivered file exactly, because a formatter
once rewrote it and the commit claiming a verbatim copy was not one.

---

## The palette

Saudi government in character (ADR-122).

| Role      | Token               | Used for                                                     |
| --------- | ------------------- | ------------------------------------------------------------ |
| Accent    | `--color-accent`    | Every action, every link, every navigation, anything verified |
| Gold      | `--color-gold-*`    | The second series and decoration                              |
| Amber     | `--color-amber-*`   | Anything that deserves a look: a change, a conflict           |
| Red       | `--color-red-*`     | Anything that failed                                          |
| Cool grey | `--color-neutral-*` | Text and borders                                              |
| Ground    | `--color-ground`    | The portal's floor, white cards with a touch of green (ADR-121) |
| Inset     | `--color-inset`     | Something that needs a shadow inside a card                   |

The administration panel is dark, always. Designing it light is a rule violation, not a
preference.

**Never mix two meanings.** "Expired" is neutral, because it means look again. "Changed" and
"conflict" are amber, because something happened. A screen that uses one colour for both is
saying nothing with it.

---

## Type

One face for the whole platform: **IBM Plex Sans Arabic**, as government platforms use (ADR-125).
Titles and card names at 700, buttons at 600, body and tables at 400 to 600. No second face is
loaded, ever.

## Shape

| Thing              | Radius        |
| ------------------ | ------------- |
| Buttons, fields, tags | `999px`    |
| Cards              | 26 to 28px    |
| The window frame   | 32px          |

Shadows come only from `--shadow-sm`, `--shadow-md` and `--shadow-lg`. Icons are Lucide at
`stroke-width: 2.75`, 14 to 17px.

## Direction

`dir="rtl"` at the root, not patched per component. Table headings align right. Numbers,
identifiers and IBANs sit inside an element with `dir="ltr"`, because an identifier in an Arabic
line reverses without one.

---

## The component layer

Screens build from `src/components/ui` and never from raw markup:

`Button`, `ButtonLink`, `IconButton`, `SubmitButton`, `Card`, `Dialog`, `Field`, `Input`,
`Select`, `Checkbox`, `Radio`, `Segmented`, `Table`, `Tag`, `TagLink`, `TagToggle`, `Notice`,
`Pagination`, `ProgressBar`, `DataLoader`, `CompletenessRing`, `LinkedRows`, `Ltr`, `Icon`.

None of them takes a `className` or a `style`. A screen that wants a different button is asking
for a change to the system, not to itself. The variant defaults to secondary, so the one primary
action on a screen is always a choice somebody made.

**shadcn/ui on Base UI and Tailwind v4** is the approved library (ADR-119). Its primitives live
in `src/components/shadcn`, screens reach them only through the layer above, every theme variable
is bound to an Organic token, and Tailwind's preflight is off because it would change what was
built.

---

## Rules a screen obeys

- **One primary action in the header.** The single exception is a «تحقق» button inside a section
  that has a conflict.
- **No field without its timestamp and its source.** Showing them once per section is enough when
  every field in it came from one verification.
- **Every identifier in full** for the subscriber who owns the customer: registry, unified
  number, national identity, residence permit, freelance and party documents, and the IBAN in
  groups of four. In the public API and a shared link, every one of them is masked.
- **Every interactive element** has a hover fill from the accent ramp, a deeper `:active`, and
  `:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px }`. Browser
  defaults are not relied on.
- **Transitions are 120 to 180ms and on colour only.** Two exceptions: loading indicators
  (ADR-120) and the intersections map in a customer file (ADR-123). Both stop for
  `prefers-reduced-motion`.
- **Navigation goes through the router**: `Link`, `ButtonLink`, `TagLink`, never a bare `<a>`.
  Every screen checks its own session, because a layout is not re-executed on a move.
- **Every screen needs three states**: loading, empty, and error.
- **Arabic text in the prototype is the approved text.** Do not rewrite it.

---

## Responsiveness

Under 1024px the sidebar becomes a drawer. No page scrolls sideways at any width. A table wider
than its card scrolls inside the card, never the page.

```bash
pnpm design:responsive
```

Walks every screen at 1440, 820 and 390 pixels and fails on a sideways scroll or a main area
pushed off screen. A route may declare an `expect` selector, so a screen that quietly redirects
fails rather than passing as an empty page.

---

## Proving a change

```bash
pnpm design:check                      # tokens, and focus-visible coverage
pnpm design:all before/                # photograph every screen
# make the change
pnpm design:all after/
pnpm design:compare before/ after/     # pixel comparison
pnpm design:responsive                 # three widths
```

Any interface change that is **not** supposed to move the design is proved with photographs
before and after. A change that is supposed to move it is compared on purpose.

A screen is not finished until the final checklist at the end of
`design_handoff_verification_platform/README.md` has been worked through, and the prototype has
been opened beside the running screen and compared by eye. The scripts do not check layout
fidelity, the approved Arabic text, the dark panel, or that no data source is named.
