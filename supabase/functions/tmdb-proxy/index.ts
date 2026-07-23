// tmdb-proxy: server-side proxy + cache for TMDB (with OMDb IMDb-rating fallback).
//
// Keeps the TMDB/OMDb keys off the client, and upserts fetched metadata into
// Postgres (using the service-role key) so statistics can run as SQL over the
// user's library. Requires a valid Supabase JWT (verify_jwt stays on), so only
// authenticated app users can call it.
//
// POST body: { action: 'search' | 'find' | 'title' | 'season', ...params }
//   search: { q: string }
//   find:   { external_id: string, external_source: 'tvdb_id' | 'imdb_id' }
//   title:  { tmdb_id: number, media_type: 'movie' | 'tv' }
//   season: { tmdb_id: number, season_number: number }

import { createClient } from 'jsr:@supabase/supabase-js@2';

const TMDB_API_KEY = Deno.env.get('TMDB_API_KEY');
const OMDB_API_KEY = Deno.env.get('OMDB_API_KEY'); // optional
const TMDB = 'https://api.themoviedb.org/3';

// How long a cached title row is served without re-hitting TMDB + OMDb. Title
// metadata (ratings, runtime, poster) drifts slowly, so a week keeps us well
// under OMDb's free-tier 1,000 req/day while staying current. Tunable via env.
const TITLE_CACHE_TTL_MS =
  Number(Deno.env.get('TITLE_CACHE_TTL_HOURS') ?? '168') * 3600_000;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

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
      `https://www.omdbapi.com/?apikey=${OMDB_API_KEY}&i=${imdbId}`,
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

async function handleTrending() {
  // Per-type endpoints don't include a media_type field, so we stamp it.
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
    const couldBackfillImdb =
      !!OMDB_API_KEY && !!cached.imdb_id && cached.imdb_rating == null;
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
    imdb_rating: await imdbRating(imdbId),
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (!TMDB_API_KEY) {
    return json({ error: 'TMDB_API_KEY not configured' }, 500);
  }
  try {
    const { action, q, external_id, external_source, tmdb_id, media_type, season_number } =
      await req.json();
    switch (action) {
      case 'search':
        return await handleSearch(q);
      case 'find':
        return await handleFind(external_id, external_source);
      case 'trending':
        return await handleTrending();
      case 'title':
        return await handleTitle(tmdb_id, media_type);
      case 'season':
        return await handleSeason(tmdb_id, season_number);
      default:
        return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
