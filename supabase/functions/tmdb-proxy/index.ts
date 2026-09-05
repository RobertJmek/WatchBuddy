// tmdb-proxy: server-side proxy + cache for TMDB (with OMDb IMDb-rating fallback).
//
// Keeps the TMDB/OMDb keys off the client, and upserts fetched metadata into
// Postgres (using the service-role key) so statistics can run as SQL over the
// user's library. Requires a valid Supabase JWT (verify_jwt stays on), so only
// authenticated app users can call it.
//
// POST body: { action: 'search' | 'find' | 'trending' | 'title' | 'season', ...params }
//   search:   { q: string }
//   find:     { external_id: string, external_source: 'tvdb_id' | 'imdb_id' }
//   trending: {} -> { movies, tv } (page 1 of both)
//             { media_type: 'movie' | 'tv', page?: number }
//               -> { results, page, total_pages }
//   title:    { tmdb_id: number, media_type: 'movie' | 'tv' }
//   season:   { tmdb_id: number, season_number: number }
//
// Every parameter is validated before it reaches a URL or a query, and every
// call spends from a Postgres-backed token bucket (migration 0018) -- the two
// upstreams are shared resources and one caller must not be able to drain them.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const TMDB_API_KEY = Deno.env.get('TMDB_API_KEY');
const OMDB_API_KEY = Deno.env.get('OMDB_API_KEY'); // optional
const TMDB = 'https://api.themoviedb.org/3';

// How long a cached title row is served without re-hitting TMDB + OMDb. Title
// metadata (ratings, runtime, poster) drifts slowly, so a week keeps us well
// under OMDb's free-tier 1,000 req/day while staying current. Tunable via env.
const TITLE_CACHE_TTL_MS =
  Number(Deno.env.get('TITLE_CACHE_TTL_HOURS') ?? '168') * 3600_000;

// How long a fruitless OMDb lookup is remembered. Separate from the title TTL
// because it answers a different question: not "is this metadata stale" but
// "have we already asked OMDb about this and been told nothing". Without it a
// title OMDb has no rating for is refetched from TMDB *and* re-asked of OMDb on
// every single view, forever -- see migration 0017.
const IMDB_RECHECK_MS =
  Number(Deno.env.get('IMDB_RECHECK_HOURS') ?? '24') * 3600_000;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', ...headers },
  });
}

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

// --- caller identity ----------------------------------------------------
const NIL_UUID = '00000000-0000-0000-0000-000000000000';
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The calling user's id, read from the JWT the gateway already verified.
 *
 * Deliberately NOT re-verified here: `verify_jwt` is on for this function, so an
 * unsigned or expired token never reaches us, and re-checking would mean a round
 * trip to the auth server on every call. The claim is used only to pick a rate
 * limit bucket -- never to authorise a read or a write, which stay under RLS.
 *
 * Null means "no user claim": a caller presenting the publicly-embedded anon key
 * rather than a session. Those share one tight bucket instead of going unlimited.
 */
function callerId(req: Request): string | null {
  const header = req.headers.get('Authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const payload = token.split('.')[1];
  if (!payload) return null;
  try {
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(
      atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)),
      (c) => c.charCodeAt(0),
    );
    const claims = JSON.parse(new TextDecoder().decode(bytes));
    return typeof claims?.sub === 'string' && UUID_RE.test(claims.sub)
      ? claims.sub
      : null;
  } catch {
    return null;
  }
}

// --- rate limiting ------------------------------------------------------
type Budget = { capacity: number; refillPerSecond: number };

/**
 * Per-caller ceiling on upstream TMDB requests.
 *
 * Sized off the heaviest legitimate client, the in-app TV Time importer: it
 * resolves three titles at a time and one resolution costs up to three TMDB
 * pages, so a real import peaks around 30 upstream requests a second. The limit
 * therefore sits just above what one honest heavy user needs -- enough to stop a
 * runaway loop or a scripted flood from monopolising the app's TMDB budget,
 * not enough for an import to ever feel it.
 */
const USER_BUDGET: Budget = { capacity: 300, refillPerSecond: 40 };

/** Callers with no user claim share one bucket, so the anon key buys little. */
const ANON_BUDGET: Budget = { capacity: 30, refillPerSecond: 1 };

