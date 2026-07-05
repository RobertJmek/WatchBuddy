#!/usr/bin/env python3
"""
import_tvtime.py — Migrate a TV Time GDPR export into WatchBuddy.

See scripts/import_tvtime.md for full setup instructions.

Usage:
    python scripts/import_tvtime.py --gdpr-path /path/to/gdpr-data

Required env vars (add to .env at project root):
    EXPO_PUBLIC_SUPABASE_URL  — already present
    SUPABASE_SERVICE_ROLE_KEY — from Supabase dashboard → Settings → API
    TMDB_API_KEY              — TMDB v4 read-access token
    WATCHBUDDY_USER_ID        — your user UUID from Supabase → Authentication → Users
"""

from __future__ import annotations

import argparse
import csv
import os
import re
import sys
import time
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

import requests
from dotenv import load_dotenv
from supabase import create_client

# ---------------------------------------------------------------------------
# Config / bootstrap
# ---------------------------------------------------------------------------

ROOT = Path(__file__).parent.parent
load_dotenv(ROOT / ".env")


def _require(key: str) -> str:
    v = os.environ.get(key)
    if not v:
        sys.exit(f"[error] Missing env var: {key}\n       See scripts/import_tvtime.md")
    return v


SUPABASE_URL     = _require("EXPO_PUBLIC_SUPABASE_URL")
SUPABASE_SERVICE = _require("SUPABASE_SERVICE_ROLE_KEY")
TMDB_KEY         = _require("TMDB_API_KEY")
USER_ID          = _require("WATCHBUDDY_USER_ID")

TMDB_BASE     = "https://api.themoviedb.org/3"
ENDED_STATUS  = {"Ended", "Canceled", "Cancelled"}

# Shows whose TV Time name resolves to the wrong TMDB entry via search.
# Map the lowercased TV Time name to the correct TMDB TV id.
SHOW_OVERRIDES: dict[str, int] = {
    "monster (2022)": 113988,  # Dahmer – Monster: The Jeffrey Dahmer Story
}

_admin = create_client(SUPABASE_URL, SUPABASE_SERVICE)

# ---------------------------------------------------------------------------
# TMDB helpers
# ---------------------------------------------------------------------------

def _tmdb(path: str, **params) -> dict:
    # v4 Read Access Token is a JWT (starts with "eyJ"); v3 API key is a short hex string.
    if TMDB_KEY.startswith("eyJ"):
        headers = {"Authorization": f"Bearer {TMDB_KEY}", "accept": "application/json"}
        query   = {k: v for k, v in params.items() if v is not None}
    else:
        headers = {"accept": "application/json"}
        query   = {"api_key": TMDB_KEY, **{k: v for k, v in params.items() if v is not None}}
    r = requests.get(f"{TMDB_BASE}{path}", headers=headers, params=query, timeout=15)
    r.raise_for_status()
    time.sleep(0.05)  # stay well under TMDB's 50 req/s limit
    return r.json()


def _find_by_tvdb(tvdb_id: str) -> dict | None:
    data = _tmdb(f"/find/{tvdb_id}", external_source="tvdb_id")
    results = data.get("tv_results", [])
    return results[0] if results else None


def _search_movie(name: str, year: str | None) -> dict | None:
    for query in _name_variants(name):
        data = _tmdb("/search/movie", query=query, primary_release_year=year)
        if data.get("results"):
            return data["results"][0]
    if year:  # retry without the year constraint
        return _search_movie(name, None)
    return None


def _search_show(name: str) -> dict | None:
    """Try exact name first, then strip a trailing (year) qualifier."""
    override = SHOW_OVERRIDES.get(name.lower())
    if override:
        return {"id": override}
    for query in _name_variants(name):
        data = _tmdb("/search/tv", query=query)
        results = data.get("results", [])
        if results:
            return results[0]
    return None


def _name_variants(name: str) -> list[str]:
    variants = [name]
    cleaned = re.sub(r"\s*\(\d{4}\)\s*$", "", name).strip()
    if cleaned and cleaned != name:
        variants.append(cleaned)
    return variants


def _fetch_detail(tmdb_id: int) -> dict:
    return _tmdb(f"/tv/{tmdb_id}", append_to_response="credits")


def _fetch_season(tmdb_id: int, season_num: int) -> list[dict]:
    try:
        return _tmdb(f"/tv/{tmdb_id}/season/{season_num}").get("episodes", [])
    except requests.HTTPError:
        return []

