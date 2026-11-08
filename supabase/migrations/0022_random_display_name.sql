-- 0022: a new account's display name is never its email address.
--
-- handle_new_user fell back to the email when the provider sent no name, which
-- is every email-code sign-up and every Sign in with Apple (the ID token carries
-- no name). Profiles are readable by any signed-in user and searchable by
-- display name, so that published the address.
--
-- Now: the provider's name if it sent one, otherwise a random movie-flavoured
-- name ("Sleepy Usher 512") the user can replace in onboarding or Edit Profile.
-- Existing profiles whose display name is still exactly their email get one too;
-- a name the user typed is never touched.
--
-- Backward compatible: no column or shape changes, so every installed build
-- reads the new rows as before.

create or replace function public.random_display_name()
returns text
language sql
volatile -- one draw per call, so a multi-row UPDATE gets a different name per row
set search_path = public
as $$
  select a[1 + floor(random() * array_length(a, 1))::int]
      || ' ' || n[1 + floor(random() * array_length(n, 1))::int]
      || ' ' || (100 + floor(random() * 900))::int
  from (select
    array['Sleepy', 'Curious', 'Brave', 'Quiet', 'Lucky', 'Midnight', 'Golden',
          'Restless', 'Gentle', 'Wandering', 'Cosmic', 'Witty', 'Silent', 'Bold',
          'Dreamy', 'Clever'] as a,
    array['Usher', 'Critic', 'Director', 'Popcorn', 'Projector', 'Reel', 'Ticket',
          'Extra', 'Stuntman', 'Screenwriter', 'Cinephile', 'Binger', 'Lens',
          'Clapper', 'Matinee', 'Encore'] as n
  ) lists;
$$;

-- Server-only: nothing in the app calls it. Revoke by role name -- Supabase's
-- default privileges grant anon/authenticated an explicit EXECUTE that
-- `revoke ... from public` would leave in place (see 0019).
revoke execute on function public.random_display_name() from public, anon, authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  provided text := nullif(btrim(new.raw_user_meta_data ->> 'name'), '');
begin
  -- A provider "name" that is just the email would leak it all the same.
  if provided is not null and lower(provided) = lower(new.email) then
    provided := null;
  end if;
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(provided, public.random_display_name()))
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Existing profiles still carrying the old fallback.
update public.profiles p
set display_name = public.random_display_name()
from auth.users u
where u.id = p.id
  and u.email is not null
  and lower(btrim(p.display_name)) = lower(u.email);