/**
 * OMDb's free tier is 1,000 requests a DAY for the whole app, not per user, so
 * this bucket is global (subject = the nil uuid). ~700/day leaves headroom, and
 * the burst capacity covers an import touching many uncached titles at once.
 * Running dry degrades gracefully: the title still loads, without its IMDb
 * rating, and the backfill is retried after IMDB_RECHECK_HOURS.
 */
const OMDB_BUDGET: Budget = { capacity: 100, refillPerSecond: 700 / 86400 };

/**
 * Spend `cost` tokens, or report how long until they exist.
 *
 * Fails OPEN: if the limiter itself errors, the request goes through. A broken
 * accountant must not be able to close the shop -- the upstreams have their own
 * limits, and the alternative is a database hiccup taking the whole app down.
 */
async function spend(
  bucket: string,
  subject: string,
  cost: number,
  budget: Budget,
): Promise<{ allowed: boolean; retryAfter: number }> {
  const { data, error } = await admin.rpc('consume_rate_limit', {
    p_bucket: bucket,
    p_subject: subject,
    p_cost: cost,
    p_capacity: budget.capacity,
    p_refill_per_second: budget.refillPerSecond,
  });
  if (error) {
    console.error('rate limit unavailable:', error.message);
    return { allowed: true, retryAfter: 0 };
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (row?.allowed === false) {
    return {
      allowed: false,
      retryAfter: Math.max(1, Math.ceil(row.retry_after_seconds ?? 1)),
    };
  }
  return { allowed: true, retryAfter: 0 };
}

// --- request validation -------------------------------------------------
// Every value below reaches either a TMDB URL path/query or a Postgres filter.
// Unvalidated they were interpolated straight in: `media_type` in particular
// went into `/${mediaType}/${tmdbId}` with nothing checking it was one of two
// words.
const MAX_TMDB_ID = 100_000_000; // TMDB ids are seven digits today
const MAX_SEASON_NUMBER = 1_000;
const MAX_TRENDING_PAGE = 500; // TMDB's own ceiling; past it the endpoint errors
const MAX_QUERY_LENGTH = 200;
const MAX_EXTERNAL_ID_LENGTH = 64;

function mediaType(value: unknown): 'movie' | 'tv' | null {
  return value === 'movie' || value === 'tv' ? value : null;
}

function wholeNumber(value: unknown, min: number, max: number): number | null {
  const n =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value)
        : NaN;
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

function badRequest(message: string) {
  return json({ error: message }, 400);
}

async function tmdb(path: string, params: Record<string, string> = {}) {
  const url = new URL(`${TMDB}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  // TMDB v4 read-access token (JWT) is sent as a Bearer header; it works
  // against the same v3 endpoints.
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${TMDB_API_KEY}`,
      accept: 'application/json',
    },
  });
  if (!res.ok) throw new Error(`TMDB ${path} -> ${res.status}`);
  return res.json();
}

async function imdbRating(imdbId: string | null): Promise<number | null> {
  if (!imdbId || !OMDB_API_KEY) return null;
  try {
    const res = await fetch(
      `https://www.omdbapi.com/?apikey=${OMDB_API_KEY}&i=${encodeURIComponent(imdbId)}`,
    );
    const data = await res.json();
    const r = parseFloat(data?.imdbRating);
    return Number.isFinite(r) ? r : null;
  } catch {
    return null;
  }
}

// --- search -------------------------------------------------------------
async function handleSearch(q: string) {
  if (!q?.trim()) return json({ results: [] });
  // One TMDB page is only 20 mixed results (often ~15 after dropping people),
  // so pull the first three pages for a usefully deep list.
  const pages = await Promise.all(
    ['1', '2', '3'].map((page) =>
      tmdb('/search/multi', { query: q, include_adult: 'false', page }).catch(
        () => ({ results: [] }),
      ),
    ),
  );
  const results = pages
    .flatMap((data: any) => data.results ?? [])
    .filter((r: any) => r.media_type === 'movie' || r.media_type === 'tv')
    .map((r: any) => ({
      tmdb_id: r.id,
      media_type: r.media_type,
      title: r.title ?? r.name,
      overview: r.overview ?? '',
      poster_path: r.poster_path ?? null,
      release_date: r.release_date ?? r.first_air_date ?? null,
      vote_average: r.vote_average ?? null,
    }));
  return json({ results });
}