# ---------------------------------------------------------------------------
# Library status inference
# ---------------------------------------------------------------------------

def _infer_status(archived: bool, nb_seen: int, detail: dict) -> str:
    if archived:
        return "dropped"
    if nb_seen == 0:
        return "watchlist"
    total = detail.get("number_of_episodes") or 0
    if detail.get("status") in ENDED_STATUS:
        return "completed" if (total and nb_seen >= total) else "on_hold"
    return "watching"

# ---------------------------------------------------------------------------
# Catalog upsert (service role)
# ---------------------------------------------------------------------------

def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _upsert_metadata(title_id: str, detail: dict) -> None:
    """Genres, top cast + directors, and networks — mirrors the tmdb-proxy."""
    genres = detail.get("genres") or []
    if genres:
        _admin.table("genres").upsert(
            [{"id": g["id"], "name": g["name"]} for g in genres], on_conflict="id"
        ).execute()
        _admin.table("title_genres").upsert(
            [{"title_id": title_id, "genre_id": g["id"]} for g in genres],
            on_conflict="title_id,genre_id",
        ).execute()

    credits = detail.get("credits") or {}
    cast = (credits.get("cast") or [])[:15]
    directors = [c for c in (credits.get("crew") or []) if c.get("job") == "Director"]
    # The same person can appear twice (multiple roles / repeated crew entries);
    # a batched upsert can't touch a row twice, so dedupe by tmdb id.
    people = list({p["id"]: p for p in cast + directors}.values())
    if people:
        _admin.table("people").upsert(
            [{"tmdb_id": p["id"], "name": p["name"], "profile_path": p.get("profile_path")} for p in people],
            on_conflict="tmdb_id",
        ).execute()
        rows = _admin.table("people").select("id, tmdb_id").in_("tmdb_id", [p["id"] for p in people]).execute().data
        id_by_tmdb = {r["tmdb_id"]: r["id"] for r in rows}
        credit_rows = {
            (id_by_tmdb[c["id"]], "Actor"): {
                "title_id": title_id, "person_id": id_by_tmdb[c["id"]], "department": "cast",
                "job": "Actor", "role": c.get("character"), "sort_order": c.get("order")}
            for c in cast if c["id"] in id_by_tmdb
        } | {
            (id_by_tmdb[c["id"]], "Director"): {
                "title_id": title_id, "person_id": id_by_tmdb[c["id"]], "department": "crew",
                "job": "Director", "role": None, "sort_order": None}
            for c in directors if c["id"] in id_by_tmdb
        }
        if credit_rows:
            _admin.table("credits").upsert(list(credit_rows.values()), on_conflict="title_id,person_id,job").execute()

    networks = detail.get("networks") or []
    if networks:
        _admin.table("networks").upsert(
            [{"id": n["id"], "name": n["name"], "logo_path": n.get("logo_path")} for n in networks],
            on_conflict="id",
        ).execute()
        _admin.table("title_networks").upsert(
            [{"title_id": title_id, "network_id": n["id"]} for n in networks],
            on_conflict="title_id,network_id",
        ).execute()


def _upsert_title(detail: dict) -> str:
    """Upsert title + seasons into the catalog; return WatchBuddy title UUID."""
    row = {
        "tmdb_id":            detail["id"],
        "media_type":         "tv",
        "title":              detail.get("name") or detail.get("original_name"),
        "original_title":     detail.get("original_name") or None,
        "overview":           detail.get("overview") or None,
        "original_language":  detail.get("original_language") or None,
        "release_date":       detail.get("first_air_date") or None,
        "runtime":            (detail.get("episode_run_time") or [None])[0],
        "poster_path":        detail.get("poster_path") or None,
        "backdrop_path":      detail.get("backdrop_path") or None,
        "origin_country":     (detail.get("origin_country") or [None])[0],
        "tmdb_rating":        detail.get("vote_average") or None,
        "popularity":         detail.get("popularity") or None,
        "status":             detail.get("status") or None,
        "number_of_seasons":  detail.get("number_of_seasons") or None,
        "number_of_episodes": detail.get("number_of_episodes") or None,
        "cached_at":          _now(),
    }
    res = (
        _admin.table("titles")
        .upsert(row, on_conflict="tmdb_id,media_type")
        .select("id")
        .execute()
    )
    title_id: str = res.data[0]["id"]

    seasons = detail.get("seasons", [])
    if seasons:
        season_rows = [
            {
                "title_id":      title_id,
                "tmdb_id":       s.get("id"),
                "season_number": s["season_number"],
                "name":          s.get("name") or None,
                "overview":      s.get("overview") or None,
                "episode_count": s.get("episode_count") or None,
                "air_date":      s.get("air_date") or None,
                "poster_path":   s.get("poster_path") or None,
            }
            for s in seasons
        ]
        _admin.table("seasons").upsert(season_rows, on_conflict="title_id,season_number").execute()

    _upsert_metadata(title_id, detail)
    return title_id


