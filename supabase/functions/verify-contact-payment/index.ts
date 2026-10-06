import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const EXPECTED_AMOUNT = 2000;
const EXPECTED_CURRENCY = 'KES';

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return Response.json(
      { error: 'Method not allowed.' },
      { status: 405, headers: corsHeaders },
    );
  }

  const authorization = request.headers.get('Authorization');

  const projectUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const paystackSecretKey = Deno.env.get('PAYSTACK_SECRET_KEY');

  if (
    !authorization ||
    !projectUrl ||
    !anonKey ||
    !serviceRoleKey ||
    !paystackSecretKey
  ) {
    return Response.json(
      { error: 'Payment verification is not configured.' },
      { status: 500, headers: corsHeaders },
    );
  }

  const token = authorization.replace(/^Bearer\s+/i, '');

  const authClient = createClient(projectUrl, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const { data: authData, error: authError } =
    await authClient.auth.getUser(token);

  if (authError || !authData.user) {
    return Response.json(
      { error: 'Sign in to verify this payment.' },
      { status: 401, headers: corsHeaders },
    );
  }

  let reference: string;
  let listingId: string;

  try {
    const body = await request.json();

    reference = body?.reference;
    listingId = body?.listingId;

    if (
      typeof reference !== 'string' ||
      reference.length < 5 ||
      reference.length > 100
    ) {
      throw new Error('Invalid payment reference.');
    }

    if (
      typeof listingId !== 'string' ||
      !/^[0-9a-f-]{36}$/i.test(listingId)
    ) {
      throw new Error('Invalid listing id.');
    }
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Invalid verification details.',
      },
      { status: 400, headers: corsHeaders },
    );
  }

  const serviceClient = createClient(projectUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const userId = authData.user.id;

  const { data: unlock, error: unlockError } =
    await serviceClient
      .from('contact_unlocks')
      .select(
        'id, listing_id, buyer_id, payment_reference, status, paid_at',
      )
      .eq('payment_reference', reference)
      .eq('listing_id', listingId)
      .eq('buyer_id', userId)
      .maybeSingle();

  if (unlockError) {
    console.error('Unlock lookup failed:', unlockError);

    return Response.json(
      { error: 'Could not find this payment.' },
      { status: 500, headers: corsHeaders },
    );
  }

  if (!unlock) {
    return Response.json(
      { error: 'Payment record not found.' },
      { status: 404, headers: corsHeaders },
    );
  }

  if (unlock.status === 'verified') {
    return Response.json(
      {
        verified: true,
        status: 'success',
      },
      { status: 200, headers: corsHeaders },
    );
  }

  try {
    const verifyResponse = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${paystackSecretKey}`,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(20_000),
      },
    );

    const result = await verifyResponse.json();

    if (!verifyResponse.ok || !result.status || !result.data) {
      console.error(
        'Paystack verification rejected:',
        result.message ?? verifyResponse.status,
      );

      return Response.json(
        {
          verified: false,
          status: 'pending',
          error:
            result.message ??
            'Paystack could not verify this transaction yet.',
        },
        {
          status: 200,
          headers: corsHeaders,
        },
      );
    }

    const transaction = result.data;

    const transactionReference = String(
      transaction.reference ?? '',
    );

    const transactionStatus = String(
      transaction.status ?? '',
    ).toLowerCase();

    const transactionCurrency = String(
      transaction.currency ?? '',
    ).toUpperCase();

    const transactionAmount = Number(
      transaction.amount ?? 0,
    );

    if (transactionReference !== reference) {
      console.error('Payment reference mismatch.');

      return Response.json(
        {
          verified: false,
          status: 'failed',
          error: 'Payment reference mismatch.',
        },
        { status: 200, headers: corsHeaders },
      );
    }

    if (
      transactionStatus !== 'success' ||
      transactionAmount !== EXPECTED_AMOUNT ||
      transactionCurrency !== EXPECTED_CURRENCY
    ) {
      if (
        transactionStatus === 'failed' ||
        transactionStatus === 'abandoned'
      ) {
        await serviceClient
          .from('contact_unlocks')
          .update({
            status: 'failed',
          })
          .eq('id', unlock.id)
          .eq('buyer_id', userId);

        return Response.json(
          {
            verified: false,
            status: 'failed',
            error:
              'The KSh 20 payment was not completed.',
          },
          { status: 200, headers: corsHeaders },
        );
      }

      return Response.json(
        {
          verified: false,
          status: transactionStatus || 'pending',
          message:
            'Payment is still waiting for confirmation. Approve the M-PESA prompt and try again.',
        },
        { status: 200, headers: corsHeaders },
      );
    }

    const paidAt =
      transaction.paid_at ??
      new Date().toISOString();

    const { error: updateError } =
      await serviceClient
        .from('contact_unlocks')
        .update({
          status: 'verified',
          paid_at: paidAt,
        })
        .eq('id', unlock.id)
        .eq('buyer_id', userId);

    if (updateError) {
      console.error(
        'Could not mark unlock verified:',
        updateError,
      );

      return Response.json(
        {
          verified: false,
          status: 'pending',
          error:
            'Payment was confirmed, but the unlock could not be completed yet.',
        },
        { status: 500, headers: corsHeaders },
      );
    }

    return Response.json(
      {
        verified: true,
        status: 'success',
        message: 'Payment verified successfully.',
      },
      { status: 200, headers: corsHeaders },
    );
  } catch (error) {
    console.error(
      'Payment verification failed:',
      error instanceof Error ? error.message : error,
    );

    return Response.json(
      {
        verified: false,
        status: 'pending',
        error:
          'Payment verification is temporarily unavailable.',
      },
      { status: 502, headers: corsHeaders },
    );
  }
});