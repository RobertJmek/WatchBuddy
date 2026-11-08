# ADR 0029 — Text contrast: fills and text colors are separate tokens

**Status:** accepted · targets v1.25.0 (PR #114)

## Context

Robert asked that all text in the app be easy to read, with contrast as good as
an IDE theme. We measured the palette with the WCAG 2.x relative-luminance
formula. The dark theme passed. The light theme and the shared constants did not:

- White on the teal buttons (`Accent`, `#0D9488`) was **3.74:1**. A 16px label
  is not "large text", so it needs 4.5:1.
- `Accent` used as text on the light background was **3.32:1**.
- The amber `glow` text (stats values, review scores) on light was **3.04:1**.
- `Danger` text on light was **3.47:1**, and white on red was ~3.6:1.
- The unread badges were white on the dark theme's `tint`, at **2.5:1**.

No single teal can serve both roles. For white text on it to reach 4.5:1, its
luminance has to be ≤ ~0.18. To be text at 4.5:1 on the near-black dark
background, it has to be ≥ ~0.19. The two windows don't overlap, and the same
holds for red.

## Decision

- **WCAG AA is the bar:** ≥ 4.5:1 for body text and ≥ 3:1 for large text and UI
  shapes. Every text token must meet it on all three backgrounds of its scheme:
  `background`, `backgroundElement` and `backgroundSelected`.
- **`Accent` (`#0F766E`) and `Danger` (`#C0262D`) are fills only.** Text on them
  is white: 5.47:1 and 5.90:1.
- **Text uses the per-scheme tokens.** These are `tint`, a new `danger` and
  `glow`, written as `<ThemedText themeColor="tint">` or `c.tint` for
  non-`ThemedText` cases.
  - Light theme: `tint` `#0B6B63`, `danger` `#B3261E`, `glow` `#7A560D` and
    `textSecondary` `#5F574D`. All are ≥ 4.57:1 on every light background.
  - Dark theme: unchanged except `danger` (`#F2555A`, ≥ 4.97:1).
- **Never put white text on `tint`.** Badges use `Accent`.
- The favorite heart sits on the title hero, which is always dark, so it uses
  the dark theme's tint.

## Consequences

- The teal buttons and chips are slightly darker. On light, the amber reads as
  bronze and secondary text is a little darker.
- The rule is commented at the top of the palette in `src/constants/theme.ts`.
  A new text color goes in `Colors`, measured, not in a constant.
- Not covered:
  - Text over the title hero's photograph, which relies on `Hero.shadow` and the
    pill fills.
  - Input fills against the page (~1.1:1, as iOS does). Fields are identified by
    their labels and placeholders.
