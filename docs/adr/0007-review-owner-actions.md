# ADR 0007 — Owner edit/delete on a review, delete = clear text (keep the rating)

**Status:** accepted · 2026-07-23

## Context

A Review is not its own entity: it is the optional `review` text on a `ratings`
row, which also carries the score (`value`), its likes (ADR 0001), and its
replies (ADR 0002). On a review's own thread page (`/review/[ratingId]`) the
author could see likes and replies but had no way to edit or delete the review.

"Delete my review" is ambiguous because the text and the score share one row.
Hard-deleting the row would also drop the score, its likes, and — via cascade —
every reply. The alternative is to treat the *review* as only the text.

## Decision

- The author gets a **⋯ menu** on the review card (same ActionSheet/Modal +
  confirm `Alert` used for replies), shown only when the review is theirs.
- **Edit is text-only.** The score is changed from the title page (`RatingBar`);
  the review page never exposes the 1–10 picker.
- **Delete clears the text and keeps the row.** `review` is set empty; the
  `ratings` row survives, so the **score stays**, its **likes persist** (harmless,
  and revive if text returns — ADR 0001), and any **replies are orphaned** (kept
  in the DB, no longer surfaced anywhere). There is no hard delete of the rating
  from this screen.
- Both actions write through the existing `setRating` upsert — the single write
  path for `ratings` — so no id-keyed write function and no new RLS surface.

## Consequences

- Edit and delete both bump `updated_at` (via the `ratings` update trigger), so
  the row can resurface in followers' feeds: an edit as a `review` event, a
  **delete as a `rating` event** ("X rated Title 8/10"). Accepted as a
  low-harm edge rather than fighting the trigger.
- A confirmation must state that the score is kept, or users will assume delete
  also removes their rating.
- Orphaned replies are tolerated (same spirit as persisted likes); they reappear
  if the author writes a review again for that title.
- Saving an edit with empty text is equivalent to delete (navigates back).
- Applies to both `ReviewThread` variants (root `/review/[ratingId]` and library
  `/thread/[ratingId]`) since they share the component.
