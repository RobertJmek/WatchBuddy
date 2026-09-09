// delete-account: permanently deletes the calling user's account.
//
// The caller is identified from their JWT (verify_jwt stays on). Every user
// table references auth.users with `on delete cascade`, so removing the auth
// user drops profiles/library/watches/ratings/follows in one shot; only the
// avatar file in storage needs explicit cleanup first.

import { createClient } from 'jsr:@supabase/supabase-js@2';

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  try {
    const token = req.headers.get('Authorization')?.replace('Bearer ', '');
    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    const uid = userData?.user?.id;
    if (userErr || !uid) return json({ error: 'Not authenticated' }, 401);

    // Avatar files live under avatars/{uid}/ — storage has no cascade.
    //
    // `list` returns at most 100 entries per call and defaults to exactly that,
    // so a user who changed their avatar more than 100 times used to leave the
    // rest behind: files owned by an account that no longer exists, which
    // nothing will ever come back for. Page until the bucket stops answering.
    // Each pass deletes the page it just read, so the next page shifts down to
    // the front and there is no cursor to advance. The pass cap is a stop
    // against a `remove` that reports success without removing anything, which
    // would otherwise spin here forever.
    const PAGE = 100;
    for (let pass = 0; pass < 100; pass++) {
      const { data: files, error: listErr } = await admin.storage
        .from('avatars')
        .list(uid, { limit: PAGE });
      if (listErr) {
        // Storage cleanup must not block the deletion itself: an account the
        // user asked us to remove has to go, orphan files or not.
        console.error('avatar list failed:', listErr.message);
        break;
      }
      if (!files?.length) break;
      const { error: removeErr } = await admin.storage
        .from('avatars')
        .remove(files.map((f) => `${uid}/${f.name}`));
      if (removeErr) {
        console.error('avatar remove failed:', removeErr.message);
        break;
      }
      if (files.length < PAGE) break;
    }

    // Rate-limit buckets are keyed by uid but deliberately carry no FK (the
    // nil uuid stands in for the global buckets), so nothing cascades them.
    const { error: bucketErr } = await admin
      .from('rate_limits')
      .delete()
      .eq('subject', uid);
    if (bucketErr) console.error('rate limit cleanup failed:', bucketErr.message);

    const { error } = await admin.auth.admin.deleteUser(uid);
    if (error) {
      console.error('deleteUser failed:', error.message);
      return json({ error: 'Could not delete the account. Try again later.' }, 500);
    }

    return json({ ok: true });
  } catch (err) {
    console.error('delete-account failed:', err);
    return json({ error: 'Could not delete the account. Try again later.' }, 500);
  }
});
