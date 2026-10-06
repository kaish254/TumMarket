
import { supabase } from './supabase';
import type { User } from '@supabase/supabase-js';

export type Category =
  | 'Buy & sell'
  | 'Houses'
  | 'Vacancies'
  | 'Gigs'
  | 'Services';

export type ListingRecord = {
  id: string;
  title: string;
  price: number;
  unit?: string;
  category: Category;
  location: string;
  image: string;
  posted: string;
  seller: string;
  phone: string;
  description: string;
  verified: boolean;
  boosted: boolean;
  boostExpiresAt?: string;
  status: 'pending' | 'active' | 'rejected' | 'removed';
};

export type ListingDraft = {
  title: string;
  price: number;
  unit?: string;
  category: Category;
  location: string;
  description: string;
  phone: string;
  imageFile?: File;
};

const timeAgo = (value: string) => {
  const minutes = Math.max(
    1,
    Math.floor(
      (Date.now() - new Date(value).getTime()) / 60000,
    ),
  );

  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.floor(minutes / 60);

  if (hours < 24) {
    return `${hours} hr${hours === 1 ? '' : 's'} ago`;
  }

  const days = Math.floor(hours / 24);

  return `${days} day${days === 1 ? '' : 's'} ago`;
};

export async function fetchListings(
  user?: User | null,
): Promise<ListingRecord[]> {
  if (!supabase) return [];

  let query = supabase
    .from('listings')
    .select(
      'id, owner_id, title, price, unit, category, location, description, image_urls, status, boost_expires_at, created_at',
    )
    .order('created_at', { ascending: false });

  if (user) {
    query = query.or(
      `status.eq.active,owner_id.eq.${user.id}`,
    );
  } else {
    query = query.eq('status', 'active');
  }

  const { data, error } = await query;

  if (error) throw error;
  if (!data?.length) return [];

  const ownerIds = [
    ...new Set(
      data.map((listing) => listing.owner_id),
    ),
  ];

  const {
    data: profiles,
    error: profileError,
  } = await supabase
    .from('profiles')
    .select(
      'id, display_name, is_tum_verified',
    )
    .in('id', ownerIds);

  if (profileError) throw profileError;

  const profileById = new Map(
    profiles?.map((profile) => [
      profile.id,
      profile,
    ]),
  );

  return data.map((listing) => {
    const profile = profileById.get(
      listing.owner_id,
    );

    return {
      id: listing.id,
      title: listing.title,
      price: listing.price,
      unit: listing.unit ?? undefined,
      category: listing.category as Category,
      location: listing.location,
      image:
        listing.image_urls?.[0] ||
        'https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=800&q=82',
      posted: timeAgo(listing.created_at),
      seller:
        profile?.display_name ?? 'TUM student',
      phone: '',
      description: listing.description,
      verified: Boolean(
        profile?.is_tum_verified,
      ),
      boosted: Boolean(
        listing.boost_expires_at &&
          new Date(
            listing.boost_expires_at,
          ).getTime() > Date.now(),
      ),
      boostExpiresAt:
        listing.boost_expires_at ?? undefined,
      status:
        listing.status as ListingRecord['status'],
    };
  });
}

export async function createListing(
  user: User,
  draft: ListingDraft,
): Promise<string> {
  if (!supabase) {
    throw new Error(
      'Supabase is not configured.',
    );
  }

  const imageUrls: string[] = [];

  if (draft.imageFile) {
    if (
      ![
        'image/jpeg',
        'image/png',
        'image/webp',
      ].includes(draft.imageFile.type)
    ) {
      throw new Error(
        'Choose a JPG, PNG, or WebP photo.',
      );
    }

    if (
      draft.imageFile.size >
      5 * 1024 * 1024
    ) {
      throw new Error(
        'Photos must be 5 MB or smaller.',
      );
    }

    const extension =
      draft.imageFile.type
        .split('/')[1]
        .replace('jpeg', 'jpg');

    const path = `${user.id}/${crypto.randomUUID()}.${extension}`;

    const { error: uploadError } =
      await supabase.storage
        .from('listing-images')
        .upload(
          path,
          draft.imageFile,
          {
            contentType:
              draft.imageFile.type,
            upsert: false,
          },
        );

    if (uploadError) {
      throw uploadError;
    }

    const { data } =
      supabase.storage
        .from('listing-images')
        .getPublicUrl(path);

    imageUrls.push(data.publicUrl);
  }

  const { data, error } =
    await supabase.rpc(
      'create_listing',
      {
        listing_title: draft.title,
        listing_price: draft.price,
        listing_unit:
          draft.unit ?? null,
        listing_category:
          draft.category,
        listing_location:
          draft.location,
        listing_description:
          draft.description,
        listing_image_urls:
          imageUrls,
        seller_phone:
          draft.phone,
      },
    );

  if (error) throw error;

  return data as string;
}

