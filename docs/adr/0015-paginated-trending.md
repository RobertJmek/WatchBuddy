# 0015 — Trending shelves open a paginated "see all" screen

**Status:** accepted · targets v1.16.0

## Context

The Search tab, with an empty query, shows two `PosterShelf`s — *Trending
Movies* and *Trending TV* — fed by one `getTrending()` call. In Library every
shelf's header is a button (label · count · chevron) that pushes
`/library-section`, a 3-column grid of the whole section. The trending shelves
were the only ones passed no `onPressHeader`, so their headers were dead labels
and the feed ended wherever the horizontal scroll ended.

That end is closer than it looks: TMDB's `/trending/{type}/week` returns **one
page, ~20 titles**, and `getTrending` fetches exactly that. So a "see all"
screen built on the existing data would show the same 20 items the shelf already
scrolls — a new screen that reveals nothing.

## Decision

**The header opens a real screen, and the feed pages.** Two parts:

### The `trending` action returns two different shapes

Called with no parameters it returns `{ movies, tv }` — page 1 of both feeds,
byte-for-byte what it returns today. Called with `media_type` (and optional
`page`) it returns one feed instead: `{ results, page, total_pages }`.

The old shape is kept **because shipped binaries parse it**. Every client
through v1.15.0 calls `action: 'trending'` bare and reads `.movies` / `.tv`; an
edge function deploy reaches all of them at once, with no version gate. This is
the same hazard as the `like_count` → `actor_count` rename that needed migration
`0015` as a compatibility shim — a released binary is a consumer you cannot
update. Adding a shape behind a new parameter is the version of this change that
has no shim.

A consequence worth naming: the deploy must land **before** the v1.16.0 build
ships, and is safe to land at any time before it, precisely because old clients
can't tell the difference.

### A sibling screen, not a generalised `library-section`

`/trending-section` is new. `library-section` was the obvious thing to
generalise and was rejected: it reads the `['library']` query cache and filters
it client-side, and it carries the filter sheet, the chips and the two distinct
empty states that go with filtering. The trending grid pages a remote feed
through `useInfiniteQuery` and has nothing to filter. What they actually share
is a poster grid — about thirty lines, already duplicated in shape elsewhere in
the app. Merging them would mean one screen with two mutually exclusive halves.
Same call, same reasoning as `SwipeToLogRow` vs `SwipeToDismissRow` (ADR 0014).

**The scroll is capped at 10 pages (~200 titles).** "Trending" stops meaning
anything a few hundred titles down, and an unbounded scroll into a weekly
popularity list is a cost with no reader.

**The header count is suppressed on these two shelves.** `PosterShelf` gained a
`showCount` prop for it. In Library the number is the truth about what's behind
the header; on a trending shelf it would say 20 while the screen it opens holds
ten times that.

### The feed is called "Hot", and it does not filter

**Naming:** the shelves and the screen read *Hot Movies* / *Hot TV*. Everything
under the UI — the route, the query keys, the edge function action, this ADR's
title — stays `trending`, because that is the TMDB endpoint the data comes from.
A product label should be free to change without a rename reaching the data
source.

**No filter sheet, unlike `library-section`.** Two of Library's four axes are
meaningless here to begin with: media type is already fixed per section, and own
rating asks a question about titles you have by definition mostly not seen (many
aren't even in the local catalog to carry a rating). Genre and year would work —
TMDB even ships `genre_ids` in the trending payload, which `mapResults` drops.

What kills it is that this is a *paged remote* feed. `library-section` filters a
complete list it already holds; a client-side filter here would filter only the
pages loaded so far, so picking a genre would show one or two titles that grow
as you scroll — and with genres ANDed (ADR 0013) an empty grid would be the
normal outcome, not the exception. Filtering properly would mean a `discover`
action filtering server-side at TMDB, which is a different feature from "see the
rest of the shelf". A weekly popularity list is also short and disposable by
nature; slicing it is not obviously worth either cost. Revisit if the "see all"
screen turns out to be somewhere people linger.

## Consequences

- `getTrendingPage(mediaType, page)` keys off `['trendingPage', mediaType]` —
  deliberately not `['trending']`, which holds a whole-feed snapshot rather than
  an accumulating page list. Both carry the same 24h `staleTime`.
- TMDB repeats a title across pages occasionally, so the accumulated list is
  deduped on `media_type-tmdb_id` before it renders — the duplicate-key hazard
  already handled in `searchTitles`.
- Passing `onPressHeader` to a memoized `PosterShelf` would have silently undone
  the memoization shipped in v1.14.1. `explore.tsx` now builds both `items`
  arrays in a `useMemo` and all three handlers in `useCallback`. The `items`
  arrays were being rebuilt inline on every render already, so the shelves were
  in fact re-rendering on every keystroke in the search box; this fixes that too.
- Nothing here is server state or a migration — the edge function change is a
  deploy, not a `db push`.
- **`getTrendingPage` refuses a response without a `results` array.** The
  deploy-before-build ordering has a second edge the first draft missed: a
  client that asks an *older* proxy for a page gets `{ movies, tv }` back, so
  `results` is undefined. That page reached the query cache, which `query.ts`
  persists to AsyncStorage (`gcTime` 7 days, and here `staleTime` 24h), so a
  single mistimed fetch crashed the screen on every cold open and would not
  refetch its way out. Validating at the seam turns it into the error state the
  screen already has, and a rejected response never persists. Caught on device
  during review, exactly in the window between building and deploying.
