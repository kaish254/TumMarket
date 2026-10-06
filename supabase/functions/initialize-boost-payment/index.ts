import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const PAYSTACK_SECRET_KEY = Deno.env.get('PAYSTACK_SECRET_KEY');

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const supabase = createClient(
  supabaseUrl,
  supabaseAnonKey,
);

const admin = createClient(
  supabaseUrl,
  serviceRoleKey,
);

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}

function normalizeKenyanPhone(phone: string): string {
  const value = phone.trim().replace(/\s+/g, '');

  if (value.startsWith('+254')) {
    return value;
  }

  if (value.startsWith('254')) {
    return `+${value}`;
  }

  if (value.startsWith('0')) {
    return `+254${value.slice(1)}`;
  }

  throw new Error('Enter a valid Kenyan M-PESA number.');
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders,
    });
  }

  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed.' }, 405);
  }

  try {
    if (!PAYSTACK_SECRET_KEY) {
      return json(
        { error: 'Payment service is not configured.' },
        500,
      );
    }

    const authHeader = request.headers.get('Authorization');

if (!authHeader) {
  return json({ error: 'Authentication required.' }, 401);
}

const token = authHeader.startsWith('Bearer ')
  ? authHeader.substring(7)
  : authHeader;

const {
  data: { user },
  error: userError,
} = await admin.auth.getUser(token);

if (userError || !user) {
  console.error('Auth error:', userError?.message);

  return json(
    { error: 'Authentication required.' },
    401,
  );
}

    const body = await request.json();

    const listingId = body?.listingId;
    const phone = body?.phone;

    if (
      typeof listingId !== 'string' ||
      !listingId.trim()
    ) {
      return json({ error: 'A listing is required.' }, 400);
    }

    if (
      typeof phone !== 'string' ||
      !phone.trim()
    ) {
      return json(
        { error: 'An M-PESA phone number is required.' },
        400,
      );
    }

    const { data: listing, error: listingError } =
      await admin
        .from('listings')
        .select(
          'id, owner_id, title, status, boost_expires_at',
        )
        .eq('id', listingId)
        .maybeSingle();

    if (listingError) {
      console.error(listingError);

      return json(
        { error: 'Could not load the listing.' },
        500,
      );
    }

    if (!listing) {
      return json(
        { error: 'Listing not found.' },
        404,
      );
    }

    if (listing.status !== 'active') {
      return json(
        { error: 'This listing is not active.' },
        400,
      );
    }

    if (listing.owner_id !== user.id) {
  return json(
    { error: 'Only the listing owner can boost this listing.' },
    403,
  );
}

    if (
      listing.boost_expires_at &&
      new Date(listing.boost_expires_at).getTime() >
        Date.now()
    ) {
      return json({
        alreadyBoosted: true,
        expiresAt: listing.boost_expires_at,
      });
    }

    const { data: existingPending } = await admin
      .from('boost_purchases')
      .select(
        'payment_reference, status',
      )
      .eq('listing_id', listingId)
      .eq('owner_id', user.id)
      .eq('status', 'pending')
      .maybeSingle();

    if (existingPending) {
      return json({
        reference: existingPending.payment_reference,
        status: 'pending',
        customerMessage:
          'A boost payment is already waiting for confirmation.',
        amountKes: 50,
      });
    }

    const mpesaPhone = normalizeKenyanPhone(phone);

    const reference =
      `TUMBOOST-${listingId.slice(0, 8)}-${Date.now()}`;

    const { data: profile } = await admin
      .from('profiles')
      .select('display_name')
      .eq('id', user.id)
      .maybeSingle();

    const email =
      user.email ||
      `${user.id}@tum-market.local`;
    console.log('ABOUT TO CALL PAYSTACK');
    const paystackResponse = await fetch(
      'https://api.paystack.co/charge',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email,
          amount: 5000,
          currency: 'KES',
          reference,
          mobile_money: {
            phone: mpesaPhone,
            provider: 'mpesa',
          },
          metadata: {
            product: 'TUMMarket listing boost',
            listing_id: listingId,
            buyer_id: user.id,
            amount_kes: 50,
            duration_hours: 24,
            display_name:
              profile?.display_name || '',
          },
        }),
      },
    );

    const paystackData =
      await paystackResponse.json();
    console.log('PAYSTACK RESPONSE:', {
  httpStatus: paystackResponse.status,
  ok: paystackResponse.ok,
  status: paystackData?.status,
  message: paystackData?.message,
});
    if (
      !paystackResponse.ok ||
      !paystackData?.status
    ) {
      console.error(
        'Paystack boost initialization failed:',
        paystackData,
      );

      return json(
        {
          error:
            paystackData?.message ||
            'Could not start the M-PESA payment.',
        },
        400,
      );
    }

    const { error: insertError } = await admin
      .from('boost_purchases')
      .insert({
        listing_id: listingId,
        owner_id: user.id,
        payment_reference: reference,
        status: 'pending',
      });

    if (insertError) {
      console.error(
        'Could not save boost purchase:',
        insertError,
      );

      return json(
        {
          error:
            'Payment started but could not be recorded. Please contact support before trying again.',
        },
        500,
      );
    }

    return json({
      reference,
      status:
        paystackData?.data?.status ||
        'pending',
      customerMessage:
        paystackData?.message ||
        'Check your phone and approve the KSh 50 M-PESA payment.',
      amountKes: 50,
    });
  } catch (error) {
    console.error(
      'Initialize boost payment error:',
      error,
    );

    return json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Could not start the boost payment.',
      },
      500,
    );
  }
});