import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed.' }, { status: 405, headers: corsHeaders });
  }

  const authorization = request.headers.get('Authorization');
  const projectUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!authorization || !projectUrl || !anonKey || !serviceRoleKey) {
    return Response.json({ error: 'Contact lookup is not configured.' }, { status: 401, headers: corsHeaders });
  }

  const token = authorization.replace(/^Bearer\s+/i, '');
  const authClient = createClient(projectUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await authClient.auth.getUser(token);
  if (authError || !authData.user) {
    return Response.json({ error: 'Sign in to access seller contact.' }, { status: 401, headers: corsHeaders });
  }

  let listingId: string;
  try {
    const body = await request.json();
    listingId = body.listingId;
    if (typeof listingId !== 'string' || !/^[0-9a-f-]{36}$/i.test(listingId)) throw new Error('Invalid listing id.');
  } catch {
    return Response.json({ error: 'A valid listing id is required.' }, { status: 400, headers: corsHeaders });
  }

  const serviceClient = createClient(projectUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: listing, error: listingError } = await serviceClient
    .from('listings')
    .select('owner_id, status')
    .eq('id', listingId)
    .maybeSingle();
  if (listingError || !listing || listing.status !== 'active') {
    return Response.json({ error: 'Listing is unavailable.' }, { status: 404, headers: corsHeaders });
  }

  if (listing.owner_id !== authData.user.id) {
    const { data: unlock, error: unlockError } = await serviceClient
      .from('contact_unlocks')
      .select('id')
      .eq('listing_id', listingId)
      .eq('buyer_id', authData.user.id)
      .eq('status', 'verified')
      .maybeSingle();
    if (unlockError || !unlock) {
      return Response.json({ error: 'A verified contact unlock is required.' }, { status: 402, headers: corsHeaders });
    }
  }

  const { data: contact, error: contactError } = await serviceClient
    .from('listing_contacts')
    .select('phone')
    .eq('listing_id', listingId)
    .maybeSingle();
  if (contactError || !contact) {
    return Response.json({ error: 'Seller contact is unavailable.' }, { status: 404, headers: corsHeaders });
  }

  return Response.json({ phone: contact.phone }, { headers: corsHeaders });
});