def _cache_season(title_id: str, tmdb_id: int, season_num: int) -> dict[tuple[int, int], str]:
    """Fetch + upsert episodes for one season; return {(season, ep): uuid}."""
    season_res = (
        _admin.table("seasons")
        .select("id")
        .eq("title_id", title_id)
        .eq("season_number", season_num)
        .limit(1)
        .execute()
    )
    if not season_res.data:
        return {}
    season_id = season_res.data[0]["id"]

    episodes = _fetch_season(tmdb_id, season_num)
    if not episodes:
        return {}

    rows = [
        {
            "season_id":      season_id,
            "title_id":       title_id,
            "tmdb_id":        e.get("id"),
            "season_number":  season_num,
            "episode_number": e["episode_number"],
            "name":           e.get("name") or None,
            "overview":       e.get("overview") or None,
            "runtime":        e.get("runtime") or None,
            "air_date":       e.get("air_date") or None,
            "still_path":     e.get("still_path") or None,
        }
        for e in episodes
    ]
    res = (
        _admin.table("episodes")
        .upsert(rows, on_conflict="season_id,episode_number")
        .select("id, season_number, episode_number")
        .execute()
    )
    return {(r["season_number"], r["episode_number"]): r["id"] for r in res.data}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main(gdpr_path: Path) -> None:
    if not gdpr_path.is_dir():
        sys.exit(f"[error] Not a directory: {gdpr_path}")

    user_id: str = USER_ID
    print(f"Importing for user {user_id}")

    # --- Load CSVs ----------------------------------------------------------
    def load(name: str) -> list[dict]:
        p = gdpr_path / name
        if not p.exists():
            sys.exit(f"[error] Missing file: {p}")
        with p.open(newline="", encoding="utf-8") as f:
            return list(csv.DictReader(f))

    followed     = load("followed_tv_show.csv")
    tv_show_data = {r["tv_show_id"]: r for r in load("user_tv_show_data.csv")}
    tracking     = [
        r for r in load("tracking-prod-records-v2.csv")
        if r.get("key", "").startswith("watch-episode")
        and r.get("season_number")
        and r.get("episode_number")
    ]
    rewatches    = [
        r for r in load("rewatched_episode.csv")
        if r.get("episode_season_number") and r.get("episode_number")
    ]
    # Movies live in the older v1 tracking file (v2 has none).
    movie_rows = [
        r for r in load("tracking-prod-records.csv")
        if (r.get("entity_type") == "movie" or (r.get("movie_name") or "").strip())
        and r.get("type") in ("watch", "rewatch", "towatch")
    ]

    print(f"\nLoaded: {len(followed)} followed shows · {len(tracking)} episode watches · {len(rewatches)} rewatch records · {len(movie_rows)} movie records")

    # --- Pre-fetch existing watches for idempotency -------------------------
    print("\nFetching existing watch history…")
    existing_first:   set[str]       = set()
    existing_rewatch: dict[str, int] = defaultdict(int)
    page, PAGE = 0, 1000
    while True:
        res = (
            _admin.table("episode_watches")
            .select("episode_id, is_rewatch")
            .eq("user_id", user_id)
            .range(page * PAGE, (page + 1) * PAGE - 1)
            .execute()
        )
        for row in res.data:
            if row["is_rewatch"]:
                existing_rewatch[row["episode_id"]] += 1
            else:
                existing_first.add(row["episode_id"])
        if len(res.data) < PAGE:
            break
        page += 1
    print(f"  {len(existing_first)} first-watches · {sum(existing_rewatch.values())} rewatches already present")

    # name_key → {"tmdb_id": int, "title_id": str}
    catalog: dict[str, dict] = {}
    # (name_key, season_num) → {(season, ep): episode_uuid}
    season_cache: dict[tuple[str, int], dict[tuple[int, int], str]] = {}
    unresolved: list[dict] = []

    # Episode watches per show name — also the floor for Phase 1's status
    # inference, since nb_episodes_seen can lag the tracking file (e.g. a show
    # watched mostly as rewatches reports 0 seen).
    watch_counts: dict[str, int] = Counter(r["series_name"].lower() for r in tracking)

    # --- Phase 1: Shows → catalog + library_items ---------------------------
    print(f"\n--- Phase 1: Shows ({len(followed)}) ---")

    for show in followed:
        name    = show["tv_show_name"]
        key     = name.lower()
        tvdb_id = show["tv_show_id"]
        archived = show.get("archived", "0") == "1"
        data     = tv_show_data.get(tvdb_id, {})
        nb_seen  = max(int(data.get("nb_episodes_seen") or 0), watch_counts.get(key, 0))

        print(f"  {name}…", end=" ", flush=True)

        tmdb_result = _find_by_tvdb(tvdb_id)
        if tmdb_result:
            print("(tvdb)", end=" ", flush=True)
        else:
            tmdb_result = _search_show(name)
            if tmdb_result:
                print("(name search)", end=" ", flush=True)

        if not tmdb_result:
            print("UNRESOLVED")
            unresolved.append({"tv_show_name": name, "tvdb_id": tvdb_id, "reason": "not found on TMDB"})
            continue

        try:
            detail   = _fetch_detail(tmdb_result["id"])
            title_id = _upsert_title(detail)
        except Exception as exc:
            print(f"ERROR ({exc})")
            unresolved.append({"tv_show_name": name, "tvdb_id": tvdb_id, "reason": str(exc)})
            continue

        catalog[key] = {"tmdb_id": detail["id"], "title_id": title_id}

        status = _infer_status(archived, nb_seen, detail)
        _admin.table("library_items").upsert(
            {"user_id": user_id, "title_id": title_id, "status": status},
            on_conflict="user_id,title_id",
        ).execute()

        print(f"→ {status}")

    ok_count = len(followed) - len(unresolved)
    print(f"\n  {ok_count}/{len(followed)} shows imported · {len(unresolved)} unresolved")

    # --- Phase 2: Episode watches -------------------------------------------
    # Group by (show_name_lower, season_num) to batch season fetches
    by_season: dict[tuple[str, int], list[dict]] = defaultdict(list)
    for row in tracking:
        by_season[(row["series_name"].lower(), int(row["season_number"]))].append(row)

    print(f"\n--- Phase 2: Episode watches ({len(tracking)}) ---")
    inserted_first = skipped_first = missing_first = 0

    for (name_key, season_num), rows in by_season.items():
        # Resolve show — may not be in followed (watched without following)
        if name_key not in catalog:
            print(f"  (lookup unfollowed show: {name_key})", end=" ", flush=True)
            result = _search_show(name_key)
            if not result:
                missing_first += len(rows)
                print("not found")
                continue
            try:
                detail   = _fetch_detail(result["id"])
                title_id = _upsert_title(detail)
                catalog[name_key] = {"tmdb_id": detail["id"], "title_id": title_id}
                # Watched-but-unfollowed shows still belong in the library.
                status = _infer_status(False, watch_counts.get(name_key, 0), detail)
                _admin.table("library_items").upsert(
                    {"user_id": user_id, "title_id": title_id, "status": status},
                    on_conflict="user_id,title_id",
                ).execute()
                print("ok")
            except Exception as exc:
                print(f"error: {exc}")
                missing_first += len(rows)
                continue

        entry     = catalog[name_key]
        cache_key = (name_key, season_num)

        if cache_key not in season_cache:
            season_cache[cache_key] = _cache_season(entry["title_id"], entry["tmdb_id"], season_num)

        ep_map = season_cache[cache_key]
        batch  = []
        for row in rows:
            ep_uuid = ep_map.get((season_num, int(row["episode_number"])))
            if not ep_uuid:
                missing_first += 1
                continue
            if ep_uuid in existing_first:
                skipped_first += 1
                continue
            existing_first.add(ep_uuid)
            batch.append({
                "user_id":    user_id,
                "episode_id": ep_uuid,
                "title_id":   entry["title_id"],
                "watched_at": row["created_at"],
                "is_rewatch": False,
            })

        if batch:
            _admin.table("episode_watches").insert(batch).execute()
            inserted_first += len(batch)

    print(f"  Inserted {inserted_first} · skipped {skipped_first} (already exist) · {missing_first} unmatched")

    # --- Phase 3: Rewatches -------------------------------------------------
    print(f"\n--- Phase 3: Rewatches ({len(rewatches)}) ---")
    inserted_rw = skipped_rw = missing_rw = 0

    for row in rewatches:
        name_key   = row["tv_show_name"].lower()
        season_num = int(row["episode_season_number"])
        ep_num     = int(row["episode_number"])
        cpt        = int(row.get("cpt") or 1)
        watched_at = row["created_at"]

        if name_key not in catalog:
            missing_rw += cpt
            continue

        entry     = catalog[name_key]
        cache_key = (name_key, season_num)
        if cache_key not in season_cache:
            season_cache[cache_key] = _cache_season(entry["title_id"], entry["tmdb_id"], season_num)

        ep_uuid = season_cache[cache_key].get((season_num, ep_num))
        if not ep_uuid:
            missing_rw += cpt
            continue

        already = existing_rewatch[ep_uuid]
        to_add  = cpt - already
        if to_add <= 0:
            skipped_rw += cpt
            continue

        _admin.table("episode_watches").insert([
            {
                "user_id":    user_id,
                "episode_id": ep_uuid,
                "title_id":   entry["title_id"],
                "watched_at": watched_at,
                "is_rewatch": True,
            }
            for _ in range(to_add)
        ]).execute()
        inserted_rw             += to_add
        existing_rewatch[ep_uuid] = cpt

    print(f"  Inserted {inserted_rw} · skipped {skipped_rw} (already exist) · {missing_rw} unmatched")

    # --- Phase 4: Movies ------------------------------------------------------
    print(f"\n--- Phase 4: Movies ({len(movie_rows)}) ---")

    existing_movie: dict[str, int] = defaultdict(int)  # title_id -> watch rows
    existing_movie_at: set[tuple[str, str]] = set()    # (title_id, watched_at)
    page = 0
    while True:
        res = (
            _admin.table("movie_watches")
            .select("title_id, watched_at")
            .eq("user_id", user_id)
            .range(page * PAGE, (page + 1) * PAGE - 1)
            .execute()
        )
        for row in res.data:
            existing_movie[row["title_id"]] += 1
            existing_movie_at.add((row["title_id"], row["watched_at"][:19]))
        if len(res.data) < PAGE:
            break
        page += 1

    inserted_mov = skipped_mov = 0
    for row in movie_rows:
        name = row["movie_name"].strip()
        year = (row.get("release_date") or "")[:4]
        year = year if year.isdigit() and year != "1970" else None
        kind = row["type"]  # watch | rewatch | towatch

        result = _search_movie(name, year)
        if not result:
            unresolved.append({"tv_show_name": name, "tvdb_id": "", "reason": "movie not found on TMDB"})
            continue

        try:
            detail = _tmdb(f"/movie/{result['id']}", append_to_response="credits")
            title_row = {
                "tmdb_id":           detail["id"],
                "media_type":        "movie",
                "imdb_id":           detail.get("imdb_id") or None,
                "title":             detail.get("title") or name,
                "original_title":    detail.get("original_title") or None,
                "overview":          detail.get("overview") or None,
                "original_language": detail.get("original_language") or None,
                "release_date":      detail.get("release_date") or None,
                "runtime":           detail.get("runtime") or None,
                "poster_path":       detail.get("poster_path") or None,
                "backdrop_path":     detail.get("backdrop_path") or None,
                "tmdb_rating":       detail.get("vote_average") or None,
                "popularity":        detail.get("popularity") or None,
                "status":            detail.get("status") or None,
                "cached_at":         _now(),
            }
            res = _admin.table("titles").upsert(title_row, on_conflict="tmdb_id,media_type").execute()
            title_id = res.data[0]["id"]
            _upsert_metadata(title_id, detail)
        except Exception as exc:
            unresolved.append({"tv_show_name": name, "tvdb_id": "", "reason": str(exc)})
            continue

        if kind == "towatch":
            # Don't downgrade a movie that already has a watch on record.
            if existing_movie[title_id] == 0:
                _admin.table("library_items").upsert(
                    {"user_id": user_id, "title_id": title_id, "status": "watchlist"},
                    on_conflict="user_id,title_id",
                ).execute()
                print(f"  {name} → watchlist")
            continue

        # watch / rewatch → a dated movie_watches row + completed library entry.
        # Skip if this exact watch event (same timestamp) is already recorded,
        # or — for plain watches — if the movie has any watch row at all.
        watched_key = (title_id, row["created_at"][:19].replace(" ", "T"))
        if watched_key in existing_movie_at or (existing_movie[title_id] > 0 and kind == "watch"):
            skipped_mov += 1
            continue
        _admin.table("movie_watches").insert({
            "user_id":    user_id,
            "title_id":   title_id,
            "watched_at": row["created_at"],
            "is_rewatch": kind == "rewatch",
        }).execute()
        existing_movie[title_id] += 1
        existing_movie_at.add(watched_key)
        _admin.table("library_items").upsert(
            {"user_id": user_id, "title_id": title_id, "status": "completed"},
            on_conflict="user_id,title_id",
        ).execute()
        inserted_mov += 1
        print(f"  {name} → {'rewatch' if kind == 'rewatch' else 'watched'}")

    print(f"  Inserted {inserted_mov} movie watches · skipped {skipped_mov} (already exist)")

    # --- Phase 5: Favorites ---------------------------------------------------
    # lists-prod-lists.csv stores favorite shows as TVDB ids and favorite movies
    # as uuids that point back at rows in the v1 tracking file.
    print("\n--- Phase 5: Favorites ---")
    fav_show_tvdb: list[str] = []
    fav_movie_uuids: list[str] = []
    lists_path = gdpr_path / "lists-prod-lists.csv"
    if lists_path.exists():
        with lists_path.open(newline="", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                objs = row.get("objects") or ""
                if row.get("s_key") == "favorite-series":
                    fav_show_tvdb += re.findall(r"\bid:(\d+)", objs)
                elif row.get("s_key") == "favorite-movies":
                    fav_movie_uuids += re.findall(r"\buuid:([0-9a-f-]{36})", objs)

    name_by_uuid = {
        r["uuid"]: r["movie_name"].strip()
        for r in load("tracking-prod-records.csv")
        if r.get("uuid") and (r.get("movie_name") or "").strip()
    }

    favorited = 0
    for tvdb_id in fav_show_tvdb:
        result = _find_by_tvdb(tvdb_id)
        if not result:
            continue
        res = (
            _admin.table("titles").select("id")
            .eq("tmdb_id", result["id"]).eq("media_type", "tv").limit(1).execute()
        )
        if res.data:
            _admin.table("library_items").update({"is_favorite": True}).eq(
                "user_id", user_id).eq("title_id", res.data[0]["id"]).execute()
            favorited += 1

    for uuid in fav_movie_uuids:
        name = name_by_uuid.get(uuid)
        if not name:
            continue
        result = _search_movie(name, None)
        if not result:
            continue
        res = (
            _admin.table("titles").select("id")
            .eq("tmdb_id", result["id"]).eq("media_type", "movie").limit(1).execute()
        )
        if res.data:
            _admin.table("library_items").update({"is_favorite": True}).eq(
                "user_id", user_id).eq("title_id", res.data[0]["id"]).execute()
            favorited += 1

    print(f"  Favorited {favorited}/{len(fav_show_tvdb) + len(fav_movie_uuids)} titles")

    # --- Unresolved report --------------------------------------------------
    if unresolved:
        out = Path("unresolved_shows.csv")
        with out.open("w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=["tv_show_name", "tvdb_id", "reason"])
            w.writeheader()
            w.writerows(unresolved)
        print(f"\nWrote {len(unresolved)} unresolved shows → {out}")
        print("  For each: search TMDB manually, note the TMDB show ID, then add the show")
        print("  to WatchBuddy from the Explore screen before re-running the script.")

    # --- Summary ------------------------------------------------------------
    print("\n=== Done ===")
    print(f"  Shows:       {ok_count}/{len(followed)} imported")
    print(f"  Watches:     {inserted_first} first-watches inserted")
    print(f"  Rewatches:   {inserted_rw} rows inserted")
    if unresolved:
        print(f"  Unresolved:  {len(unresolved)} shows (see unresolved_shows.csv)")


# ---------------------------------------------------------------------------

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Import TV Time GDPR export into WatchBuddy")
    parser.add_argument(
        "--gdpr-path",
        required=True,
        type=Path,
        help="Path to the TV Time gdpr-data folder (the directory containing followed_tv_show.csv etc.)",
    )
    main(parser.parse_args().gdpr_path)