// --- find (lookup by external id, e.g. TVDB) ----------------------------
const FIND_SOURCES = ['tvdb_id', 'imdb_id'];

async function handleFind(externalId: string, externalSource: string) {
  if (!externalId || !FIND_SOURCES.includes(externalSource)) {
    return json({ error: 'find requires external_id and a valid external_source' }, 400);
  }
  const data = await tmdb(`/find/${encodeURIComponent(externalId)}`, {
    external_source: externalSource,
  });
  // No catalog writes here — a subsequent 'title' action does the caching.
  const results = [
    ...mapResults(data.tv_results, 'tv'),
    ...mapResults(data.movie_results, 'movie'),
  ];
  return json({ results });
}

// --- trending (default discovery feed) ---------------------------------
function mapResults(results: any[], mediaType: 'movie' | 'tv') {
  return (results ?? []).map((r: any) => ({
    tmdb_id: r.id,
    media_type: mediaType,
    title: r.title ?? r.name,
    overview: r.overview ?? '',
    poster_path: r.poster_path ?? null,
    release_date: r.release_date ?? r.first_air_date ?? null,
    vote_average: r.vote_average ?? null,
  }));
}

/**
 * Two shapes behind one action, on purpose.
 *
 * Without `media_type` this returns `{ movies, tv }` — page 1 of both feeds,
 * exactly what every shipped client through v1.15.0 asks for and parses. That
 * response must not change shape; renaming/removing a field a released binary
 * reads breaks it the moment this deploys (see migration 0015's lesson).
 *
 * With `media_type` it returns one paginated feed instead, for the "see all"
 * grid: `{ results, page, total_pages }`. TMDB caps trending at 1000 pages but
 * the feed is only meaningful for the first few.
 */
async function handleTrending(mediaType?: 'movie' | 'tv', page?: number) {
  // Per-type endpoints don't include a media_type field, so we stamp it.
  if (mediaType) {
    const p = Math.max(1, Math.floor(page ?? 1));
    const feed = await tmdb(`/trending/${mediaType}/week`, { page: String(p) });
    return json({
      results: mapResults(feed.results, mediaType),
      page: feed.page ?? p,
      total_pages: feed.total_pages ?? p,
    });
  }
  const [movies, tv] = await Promise.all([
    tmdb('/trending/movie/week'),
    tmdb('/trending/tv/week'),
  ]);
  return json({
    movies: mapResults(movies.results, 'movie'),
    tv: mapResults(tv.results, 'tv'),
  });
}

// --- title (detail + cache) --------------------------------------------
/**
 * Should this cached row send us back to OMDb for its IMDb rating?
 *
 * Yes when the rating is still missing and either OMDb has never been asked, or
 * it was asked long enough ago to be worth asking again. The last clause is the
 * whole point: without it "OMDb has no rating for this title" is indistinguish-
 * able from "not backfilled yet", the row never satisfies the cache gate, and
 * every view of it costs a TMDB refetch plus one of OMDb's 1,000 daily requests.
 */
function needsImdbLookup(row: {
  imdb_id: string | null;
  imdb_rating: number | null;
  imdb_checked_at: string | null;
}) {
  if (!OMDB_API_KEY || !row.imdb_id || row.imdb_rating != null) return false;
  if (!row.imdb_checked_at) return true;
  return Date.now() - new Date(row.imdb_checked_at).getTime() > IMDB_RECHECK_MS;
}

