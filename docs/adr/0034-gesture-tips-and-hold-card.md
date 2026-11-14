# ADR 0034 — Tips for hidden gestures, and a hold card in the tutorial

**Status:** accepted · v1.28.0

## Context

The tutorial (ADR 0028) predates the hold menu (ADR 0033), the largest
interaction in the app that nothing on screen gives away. An inventory of the
app against the tutorial also found three more gestures with no visible
affordance: the long swipe that logs a whole season, the swipe that dismisses a
notification, and the swipe left from a title to its reviews (the "See all"
link only showed above three reviews). And nobody who installed before a
gesture shipped ever sees the tutorial again unless they replay it from About.

Robert asked for a hold card in the tutorial and "hints and whatever the rest
needs", and left the design to the agent.

Research (NN/g on onboarding tutorials and instructional overlays): up-front
tutorials are skipped and forgotten; help shown at the moment of relevance
works better; one hint at a time, ultra-short, easy to dismiss; and a
gesture-only action should also have a visible way in.

## Decision

- **A sixth tutorial card, "Hold a title"**, fourth in order (after Library,
  before Find friends). It is the chosen title's poster inside the real
  `TitleHold`, so the menu that opens is the real one and a chosen row writes
  for real, like every other card (ADR 0028's rule). A ring pulses on the
  poster until the menu has been opened once.
- **`Tip`** (`components/tip.tsx`): one line of text and "Got it", in the place
  the gesture works. It leaves for good when the user does the gesture
  (`markTipDone`) or taps "Got it". State is per install in AsyncStorage
  (`wb:tip-done:<id>`), in `lib/onboarding.ts`. Hidden until storage answers;
  a storage failure hides it.
- Three tips, one per screen:
  - `hold-menu`: Library, above the shelves. Done when any hold menu opens
    (the tutorial card counts).
  - `season-swipe`: a title's Seasons heading. Done on the first season log.
  - `notification-dismiss`: above the notifications, only when there are any.
    Done on the first dismissal.
- **A visible way in instead of a tip** where one was cheap: the title page
  always shows a link to its reviews when there are any ("Open reviews ›" up
  to three, "See all N reviews ›" above).
- **No tip** where a visible control already does the same thing (Feed
  segments have the segmented control; the tab bar; back) or the tutorial
  already teaches the gesture (swipe to log, drag to rate).

To add a tip: a new `TipId`, a `<Tip>` where the gesture works, and
`markTipDone` in the gesture's success callback.

## Consequences

- Client only: no migration, no edge function, no query key change. The tip
  flags are new AsyncStorage keys nothing else reads.
- Existing users see each tip once too. That is intended: they never saw the
  tutorial teach these.
- The tutorial is one card longer. The known gap from ADR 0028 stays: a user
  who skips the profile step and kills the app before the tutorial never sees
  it (no tutorial-seen flag).
- Not seen on a device when this was written: the notifications tip (the test
  account has no notifications), iOS, a row chosen from the tutorial's menu.
