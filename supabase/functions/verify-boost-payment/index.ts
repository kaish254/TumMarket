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

    const authHeader =
      request.headers.get('Authorization');

    if (!authHeader) {
      return json(
        { error: 'Authentication required.' },
        401,
      );
    }

    const token = authHeader.replace('Bearer ', '');

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(token);

    if (userError || !user) {
      return json(
        { error: 'Authentication required.' },
        401,
      );
    }

    const body = await request.json();

    const listingId = body?.listingId;
    const reference = body?.reference;

    if (
      typeof listingId !== 'string' ||
      !listingId.trim()
    ) {
      return json(
        { error: 'A listing is required.' },
        400,
      );
    }

    if (
      typeof reference !== 'string' ||
      !reference.trim()
    ) {
      return json(
        { error: 'A payment reference is required.' },
        400,
      );
    }

    const { data: purchase, error: purchaseError } =
      await admin
        .from('boost_purchases')
        .select(
          'id, listing_id, owner_id, payment_reference, status',
        )
        .eq('listing_id', listingId)
        .eq('owner_id', user.id)
        .eq('payment_reference', reference)
        .maybeSingle();

    if (purchaseError) {
      console.error(purchaseError);

      return json(
        { error: 'Could not load the boost payment.' },
        500,
      );
    }

    if (!purchase) {
      return json(
        { error: 'Boost payment not found.' },
        404,
      );
    }

    if (purchase.status === 'verified') {
      return json({
        verified: true,
        status: 'success',
        message: 'Boost payment already verified.',
      });
    }

    const paystackResponse = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
        },
      },
    );

    const paystackData =
      await paystackResponse.json();

    if (!paystackResponse.ok) {
      console.error(
        'Paystack boost verification failed:',
        paystackData,
      );

      return json({
        verified: false,
        status: 'pending',
        error:
          paystackData?.message ||
          'Payment is still being confirmed.',
      });
    }

    const transaction = paystackData?.data;

    const isSuccessful =
      paystackData?.status === true &&
      transaction?.status === 'success' &&
      transaction?.reference === reference &&
      Number(transaction?.amount) === 5000 &&
      transaction?.currency === 'KES';

    if (!isSuccessful) {
      const transactionStatus =
        transaction?.status || 'pending';

      if (
        transactionStatus === 'failed' ||
        transactionStatus === 'abandoned'
      ) {
        await admin
          .from('boost_purchases')
          .update({
            status: 'failed',
          })
          .eq('id', purchase.id);

        return json({
          verified: false,
          status: transactionStatus,
          error:
            'The KSh 50 boost payment was not completed.',
        });
      }

      return json({
        verified: false,
        status: transactionStatus,
        message:
          'The KSh 50 payment is still being confirmed.',
      });
    }

    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + 24 * 60 * 60 * 1000,
    );

    const { error: purchaseUpdateError } =
      await admin
        .from('boost_purchases')
        .update({
          status: 'verified',
          paid_at: now.toISOString(),
          expires_at: expiresAt.toISOString(),
        })
        .eq('id', purchase.id);

    if (purchaseUpdateError) {
      console.error(
        'Could not update boost purchase:',
        purchaseUpdateError,
      );

      return json(
        {
          error:
            'Payment was received but the boost could not be activated yet.',
        },
        500,
      );
    }

    const { error: listingUpdateError } =
      await admin
        .from('listings')
        .update({
          boost_expires_at:
            expiresAt.toISOString(),
        })
        .eq('id', listingId)
        .eq('status', 'active');

    if (listingUpdateError) {
      console.error(
        'Could not activate listing boost:',
        listingUpdateError,
      );

      return json(
        {
          error:
            'Payment was received but the listing boost could not be activated.',
        },
        500,
      );
    }

    return json({
      verified: true,
      status: 'success',
      message:
        'Payment verified. Your listing is boosted for 24 hours.',
      expiresAt: expiresAt.toISOString(),
    });
  } catch (error) {
    console.error(
      'Verify boost payment error:',
      error,
    );

    return json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Could not verify the boost payment.',
      },
      500,
    );
  }
});