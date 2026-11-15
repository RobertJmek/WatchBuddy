-- 0026: avatars can only be what the app makes them.
--
-- Three findings from the 2026-11-15 security review, all reachable with a
-- signed-in account and the public key:
--
--   1. `profiles.avatar_url` took any URL. The owner could point it at a server
--      of their own, and every device that drew their avatar (feed, reviews,
--      follower lists) then told that server its IP address and when it looked.
--   2. The `avatars` bucket accepted any file type, so it worked as free public
--      hosting for pages, scripts or video on the project's domain.
--   3. The bucket's read policy had no role and no folder, so anyone holding the
--      public key could list every folder in it -- one per user id.
--
-- Backward compatible. Every build since the first has done exactly two things
-- with storage: `upload('<own id>/avatar.<ext>', …, { upsert: true })` with the
-- picker's `image/…` content type, and `getPublicUrl` on that path, stored with
-- a `?t=` suffix. All three are still accepted. Nothing lists the bucket, and
-- avatars are drawn from the public URL, which does not go through a policy.
-- Existing rows are not touched: the check runs only when the value changes.

-- ---------------------------------------------------------------------------
-- 1. avatar_url: the caller's own folder in this project's avatars bucket
-- ---------------------------------------------------------------------------
-- 0021's function verbatim, plus the avatar_url block.
--
-- The project URL is read from the token rather than written here: a session
-- token's `iss` is `<project url>/auth/v1`, signed by the auth server, so the
-- same migration is right for any project it is applied to. A caller with no
-- such token (the Dashboard, the service role, a migration) is not checked.
create or replace function public.enforce_profile_limits()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_iss text;
begin
  if new.username is distinct from old.username
     and new.username is not null
     and new.username !~ '^[a-z0-9_]{3,20}$' then
    raise exception 'username must be 3-20 characters: a-z, 0-9 or _'
      using errcode = '23514';
  end if;
  if new.display_name is distinct from old.display_name
     and char_length(new.display_name) > 40 then
    raise exception 'display_name is longer than 40 characters' using errcode = '23514';
  end if;
  if new.bio is distinct from old.bio
     and char_length(new.bio) > 160 then
    raise exception 'bio is longer than 160 characters' using errcode = '23514';
  end if;
  -- Null and '' both mean "no avatar" to the app.
  if new.avatar_url is distinct from old.avatar_url and new.avatar_url <> '' then
    v_iss := auth.jwt() ->> 'iss';
    if v_iss ~ '^https?://.+/auth/v1$'
       and not starts_with(
         new.avatar_url,
         left(v_iss, length(v_iss) - length('/auth/v1'))
           || '/storage/v1/object/public/avatars/' || new.id || '/'
       ) then
      raise exception 'avatar_url must point at your own avatar' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. The bucket takes images only
-- ---------------------------------------------------------------------------
-- No size limit yet: builds before 1.25.3 upload the photo as picked, uncropped,
-- so a limit small enough to matter would refuse them. Add one (the crop screen
-- writes well under 1 MB) once those builds are out of use.
update storage.buckets
   set allowed_mime_types = array['image/*']
 where id = 'avatars';

-- ---------------------------------------------------------------------------
-- 3. Only the owner can list or read an avatar through the API
-- ---------------------------------------------------------------------------
-- A public bucket serves `/object/public/…` without consulting a policy, so
-- this does not change who can see an avatar. The owner keeps SELECT on their
-- own folder because an upsert upload needs it to find the file it replaces.
drop policy "Avatar images are publicly readable" on storage.objects;

create policy "Users can read their own avatar files"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
