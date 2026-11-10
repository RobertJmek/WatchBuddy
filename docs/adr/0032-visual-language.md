# ADR 0032 — Visual language: one type family, neutral ground

**Status:** accepted · v1.26.0

## Context

Robert asked for the whole UI to be redone in a new visual language, and
lifted the earlier limit on restyling (ADR 0030 kept #118's card style to Edit
Profile only). The app looked like many others: a warm cream page, a warm
near-black, and a high-contrast serif (Bodoni Moda) for titles.

A first pass used League Gothic, the condensed gothic of film posters, for
titles and metadata. Robert kept everything else and rejected that typeface.

## Decision

- **One family.** Archivo everywhere. Display text is its ExtraBold, set
  tight: `title` 40/46, `subtitle` (section headings) 30/36. Bodoni Moda is
  removed. `meta` stays small uppercase semibold, with less tracking (0.8).
- **Neutral ground.** Light is white, dark is true black, both with cool
  greys. Posters carry the colour. The teal accent stays, so the app still
  matches its icon and store listing.
- **Row and field labels** use a new `ThemedText type="label"` (semibold
  17/24), not the display style.
- **Shapes.** Full-width buttons have the same 16pt corners as fields and
  cards; `outline` and `danger` are neutral fills whose text carries the
  meaning. Chips are pills: a neutral fill, or the accent when selected, with
  no outline. Posters and stills have 8pt corners.
- **Season rows** show the episode still and a formatted air date.

## Consequences

- Every text token is still at least 4.5:1 on `background`,
  `backgroundElement` and `backgroundSelected` in both schemes (ADR 0029's
  rule, measured again with the new values).
- The store screenshots and the App Preview show the old look until they are
  captured again.
- Client only. No backend change, so installed builds are unaffected.
- The title hero's gradient ends in the letterbox black on both themes, not
  the page colour, so its light text never sits on a fade to white.
