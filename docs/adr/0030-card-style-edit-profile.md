# ADR 0030 — Card-style Edit Profile

**Status:** accepted · v1.25.3

## Context

Robert wanted to see most of the app in the look of the first-run tutorial
cards (ADR 0028). PR #118 built that across the app: Sign-in, Profile, About,
Blocked, the importers, Stats, the title page, the lists, and a sentence-case
`meta`. He looked at it on the simulator and kept **only Edit Profile**. The
rest stays as it is on `main`, so don't propose it again without new reasons.

## Decision

Edit Profile becomes a card screen, built from #118's pieces:

- The native header keeps back and swipe-back but has **no title**. An
  **Intro** in the content is the title: "Edit profile" / "This is how friends
  see you." (`components/intro.tsx`).
- The fields are `Step`s, like onboarding's profile step: a dashed photo
  circle, Username (with its rule), Name, and Bio ("Optional, up to 160
  characters") (`components/profile-fields.tsx`).
- **Save is pinned in a bottom bar** at `useBottomGap()`
  (`components/bottom-bar.tsx`). A Save in the scroll or in the navigation bar
  is the form button people miss most, and they leave without saving. The bar
  sits at the bottom gap, so no button is lower than Delete account.
- The data rows (Import, Blocked, Export) stay exactly as they were: Bodoni
  `subtitle` text with a chevron and a hairline, no group heading. #118's
  smaller semibold rows were tried and declined. Delete account stays in the
  scroll, under them.

**The photo is framed in a circle, on our own screen.** The system crop box is
always a square on iOS (expo-image-picker's `shape: 'oval'` is Android only),
and the avatar is round. So the picker no longer edits: `pickAvatarImage()`
opens `components/avatar-cropper.tsx` ("Move and scale"), where you drag and
pinch the photo under a circle, then crops it to a 512px JPEG with
`expo-image-manipulator` (a new native module, so it needs a new build). The
same screen serves onboarding and both platforms. The picker is also called
without asking for photo access first: the system picker needs none, and
asking showed two prompts in a row on iOS.

Onboarding keeps its own copy of the fields for now. Moving it onto
`ProfileFields` is a refactor that should leave it pixel-identical, and it isn't
part of this change.

## Consequences

- Needs a new binary (expo-image-manipulator). Still client-only: no SQL, edge
  function, RPC or query-key change, so installed builds are unaffected. Old
  builds keep uploading their square crop, which shows round anyway.
- `meta` keeps its uppercase on every other screen.
- The keyboard covers the bottom bar, as on onboarding. The hide-keyboard
  button puts it away.