export async function saveListing(
  userId: string,
  listingId: string,
  saved: boolean,
) {
  if (!supabase) {
    throw new Error(
      'Supabase is not configured.',
    );
  }

  const request = saved
    ? supabase
        .from('saved_listings')
        .insert({
          user_id: userId,
          listing_id: listingId,
        })
    : supabase
        .from('saved_listings')
        .delete()
        .eq('user_id', userId)
        .eq('listing_id', listingId);

  const { error } = await request;

  if (error) throw error;
}

export async function fetchSavedListings(
  userId: string,
): Promise<string[]> {
  if (!supabase) return [];

  const { data, error } =
    await supabase
      .from('saved_listings')
      .select('listing_id')
      .eq('user_id', userId);

  if (error) throw error;

  return data.map(
    (row) => row.listing_id,
  );
}

export async function reportListing(
  userId: string,
  listingId: string,
  reason: string,
  details: string,
) {
  if (!supabase) {
    throw new Error(
      'Supabase is not configured.',
    );
  }

  const { error } =
    await supabase
      .from('reports')
      .insert({
        reporter_id: userId,
        listing_id: listingId,
        reason,
        details:
          details || null,
      });

  if (error) throw error;
}

export async function requestTumVerification(
  userId: string,
  email: string,
  note: string,
) {
  if (!supabase) {
    throw new Error(
      'Supabase is not configured.',
    );
  }

  const { error } =
    await supabase
      .from(
        'student_verification_requests',
      )
      .insert({
        user_id: userId,
        university_email: email,
        note: note || null,
      });

  if (error) throw error;
}

async function functionErrorMessage(
  error: {
    message: string;
    context?: unknown;
  },
): Promise<string> {
  if (error.context instanceof Response) {
    const body =
      (await error.context
        .clone()
        .json()
        .catch(() => null)) as {
        error?: unknown;
        message?: unknown;
      } | null;

    if (
      typeof body?.error === 'string'
    ) {
      return body.error;
    }

    if (
      typeof body?.message === 'string'
    ) {
      return body.message;
    }
  }

  return error.message;
}

/* =========================================================
   CONTACT PAYMENT
   ========================================================= */

export async function initializeContactPayment(
  listingId: string,
  phone: string,
): Promise<{
  reference: string;
  status: string;
  customerMessage: string;
  amountKes: number;
  alreadyUnlocked?: boolean;
}> {
  if (!supabase) {
    throw new Error(
      'Supabase is not configured.',
    );
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    throw new Error(
      'Please log in again before making a payment.',
    );
  }

  const { data, error } =
    await supabase.functions.invoke(
      'initialize-contact-payment',
      {
        body: {
          listingId,
          phone,
        },
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      },
    );

  if (error) {
    throw new Error(
      await functionErrorMessage(error),
    );
  }

  if (data?.error) {
    throw new Error(data.error);
  }

  if (
    !data?.alreadyUnlocked &&
    !data?.reference
  ) {
    throw new Error(
      'Could not start the contact payment.',
    );
  }

  return data;
}

export async function verifyContactPayment(
  listingId: string,
  reference: string,
): Promise<{
  verified: boolean;
  status: string;
  message?: string;
  error?: string;
}> {
  if (!supabase) {
    throw new Error(
      'Supabase is not configured.',
    );
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    throw new Error(
      'Please log in again before verifying the payment.',
    );
  }

  const { data, error } =
    await supabase.functions.invoke(
      'verify-contact-payment',
      {
        body: {
          listingId,
          reference,
        },
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      },
    );

  if (error) {
    throw new Error(
      await functionErrorMessage(error),
    );
  }

  if (
    data?.error &&
    !data?.verified
  ) {
    throw new Error(data.error);
  }

  return data;
}

/* =========================================================
   BOOST PAYMENT
   ========================================================= */

export async function initializeBoostPayment(
  listingId: string,
  phone: string,
): Promise<{
  reference: string;
  status: string;
  customerMessage: string;
  amountKes: number;
  alreadyBoosted?: boolean;
  expiresAt?: string;
}> {
  if (!supabase) {
    throw new Error(
      'Supabase is not configured.',
    );
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    throw new Error(
      'Please log in again before making a payment.',
    );
  }

  const { data, error } =
    await supabase.functions.invoke(
      'initialize-boost-payment',
      {
        body: {
          listingId,
          phone,
        },
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      },
    );

  if (error) {
    throw new Error(
      await functionErrorMessage(error),
    );
  }

  if (data?.error) {
    throw new Error(data.error);
  }

  if (
    !data?.alreadyBoosted &&
    !data?.reference
  ) {
    throw new Error(
      'Could not start the boost payment.',
    );
  }

  return data;
}