async function handleTitle(tmdbId: number, mediaType: 'movie' | 'tv') {
  // Cache gate: serve a recent copy without re-hitting TMDB + OMDb. We still
  // force a refetch for a row that *could* carry an IMDb rating but doesn't yet
  // (OMDb key now set, imdb_id known, imdb_rating still null) so enabling the
  // key backfills on next view instead of after the TTL window expires.
  const { data: cached } = await admin
    .from('titles')
    .select('*')
    .eq('tmdb_id', tmdbId)
    .eq('media_type', mediaType)
    .maybeSingle();

  if (cached) {
    const fresh =
      Date.now() - new Date(cached.cached_at).getTime() < TITLE_CACHE_TTL_MS;
    const couldBackfillImdb = needsImdbLookup(cached);
    if (fresh && !couldBackfillImdb) {
      const seasons =
        mediaType === 'tv'
          ? ((
              await admin
                .from('seasons')
                .select('*')
                .eq('title_id', cached.id)
                .order('season_number')
            ).data ?? [])
          : [];
      return json({ title: cached, seasons });
    }
  }

  const detail = await tmdb(`/${mediaType}/${tmdbId}`, {
    append_to_response: 'credits,external_ids',
  });

  const imdbId = detail.imdb_id ?? detail.external_ids?.imdb_id ?? null;
  const isTv = mediaType === 'tv';

  // OMDb is the scarce upstream (1,000/day for everyone), so it gets its own
  // global budget. Stamp the attempt either way: a refusal that left
  // imdb_checked_at null would send the very next view straight back here.
  // A refusal must not blank a rating we already have, either -- only an actual
  // answer from OMDb is allowed to change the value.
  let imdbRatingValue: number | null = cached?.imdb_rating ?? null;
  let imdbCheckedAt: string | null = cached?.imdb_checked_at ?? null;
  if (imdbId && OMDB_API_KEY) {
    const omdb = await spend('omdb', NIL_UUID, 1, OMDB_BUDGET);
    imdbCheckedAt = new Date().toISOString();
    if (omdb.allowed) {
      imdbRatingValue = await imdbRating(imdbId);
    } else {
      console.warn(`omdb budget exhausted; skipping ${imdbId}`);
    }
  } else if (!imdbId) {
    imdbRatingValue = null;
  }

  const titleRow = {
    tmdb_id: tmdbId,
    media_type: mediaType,
    imdb_id: imdbId,
    title: isTv ? detail.name : detail.title,
    original_title: isTv ? detail.original_name : detail.original_title,
    overview: detail.overview ?? null,
    original_language: detail.original_language ?? null,
    release_date: (isTv ? detail.first_air_date : detail.release_date) || null,
    runtime: isTv ? (detail.episode_run_time?.[0] ?? null) : detail.runtime,
    poster_path: detail.poster_path ?? null,
    backdrop_path: detail.backdrop_path ?? null,
    origin_country: isTv
      ? (detail.origin_country?.[0] ?? null)
      : (detail.production_countries?.[0]?.iso_3166_1 ?? null),
    tmdb_rating: detail.vote_average ?? null,
    imdb_rating: imdbRatingValue,
    imdb_checked_at: imdbCheckedAt,
    popularity: detail.popularity ?? null,
    status: detail.status ?? null,
    number_of_seasons: detail.number_of_seasons ?? null,
    number_of_episodes: detail.number_of_episodes ?? null,
    cached_at: new Date().toISOString(),
  };

  const { data: title, error } = await admin
    .from('titles')
    .upsert(titleRow, { onConflict: 'tmdb_id,media_type' })
    .select()
    .single();
  if (error) throw new Error(`upsert title: ${error.message}`);

  // The response only needs the title (+ seasons below); genres/credits/networks
  // exist for statistics SQL, so they're written after responding.
  const enrich = async () => {
    // genres
    const genres = detail.genres ?? [];
    if (genres.length) {
      await admin.from('genres').upsert(genres, { onConflict: 'id' });
      await admin.from('title_genres').upsert(
        genres.map((g: any) => ({ title_id: title.id, genre_id: g.id })),
        { onConflict: 'title_id,genre_id' },
      );
    }

    // credits: top cast + directors
    const cast = (detail.credits?.cast ?? []).slice(0, 15);
    const directors = (detail.credits?.crew ?? []).filter(
      (c: any) => c.job === 'Director',
    );
    const people = [...cast, ...directors];
    if (people.length) {
      await admin.from('people').upsert(
        people.map((p: any) => ({
          tmdb_id: p.id,
          name: p.name,
          profile_path: p.profile_path ?? null,
        })),
        { onConflict: 'tmdb_id' },
      );
      const { data: peopleRows } = await admin
        .from('people')
        .select('id, tmdb_id')
        .in('tmdb_id', people.map((p: any) => p.id));
      const idByTmdb = new Map(peopleRows?.map((r) => [r.tmdb_id, r.id]));
      const credits = [
        ...cast.map((c: any) => ({
          title_id: title.id,
          person_id: idByTmdb.get(c.id),
          department: 'cast',
          job: 'Actor',
          role: c.character ?? null,
          sort_order: c.order ?? null,
        })),
        ...directors.map((c: any) => ({
          title_id: title.id,
          person_id: idByTmdb.get(c.id),
          department: 'crew',
          job: 'Director',
          role: null,
          sort_order: null,
        })),
      ].filter((c) => c.person_id);
      if (credits.length) {
        await admin
          .from('credits')
          .upsert(credits, { onConflict: 'title_id,person_id,job' });
      }
    }

    // networks (tv)
    const networks = detail.networks ?? [];
    if (networks.length) {
      await admin.from('networks').upsert(
        networks.map((n: any) => ({
          id: n.id,
          name: n.name,
          logo_path: n.logo_path ?? null,
        })),
        { onConflict: 'id' },
      );
      await admin.from('title_networks').upsert(
        networks.map((n: any) => ({ title_id: title.id, network_id: n.id })),
        { onConflict: 'title_id,network_id' },
      );
    }
  };
  // Keep the isolate alive past the response while enrichment finishes.
  try {
    // @ts-ignore EdgeRuntime is provided by the Supabase Edge runtime
    EdgeRuntime.waitUntil(enrich().catch((e) => console.error('enrich:', e)));
  } catch {
    enrich().catch((e) => console.error('enrich:', e));
  }

  // seasons (tv) — episodes are fetched on demand via action 'season'
  let seasons: unknown[] = [];
  if (isTv && detail.seasons?.length) {
    const seasonRows = detail.seasons.map((s: any) => ({
      title_id: title.id,
      tmdb_id: s.id,
      season_number: s.season_number,
      name: s.name ?? null,
      overview: s.overview ?? null,
      episode_count: s.episode_count ?? null,
      air_date: s.air_date || null,
      poster_path: s.poster_path ?? null,
    }));
    const { data } = await admin
      .from('seasons')
      .upsert(seasonRows, { onConflict: 'title_id,season_number' })
      .select();
    seasons = data ?? [];
  }

  return json({ title, seasons });
}

