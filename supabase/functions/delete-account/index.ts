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
    const { data: files } = await admin.storage.from('avatars').list(uid);
    if (files?.length) {
      await admin.storage
        .from('avatars')
        .remove(files.map((f) => `${uid}/${f.name}`));
    }

    const { error } = await admin.auth.admin.deleteUser(uid);
    if (error) return json({ error: error.message }, 500);

    return json({ ok: true });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