export async function verifyBoostPayment(
  listingId: string,
  reference: string,
): Promise<{
  verified: boolean;
  status: string;
  message?: string;
  error?: string;
  expiresAt?: string;
}> {
  if (!supabase) {
    throw new Error(
      'Supabase is not configured.',
    );
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    throw new Error(
      'Please log in again before verifying the payment.',
    );
  }

  const { data, error } =
    await supabase.functions.invoke(
      'verify-boost-payment',
      {
        body: {
          listingId,
          reference,
        },
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      },
    );

  if (error) {
    throw new Error(
      await functionErrorMessage(error),
    );
  }

  return data;
}

/* =========================================================
   REVEAL LISTING CONTACT
   ========================================================= */

export async function revealListingContact(
  listingId: string,
): Promise<string> {
  if (!supabase) {
    throw new Error(
      'Supabase is not configured.',
    );
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    throw new Error(
      'Please log in again to view the seller contact.',
    );
  }

  const { data, error } =
    await supabase.functions.invoke(
      'get-listing-contact',
      {
        body: {
          listingId,
        },
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      },
    );

  if (error) {
    throw new Error(
      await functionErrorMessage(error),
    );
  }

  if (!data?.phone) {
    throw new Error(
      'No verified contact unlock was found.',
    );
  }

  return data.phone as string;
}

/* =========================================================
   MODERATION
   ========================================================= */

export type ModerationQueue = {
  listings: {
    id: string;
    title: string;
    category: string;
    location: string;
    created_at: string;
  }[];
  reports: {
    id: string;
    listing_id: string;
    reason: string;
    details: string | null;
    created_at: string;
    listing_title?: string;
  }[];
  verifications: {
    id: string;
    user_id: string;
    university_email: string;
    note: string | null;
    created_at: string;
  }[];
};

export async function fetchModerationQueue(): Promise<ModerationQueue> {
  if (!supabase) {
    throw new Error(
      'Supabase is not configured.',
    );
  }

  const [
    listingResult,
    reportResult,
    verificationResult,
  ] = await Promise.all([
    supabase
      .from('listings')
      .select(
        'id, title, category, location, created_at',
      )
      .eq('status', 'pending')
      .order('created_at'),

    supabase
      .from('reports')
      .select(
        'id, listing_id, reason, details, created_at',
      )
      .in('status', [
        'open',
        'reviewing',
      ])
      .order('created_at'),

    supabase
      .from(
        'student_verification_requests',
      )
      .select(
        'id, user_id, university_email, note, created_at',
      )
      .eq('status', 'pending')
      .order('created_at'),
  ]);

  if (listingResult.error) {
    throw listingResult.error;
  }

  if (reportResult.error) {
    throw reportResult.error;
  }

  if (verificationResult.error) {
    throw verificationResult.error;
  }

  const reportedListingIds = [
    ...new Set(
      reportResult.data.map(
        (report) =>
          report.listing_id,
      ),
    ),
  ];

  const {
    data: reportedListings,
    error: reportedListingsError,
  } = reportedListingIds.length
    ? await supabase
        .from('listings')
        .select('id, title')
        .in(
          'id',
          reportedListingIds,
        )
    : {
        data: [],
        error: null,
      };

  if (reportedListingsError) {
    throw reportedListingsError;
  }

  const titlesById = new Map(
    reportedListings?.map(
      (listing) => [
        listing.id,
        listing.title,
      ],
    ),
  );

  return {
    listings:
      listingResult.data,

    reports:
      reportResult.data.map(
        (report) => ({
          ...report,
          listing_title:
            titlesById.get(
              report.listing_id,
            ),
        }),
      ),

    verifications:
      verificationResult.data,
  };
}

export async function moderateListing(
  listingId: string,
  decision:
    | 'active'
    | 'rejected'
    | 'removed',
) {
  if (!supabase) {
    throw new Error(
      'Supabase is not configured.',
    );
  }

  const { error } =
    await supabase.rpc(
      'moderate_listing',
      {
        p_listing_id: listingId,
        p_decision: decision,
      },
    );

  if (error) throw error;
}

export async function reviewTumVerification(
  requestId: string,
  approved: boolean,
) {
  if (!supabase) {
    throw new Error(
      'Supabase is not configured.',
    );
  }

  const { error } =
    await supabase.rpc(
      'review_tum_verification',
      {
        p_request_id: requestId,
        p_approved: approved,
      },
    );

  if (error) throw error;
}

export async function reviewListingReport(
  reportId: string,
  decision:
    | 'reviewing'
    | 'resolved'
    | 'dismissed',
) {
  if (!supabase) {
    throw new Error(
      'Supabase is not configured.',
    );
  }

  const { error } =
    await supabase.rpc(
      'review_listing_report',
      {
        p_report_id: reportId,
        p_decision: decision,
      },
    );

  if (error) throw error;
}