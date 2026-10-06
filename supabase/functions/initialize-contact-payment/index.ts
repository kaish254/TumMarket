import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const CONTACT_PRICE_KES = 20;
const CONTACT_PRICE_SUBUNIT = 2000;

function normalizeKenyanPhone(value: unknown): string | null {
  if (typeof value !== 'string') return null;

  const digits = value.replace(/\D/g, '');

  if (/^07\d{8}$/.test(digits)) {
    return `254${digits.slice(1)}`;
  }

  if (/^01\d{8}$/.test(digits)) {
    return `254${digits.slice(1)}`;
  }

  if (/^254[17]\d{8}$/.test(digits)) {
    return digits;
  }

  return null;
}

function createPaymentReference(): string {
  const random = crypto
    .randomUUID()
    .replace(/-/g, '')
    .slice(0, 18);

  return `tm_contact_${Date.now()}_${random}`;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders,
    });
  }

  if (request.method !== 'POST') {
    return Response.json(
      { error: 'Method not allowed.' },
      {
        status: 405,
        headers: corsHeaders,
      },
    );
  }

  const authorization = request.headers.get('Authorization');

  const projectUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get(
    'SUPABASE_SERVICE_ROLE_KEY',
  );
  const paystackSecretKey = Deno.env.get(
    'PAYSTACK_SECRET_KEY',
  );

  if (
    !authorization ||
    !projectUrl ||
    !anonKey ||
    !serviceRoleKey ||
    !paystackSecretKey
  ) {
    return Response.json(
      {
        error: 'Payment service is not configured.',
      },
      {
        status: 500,
        headers: corsHeaders,
      },
    );
  }

  const token = authorization.replace(
    /^Bearer\s+/i,
    '',
  );

  const authClient = createClient(
    projectUrl,
    anonKey,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  );

  const {
    data: authData,
    error: authError,
  } = await authClient.auth.getUser(token);

  if (authError || !authData.user) {
    return Response.json(
      {
        error:
          'Sign in before purchasing a contact unlock.',
      },
      {
        status: 401,
        headers: corsHeaders,
      },
    );
  }

  let listingId: string;
  let phone: string;

  try {
    const body = await request.json();

    listingId = body?.listingId;
    phone = body?.phone;

    if (
      typeof listingId !== 'string' ||
      !/^[0-9a-f-]{36}$/i.test(listingId)
    ) {
      throw new Error('Invalid listing id.');
    }

    const normalizedPhone =
      normalizeKenyanPhone(phone);

    if (!normalizedPhone) {
      throw new Error(
        'Enter a valid Kenyan M-PESA number, for example 0712345678.',
      );
    }

    phone = normalizedPhone;
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Invalid payment details.',
      },
      {
        status: 400,
        headers: corsHeaders,
      },
    );
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

  const userId = authData.user.id;

  // ---------------------------------------------------------
  // 1. Check that the listing exists and is available
  // ---------------------------------------------------------

  const {
    data: listing,
    error: listingError,
  } = await serviceClient
    .from('listings')
    .select(
      'id, owner_id, title, status',
    )
    .eq('id', listingId)
    .maybeSingle();

  if (
    listingError ||
    !listing ||
    listing.status !== 'active'
  ) {
    console.error(
      'Listing lookup failed:',
      listingError,
    );

    return Response.json(
      {
        error: 'Listing is unavailable.',
      },
      {
        status: 404,
        headers: corsHeaders,
      },
    );
  }

  // ---------------------------------------------------------
  // 2. Prevent seller from unlocking their own contact
  // ---------------------------------------------------------

  if (listing.owner_id === userId) {
    return Response.json(
      {
        error:
          'You cannot pay to unlock your own listing.',
      },
      {
        status: 400,
        headers: corsHeaders,
      },
    );
  }

  // ---------------------------------------------------------
  // 3. Check for an existing unlock
  // ---------------------------------------------------------

  const {
    data: existingUnlock,
    error: existingError,
  } = await serviceClient
    .from('contact_unlocks')
    .select(
      'id, status, payment_reference',
    )
    .eq('listing_id', listingId)
    .eq('buyer_id', userId)
    .maybeSingle();

  if (existingError) {
    console.error(
      'Existing unlock lookup failed:',
      existingError,
    );

    return Response.json(
      {
        error:
          'Could not check your payment status.',
      },
      {
        status: 500,
        headers: corsHeaders,
      },
    );
  }

  if (existingUnlock?.status === 'verified') {
    return Response.json(
      {
        alreadyUnlocked: true,
        reference:
          existingUnlock.payment_reference,
        message:
          'This contact is already unlocked.',
      },
      {
        status: 200,
        headers: corsHeaders,
      },
    );
  }

  if (existingUnlock?.status === 'pending') {
    return Response.json(
      {
        reference:
          existingUnlock.payment_reference,
        status: 'pending',
        customerMessage:
          'Checking your existing payment. If you already approved the M-PESA prompt, confirmation may take a little longer.',
        amountKes:
          CONTACT_PRICE_KES,
      },
      {
        status: 200,
        headers: corsHeaders,
      },
    );
  }

  // ---------------------------------------------------------
  // 4. Create a payment reference
  // ---------------------------------------------------------

  const reference =
    createPaymentReference();

  const email =
    typeof authData.user.email === 'string' &&
    authData.user.email.includes('@')
      ? authData.user.email
          .trim()
          .toLowerCase()
      : `customer-${userId}@tum-market.app`;

  let paymentRecordId: string;

  // ---------------------------------------------------------
  // 5. CREATE DATABASE RECORD BEFORE CHARGING USER
  // ---------------------------------------------------------

  try {
    if (existingUnlock) {
      const {
        data: updatedPayment,
        error: updateError,
      } = await serviceClient
        .from('contact_unlocks')
        .update({
          payment_reference: reference,
          status: 'pending',
        })
        .eq('id', existingUnlock.id)
        .select('id')
        .single();

      if (
        updateError ||
        !updatedPayment
      ) {
        console.error(
          'Could not reset existing contact payment:',
          updateError,
        );

        return Response.json(
          {
            error:
              'Could not prepare the payment request.',
          },
          {
            status: 500,
            headers: corsHeaders,
          },
        );
      }

      paymentRecordId =
        updatedPayment.id;
    } else {
      const {
        data: newPayment,
        error: insertError,
      } = await serviceClient
        .from('contact_unlocks')
        .insert({
          listing_id: listingId,
          buyer_id: userId,
          payment_reference: reference,
          status: 'pending',
        })
        .select('id')
        .single();

      if (
        insertError ||
        !newPayment
      ) {
        console.error(
          'Could not create contact payment:',
          insertError,
        );

        return Response.json(
          {
            error:
              'Could not prepare the payment request.',
          },
          {
            status: 500,
            headers: corsHeaders,
          },
        );
      }

      paymentRecordId =
        newPayment.id;
    }
  } catch (error) {
    console.error(
      'Payment record creation failed:',
      error,
    );

    return Response.json(
      {
        error:
          'Could not prepare the payment request.',
      },
      {
        status: 500,
        headers: corsHeaders,
      },
    );
  }

  // ---------------------------------------------------------
  // 6. Start Paystack M-PESA payment
  // ---------------------------------------------------------

  try {
    const paystackResponse =
      await fetch(
        'https://api.paystack.co/charge',
        {
          method: 'POST',

          headers: {
            Authorization:
              `Bearer ${paystackSecretKey}`,
            'Content-Type':
              'application/json',
          },

          body: JSON.stringify({
            email,

            amount:
              CONTACT_PRICE_SUBUNIT,

            currency: 'KES',

            reference,

            mobile_money: {
              phone: `+${phone}`,
              provider: 'mpesa',
            },

            metadata: {
              product:
                'TUMMarket contact unlock',

              listing_id:
                listingId,

              buyer_id:
                userId,

              amount_kes:
                CONTACT_PRICE_KES,
            },
          }),

          signal:
            AbortSignal.timeout(
              20_000,
            ),
        },
      );

    const result =
      await paystackResponse.json();

    // -------------------------------------------------------
    // 7. Paystack rejected the payment
    // -------------------------------------------------------

    if (
      !paystackResponse.ok ||
      !result.status ||
      !result.data?.reference
    ) {
      console.error(
        'Paystack charge rejected:',
        result.message ??
          paystackResponse.status,
      );

      await serviceClient
        .from('contact_unlocks')
        .update({
          status: 'failed',
        })
        .eq(
          'id',
          paymentRecordId,
        );

      return Response.json(
        {
          error: `Paystack: ${
            result.message ??
            `HTTP ${paystackResponse.status}`
          }`,
        },
        {
          status: 502,
          headers: corsHeaders,
        },
      );
    }

    const paystackReference =
      result.data.reference;

    // -------------------------------------------------------
    // 8. Keep Paystack reference synchronized
    // -------------------------------------------------------

    if (
      paystackReference !== reference
    ) {
      const {
        error:
          referenceUpdateError,
      } = await serviceClient
        .from('contact_unlocks')
        .update({
          payment_reference:
            paystackReference,
        })
        .eq(
          'id',
          paymentRecordId,
        );

      if (referenceUpdateError) {
        console.error(
          'Could not update payment reference:',
          referenceUpdateError,
        );

        // Do NOT attempt another charge.
        return Response.json(
          {
            error:
              'Could not save the payment reference.',
          },
          {
            status: 500,
            headers: corsHeaders,
          },
        );
      }
    }

    // -------------------------------------------------------
    // 9. Return payment information to frontend
    // -------------------------------------------------------

    return Response.json(
      {
        reference:
          paystackReference,

        status:
          result.data.status ??
          'pending',

        customerMessage:
          result.data.display_text ??
          'Check your phone and approve the KSh 20 M-PESA payment.',

        amountKes:
          CONTACT_PRICE_KES,
      },
      {
        status: 202,
        headers: corsHeaders,
      },
    );
  } catch (error) {
    console.error(
      'Paystack charge failed:',
      error instanceof Error
        ? error.message
        : error,
    );

    // The database record remains pending so we
    // don't accidentally create another charge.
    return Response.json(
      {
        error:
          'Payment service is temporarily unavailable.',
      },
      {
        status: 502,
        headers: corsHeaders,
      },
    );
  }
});