// --- season (episodes + cache) -----------------------------------------
async function handleSeason(tmdbId: number, seasonNumber: number) {
  const { data: title } = await admin
    .from('titles')
    .select('id')
    .eq('tmdb_id', tmdbId)
    .eq('media_type', 'tv')
    .single();
  if (!title) return json({ error: 'Title not cached yet' }, 409);

  const { data: season } = await admin
    .from('seasons')
    .select('id')
    .eq('title_id', title.id)
    .eq('season_number', seasonNumber)
    .single();
  if (!season) return json({ error: 'Season not cached yet' }, 409);

  // Cache gate: serve stored episodes while fresh, and fall back to them
  // (stale) if TMDB is unreachable — episode metadata barely changes.
  const { data: cachedEps } = await admin
    .from('episodes')
    .select('*')
    .eq('season_id', season.id)
    .order('episode_number');
  if (cachedEps?.length) {
    const newest = Math.max(
      ...cachedEps.map((e: any) => new Date(e.cached_at ?? 0).getTime()),
    );
    if (Date.now() - newest < TITLE_CACHE_TTL_MS) {
      return json({ episodes: cachedEps });
    }
  }

  let data;
  try {
    data = await tmdb(`/tv/${tmdbId}/season/${seasonNumber}`);
  } catch (err) {
    if (cachedEps?.length) return json({ episodes: cachedEps });
    throw err;
  }
  const episodeRows = (data.episodes ?? []).map((e: any) => ({
    season_id: season.id,
    title_id: title.id,
    tmdb_id: e.id,
    season_number: seasonNumber,
    episode_number: e.episode_number,
    name: e.name ?? null,
    overview: e.overview ?? null,
    runtime: e.runtime ?? null,
    air_date: e.air_date || null,
    still_path: e.still_path ?? null,
    cached_at: new Date().toISOString(),
  }));
  const { data: episodes, error } = await admin
    .from('episodes')
    .upsert(episodeRows, { onConflict: 'season_id,episode_number' })
    .select();
  if (error) throw new Error(`upsert episodes: ${error.message}`);

  return json({ episodes });
}

