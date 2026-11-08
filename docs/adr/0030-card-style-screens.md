# ADR 0030 — Card-style screens

**Status:** proposed · v1.26.0 (one PR, pending Robert's look on a device)

## Context

Robert approved the look of the first-run tutorial cards (ADR 0028) and wants
most of the app to move towards it. Welcome, onboarding and the tutorial
already look that way, and their title block and bottom button are copied
three times. The rest of the app mixes three things the tutorial avoids:

- Bodoni `subtitle` (26/36) used both as section headings and as the text of
  tappable rows (Profile, Edit Profile, About, import-data).
- The `meta` style (12/16 semibold, uppercase, 1.5 letter-spacing) in 16 places.
  Some are eyebrows over a heading, and some are whole sentences in capitals
  ("WE EMAILED A SIGN-IN CODE TO").
- Primary actions in the middle of the scroll content (Edit Profile's Save).

Research done before deciding (recorded in AGENTS.md, "Forms and section
headers"):

- Save in the navigation bar is the form button users miss most, and they leave
  settings forms without saving. A fixed footer avoids that.
- iOS grouped lists uppercase their section headers by default, so a small
  uppercase *section header* is native. The letter-spaced *eyebrow over a
  heading* is the generic-looking pattern.
- Material 3 has no full-width pinned button. Our pinned bar is the app's own
  convention (onboarding), not a platform one.

## Decision

1. **Scope.** Forms and settings-type screens are restyled fully: Sign-in, Edit
   Profile, the Profile tab, About, Blocked, import-data and both importers.
   Lists only get the measures (24 sides, 12 inside a group, 32 between groups)
   and the heading rules, with no structural change: Feed, Library, Search,
   Stats, the title page, the public profile, Diary, library-section,
   trending-section, followers/following and ratings.
2. **Headers.** Every pushed screen keeps the native header, for back and
   swipe-back. On a fully restyled screen the header has **no title**, and an
   **Intro** in the content is the title (as `user/[id]` already does with an
   empty header title). List screens keep their header title and get no Intro.
3. **Primary action.** Edit Profile's Save moves to a pinned **Bottom bar**.
   The "Your data" rows and Delete account stay in the scroll content, which can
   scroll clear of the bar. The bar sits at `useBottomGap()`, so the rule that no
   button sits lower than Delete account holds. The keyboard covers the bar, as on
   onboarding, and the hide-keyboard button dismisses it. **Sign-in has no
   bottom bar:** Apple, Google and email are equal choices, and a pinned "Send
   code" would make email look like the main path. Each option sits in its own
   `Step`, with its button underneath.
4. **`meta` loses its capitals.** One edit in `themed-text.tsx` drops
   `textTransform` and `letterSpacing` and keeps 12/16 semibold, so all 16 call
   sites turn sentence case at once. Group titles stop using `meta` (see 5), and
   sign-in's tagline goes away (replaced by the Intro).
5. **Section heading = `subtitle` (Bodoni 26/36) everywhere.** This is how the
   Library shelves already look, so it changes the fewest screens and keeps
   Bodoni as the app's mark. Stats' section titles and the public profile's
   "Often watches" / "Favorite directors" move onto it. 12 from the heading to
   its content, 32 between sections.
6. **Row label = 17/24 semibold**, the same as a `Step` label, with a grey
   chevron on the right and an optional small note underneath (Theme's value,
   for instance). It becomes `ThemedText type="label"` so `Step` and the rows
   share one definition. It is used on Profile, Edit Profile, About and
   import-data. **Profile** is three groups, 32 apart, with no group titles
   (three rows don't need a Bodoni heading each): View my profile · Statistics ·
   Diary, then Theme, then Sign out. Edit profile stays a button under the
   identity block, and the ⓘ → About link is unchanged.
7. **One PR, one bump: 1.26.0 / vc 78.** The plan was one PR per slice.
   Robert then asked for the whole redesign in a single PR, so he can see it
   on a device and decide whether he wants it at all. It ships only on his word.
   New user-visible copy is in the PR for him to approve.

## What the PR does

1. Primitives: `components/intro.tsx`, `components/bottom-bar.tsx`, the `label`
   text type and the `meta` change. Welcome, onboarding and the tutorial move
   onto them and must stay pixel-identical.
   Onboarding and Edit Profile share `components/profile-fields.tsx`, and every
   settings-type row is `components/row-link.tsx`.
2. Sign-in, Edit Profile, the Profile tab, About, Blocked, import-data and both
   importers become card screens.
3. Lists take the measures and the heading rules only: Stats, the title page
   and public profile (layout only; they are gesture-heavy), Diary, the grid
   sections, followers/following, the tab roots. Library's title count moves
   from over its heading to under it.

## Consequences

- Client-only. No SQL, edge function, RPC or query-key change, so installed
  builds are unaffected.
- Uppercase text survives in two places only: the title hero's metadata line
  (its own exception, text over a photo) and the month initials on Stats' chart
  axis.
- The pinned bar is a WatchBuddy convention on both platforms. On Android it
  departs from Material's trailing FAB on purpose, to match onboarding.
- `subtitle` now means only a heading. A row in Bodoni is a bug.
