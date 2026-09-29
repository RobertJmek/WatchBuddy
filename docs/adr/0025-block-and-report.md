# ADR 0025 — Block and report user content

**Status:** accepted · targets v1.22.0 · migration `0020`

## Context

Reviews, replies and profiles are user-generated, and the app had no in-app way
to report one or to stop seeing a person. The only channel was an e-mail address
in `docs/safety-standards.md`. Apple's App Review Guideline 1.2 asks for both a
report mechanism and blocking in an app with user-generated content, and Google
Play's UGC policy asks for the same, so this had to exist before App Store
publishing or Play production.

Two facts about the existing backend shaped the design:

- Watch data and reviews are **open-read** (`using (true)`, ADR 0001 and 0004),
  and `get_feed` / `get_stats` are `security invoker`, so they read through those
  same policies.
- Deploying a database change reaches **every installed binary at once** (the
  same lesson as the edge functions, AGENTS.md). v1.12 and v1.21 clients are live
  together.

## Decision

### Enforce it in the read policies, not in the client

A block hides rows in the **policies** of `ratings`, `review_replies`,
`review_likes`, `movie_watches`, `episode_watches`, `library_items` and
`follows`. Because the feed, review lists, threads, likes, diary and stats all
read through those policies, one place covers all of them — **including builds
that have never heard of blocks**, which simply see fewer rows. Filtering in JS
would miss every older client and every query that forgot to apply the filter.

Each policy calls `hidden_user_ids()` as `user_id not in (select …)`. The
function is `security definer` (it must read the rows where the caller is the
*blocked* side, which no policy lets them see) and the subquery does not depend
on the outer row, so it is evaluated **once per query**, not once per row.
Measured on 100k rows: **1 call** for the real policy, **100,003** for a policy
that passes the row's `user_id` to a function. The planner shows it as a
`hashed SubPlan` rather than an `InitPlan`; the guarantee is the same.

### A block is mutual

Neither side sees the other's reviews, replies, likes, watches, library or
follow edges; a follow edge is hidden if **either** end is a blocked person, so
lists and counts agree. Neither can follow, reply to or like the other (the
insert policies refuse it), and no new notification reaches a blocked pair (the
three notification triggers skip it).

- **`block_user(p_target)`** is the only way to create a block: one transaction
  that inserts it and deletes the follows between the pair, both directions.
  There is **no insert grant on `blocks`** — a bare insert would leave the follow
  edges behind, to resurface the day the block was lifted.
- **Unblocking** is a plain delete of your own row. It does **not** restore the
  follows: a block ends the relationship, and lifting it does not get to decide
  that two people follow each other again.
- **Existing notifications are left alone.** The follow row decrements by
  itself when `block_user` deletes the edge; a reply or like notification that
  already exists stays until it ages out or is dismissed.

### `profiles` stays open-read

Installed clients hydrate names and avatars by looking a user id up in
`profiles`; a row that vanishes there can crash them. So the two places that
list profiles directly are handled in the client instead: **user search**
filters out everyone in the hidden set, and the **profile screen** replaces
stats and diary with *"You blocked @x"* (with Unblock) or *"This profile isn't
available"* (no name, no picture).

### A block is not secret

Only the blocker can read a `blocks` row, but `hidden_user_ids()` is callable by
any signed-in user and returns both directions without saying which. That is what
lets the profile screen tell "you blocked them" from "hidden from you", and it
means someone who knows whom *they* blocked can work out who blocked *them*. The
app never announces a block; it also does not pretend the other person cannot
notice one. Removing that would mean giving the client no way to filter search
or explain an empty profile.

### Reports: an insert-only inbox

`reports (reporter_id, target_type, target_id, reason, note)`, with `target_type`
in `review | reply | user` and `reason` in `spam | harassment | spoilers |
other`. The client can **insert its own rows and nothing else** — no select, no
update, no delete. Robert reads the table in the Supabase Dashboard; there is no
e-mail service and no admin screen.

- `unique (reporter_id, target_type, target_id)`: the same thing reported twice
  is one report, and the client treats the unique violation as success (as
  `follow()` does for a duplicate edge).
- **The reporter stops seeing a reported review or reply immediately**:
  `ratings` and `review_replies` also exclude `reported_ids()`, a second definer
  function evaluated once per query. A rating is one row, so its **score goes
  with its text**. A report on a **user** hides nothing — that is what Block is
  for.
- The client must not chain `.select()` on the insert: there is no select grant,
  and `RETURNING` needs one.

### Write checks are written in the positive form

The reply and like insert policies say "the target rating **exists** and its
author is not hidden", not "no rating with a hidden author exists". The negative
form is vacuously true for a row the caller cannot see, and the read policies
above make exactly those rows invisible — it would have allowed the insert it
was written to refuse.

A reply's *parent* is checked through `reply_is_reachable()`, a definer
function, because a policy on `review_replies` cannot subquery `review_replies`
(Postgres: *infinite recursion detected in policy*, whichever command). The
first cut of the migration did exactly that and the test suite caught it.

### Backward compatibility and ordering

The migration is additive for clients: an old build sees fewer rows and nothing
else changes. The **new** build calls `block_user` and inserts into `reports`, so
the migration must be applied in production **before** the build ships. The
agent does not write to production; Robert runs `supabase db push`.

## Verification

- A 102-assertion suite on a throwaway Postgres 16 (three users, both
  directions of a block, reports, `anon`, notifications, the write policies and
  the triggers), run twice: once with Supabase's default privileges and once
  without. It found the recursion above.
- **Negative controls:** the pre-`0020` read policies put back with a block in
  place show the blocked user's rows again; the notification triggers notify
  again once the block is lifted; a per-row policy measures 100k function calls
  against 1.
- For a viewer without blocks or reports, `get_feed`, `get_stats` and `ratings`
  return byte-identical results before and after; a full scan of 200k rows costs
  about 3 ms more (one hash probe per row).
- The real client modules (`moderation.ts`, `social.ts`, `replies.ts`) ran with
  `supabase-js` against a local PostgREST 14 (29 assertions). That settled that a
  `setof uuid` RPC comes back as a plain array of strings, which the shape guard
  in `rpc-shape.ts` relies on.

## Consequences

- **Not device-tested.** The menus, the alerts, the reason sheet, the blocked
  and unavailable states and the accessibility actions were type-checked,
  linted and bundled, and nothing on this list was tapped. The reason sheet
  opens *after* another sheet closes, which iOS can decline to present; it waits
  300 ms for that reason, unverified.
- Reports are read by hand, so a queue is only as good as how often it is
  looked at. `docs/safety-standards.md` promises action "typically within 48
  hours" for abuse reports, and this table is now part of that promise.
- `reports.target_id` is not validated against a real row (it is polymorphic),
  so a signed-in user can insert junk reports of their own. The cost is a few
  useless rows per abusive account, filterable by `reporter_id`.
- Deleting an account cascades its blocks and the reports it filed. Reports
  filed **about** its content stay, holding only an id, a reason and a note.
- The data export does not include blocks yet.
- A reported rating disappears with its score, so the reporter's view of a
  title's community average shifts by that one rating.
