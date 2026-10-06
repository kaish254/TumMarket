import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const CONTACT_AMOUNT = 2000;
const BOOST_AMOUNT = 5000;
const EXPECTED_CURRENCY = 'KES';

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;

  let result = 0;

  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return result === 0;
}

async function createPaystackSignature(
  body: string,
  secretKey: string,
): Promise<string> {
  const encoder = new TextEncoder();

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secretKey),
    {
      name: 'HMAC',
      hash: 'SHA-512',
    },
    false,
    ['sign'],
  );

  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(body),
  );

  return toHex(signature);
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders,
    });
  }

  if (request.method !== 'POST') {
    return new Response('Method not allowed.', {
      status: 405,
      headers: corsHeaders,
    });
  }

  const secretKey = Deno.env.get('PAYSTACK_SECRET_KEY');

  if (!secretKey) {
    console.error('PAYSTACK_SECRET_KEY is missing.');

    return new Response('Webhook is not configured.', {
      status: 500,
      headers: corsHeaders,
    });
  }

  const rawBody = await request.text();

  let event: any;

  try {
    event = JSON.parse(rawBody);
  } catch {
    console.error('Invalid webhook JSON.');

    return new Response('Invalid JSON.', {
      status: 400,
      headers: corsHeaders,
    });
  }

  const receivedSignature =
    request.headers.get('x-paystack-signature') ?? '';

  if (!receivedSignature) {
    console.error('Missing Paystack signature.');

    return new Response('Unauthorized.', {
      status: 401,
      headers: corsHeaders,
    });
  }

  const expectedSignature = await createPaystackSignature(
    rawBody,
    secretKey,
  );

  if (!safeEqual(receivedSignature, expectedSignature)) {
    console.error('Invalid Paystack webhook signature.');

    return new Response('Unauthorized.', {
      status: 401,
      headers: corsHeaders,
    });
  }

  if (event?.event !== 'charge.success') {
    return new Response('ok', {
      status: 200,
      headers: corsHeaders,
    });
  }

  const charge = event?.data;

  if (!charge?.reference) {
    console.error('Successful charge has no reference.');

    return new Response('ok', {
      status: 200,
      headers: corsHeaders,
    });
  }

  const reference = String(charge.reference);

  const amount = Number(charge.amount ?? 0);

  const currency = String(
    charge.currency ?? '',
  ).toUpperCase();

  if (
    currency !== EXPECTED_CURRENCY ||
    ![CONTACT_AMOUNT, BOOST_AMOUNT].includes(amount)
  ) {
    console.error(
      'Invalid payment amount/currency:',
      {
        reference,
        amount,
        currency,
      },
    );

    return new Response('ok', {
      status: 200,
      headers: corsHeaders,
    });
  }

  const projectUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey =
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!projectUrl || !serviceRoleKey) {
    console.error(
      'Supabase service configuration is missing.',
    );

    return new Response('Webhook configuration error.', {
      status: 500,
      headers: corsHeaders,
    });
  }

  const serviceClient = createClient(
    projectUrl,
    serviceRoleKey,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  );

  /*
   * KSh 50 BOOST PAYMENT
   */
  if (
    amount === BOOST_AMOUNT ||
    reference.startsWith('TUMBOOST-')
  ) {
    const { data: boostPurchase, error: boostLookupError } =
      await serviceClient
        .from('boost_purchases')
        .select(
          'id, listing_id, owner_id, payment_reference, status',
        )
        .eq('payment_reference', reference)
        .maybeSingle();

    if (boostLookupError) {
      console.error(
        'Boost purchase lookup failed:',
        boostLookupError,
      );

      return new Response('Database error.', {
        status: 500,
        headers: corsHeaders,
      });
    }

    if (!boostPurchase) {
      console.error(
        'No boost purchase found for reference:',
        reference,
      );

      return new Response('ok', {
        status: 200,
        headers: corsHeaders,
      });
    }

    if (boostPurchase.status === 'verified') {
      return new Response('ok', {
        status: 200,
        headers: corsHeaders,
      });
    }

    const paidAt =
      charge.paid_at ??
      new Date().toISOString();

    const expiresAt = new Date(
      new Date(paidAt).getTime() +
        24 * 60 * 60 * 1000,
    ).toISOString();

    const { error: boostUpdateError } =
      await serviceClient
        .from('boost_purchases')
        .update({
          status: 'verified',
          paid_at: paidAt,
          expires_at: expiresAt,
        })
        .eq('id', boostPurchase.id)
        .eq('payment_reference', reference);

    if (boostUpdateError) {
      console.error(
        'Could not verify boost purchase:',
        boostUpdateError,
      );

      return new Response(
        'Database update failed.',
        {
          status: 500,
          headers: corsHeaders,
        },
      );
    }

    const { error: listingUpdateError } =
      await serviceClient
        .from('listings')
        .update({
          boost_expires_at: expiresAt,
        })
        .eq('id', boostPurchase.listing_id)
        .eq('owner_id', boostPurchase.owner_id)
        .eq('status', 'active');

    if (listingUpdateError) {
      console.error(
        'Could not activate listing boost:',
        listingUpdateError,
      );

      return new Response(
        'Listing update failed.',
        {
          status: 500,
          headers: corsHeaders,
        },
      );
    }

    console.log(
      'Listing boost verified:',
      reference,
      'expires:',
      expiresAt,
    );

    return new Response('ok', {
      status: 200,
      headers: corsHeaders,
    });
  }

  /*
   * KSh 20 CONTACT UNLOCK PAYMENT
   */
  const { data: unlock, error: lookupError } =
    await serviceClient
      .from('contact_unlocks')
      .select(
        'id, listing_id, buyer_id, payment_reference, status',
      )
      .eq('payment_reference', reference)
      .maybeSingle();

  if (lookupError) {
    console.error(
      'Contact unlock lookup failed:',
      lookupError,
    );

    return new Response('Database error.', {
      status: 500,
      headers: corsHeaders,
    });
  }

  if (!unlock) {
    console.error(
      'No contact unlock found for reference:',
      reference,
    );

    return new Response('ok', {
      status: 200,
      headers: corsHeaders,
    });
  }

  if (unlock.status === 'verified') {
    return new Response('ok', {
      status: 200,
      headers: corsHeaders,
    });
  }

  const paidAt =
    charge.paid_at ??
    new Date().toISOString();

  const { error: updateError } =
    await serviceClient
      .from('contact_unlocks')
      .update({
        status: 'verified',
        paid_at: paidAt,
      })
      .eq('id', unlock.id)
      .eq('payment_reference', reference);

  if (updateError) {
    console.error(
      'Could not verify contact unlock:',
      updateError,
    );

    return new Response(
      'Database update failed.',
      {
        status: 500,
        headers: corsHeaders,
      },
    );
  }

  console.log(
    'Contact unlock verified:',
    reference,
  );

  return new Response('ok', {
    status: 200,
    headers: corsHeaders,
  });
});