/**
 * Turn a request body into a validated call plus what it costs upstream.
 *
 * Cost is the worst-case number of TMDB requests the action makes, so the
 * budget meters the shared resource rather than the convenience of an action.
 * (`title` is charged 1 for the TMDB detail; its OMDb half has its own bucket.)
 */
function plan(
  body: Record<string, unknown>,
): { cost: number; run: () => Promise<Response> } | Response {
  const { action } = body;
  switch (action) {
    case 'search': {
      const q = typeof body.q === 'string' ? body.q.trim() : '';
      if (q.length > MAX_QUERY_LENGTH) {
        return badRequest('search query is too long');
      }
      return { cost: 3, run: () => handleSearch(q) };
    }
    case 'find': {
      const externalId =
        typeof body.external_id === 'string' ? body.external_id.trim() : '';
      // TVDB ids are digits, IMDb ids are tt + digits. Anything else is either a
      // typo or an attempt to steer the URL path.
      if (
        !/^[A-Za-z0-9]+$/.test(externalId) ||
        externalId.length > MAX_EXTERNAL_ID_LENGTH
      ) {
        return badRequest('external_id must be alphanumeric');
      }
      const source = body.external_source;
      if (typeof source !== 'string' || !FIND_SOURCES.includes(source)) {
        return badRequest('external_source must be tvdb_id or imdb_id');
      }
      return { cost: 1, run: () => handleFind(externalId, source) };
    }
    case 'trending': {
      // No media_type is the shape every client through v1.15.0 asks for and
      // must keep getting: page 1 of both feeds. Do not "validate" it into an
      // error -- absent is a valid, load-bearing value here.
      if (body.media_type == null) {
        return { cost: 2, run: () => handleTrending() };
      }
      const type = mediaType(body.media_type);
      if (!type) return badRequest('media_type must be movie or tv');
      const page =
        body.page == null ? 1 : wholeNumber(body.page, 1, MAX_TRENDING_PAGE);
      if (page === null) {
        return badRequest(`page must be a whole number 1-${MAX_TRENDING_PAGE}`);
      }
      return { cost: 1, run: () => handleTrending(type, page) };
    }
    case 'title': {
      const type = mediaType(body.media_type);
      if (!type) return badRequest('media_type must be movie or tv');
      const id = wholeNumber(body.tmdb_id, 1, MAX_TMDB_ID);
      if (id === null) return badRequest('tmdb_id must be a positive whole number');
      return { cost: 1, run: () => handleTitle(id, type) };
    }
    case 'season': {
      const id = wholeNumber(body.tmdb_id, 1, MAX_TMDB_ID);
      if (id === null) return badRequest('tmdb_id must be a positive whole number');
      // Season 0 is TMDB's specials season, so the floor is 0 and not 1.
      const season = wholeNumber(body.season_number, 0, MAX_SEASON_NUMBER);
      if (season === null) return badRequest('season_number must be a whole number');
      return { cost: 1, run: () => handleSeason(id, season) };
    }
    default:
      return json({ error: `Unknown action: ${String(action)}` }, 400);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (!TMDB_API_KEY) {
    return json({ error: 'TMDB_API_KEY not configured' }, 500);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return badRequest('Request body must be JSON');
  }
  if (typeof body !== 'object' || body === null) {
    return badRequest('Request body must be a JSON object');
  }

  const planned = plan(body);
  if (planned instanceof Response) return planned;

  const uid = callerId(req);
  const limit = await spend(
    'tmdb-proxy',
    uid ?? NIL_UUID,
    planned.cost,
    uid ? USER_BUDGET : ANON_BUDGET,
  );
  if (!limit.allowed) {
    return json(
      {
        error: `Too many requests. Try again in ${limit.retryAfter}s.`,
      },
      429,
      { 'Retry-After': String(limit.retryAfter) },
    );
  }

  try {
    return await planned.run();
  } catch (err) {
    // The message can carry an upstream URL, a Postgres error or a key-shaped
    // string; it belongs in the logs, not in a client alert.
    console.error(`${String(body.action)} failed:`, err);
    return json(
      { error: 'The movie database is unavailable right now. Try again later.' },
      502,
    );
  }
});
