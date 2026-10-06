# TumMarket

A TUM-first student marketplace for buying and selling, housing, vacancies, gigs, and services around Mombasa.

## Local setup

1. Install Node.js 20 or newer.
2. Run `npm install`.
3. Copy `.env.example` to `.env.local` and fill in the Supabase project URL and publishable/anon key.
4. Run the SQL migration in `supabase/migrations/202610050001_initial_schema.sql` using the Supabase SQL Editor, or apply it with the Supabase CLI.
5. In Supabase Authentication, enable email OTP/magic links and add the local and production app URLs to the redirect URL allow list.
6. Run `npm run dev` and open the local URL printed by Vite.
7. Run `npm run build` to type-check and build for production.

Without Supabase variables, the app stays in demo mode and uses sample listings. With Supabase configured, it uses real accounts, saved listings, persistent listings, photo uploads, reports, and moderation. New listings are private to their owner and moderators until approved.

## Initial moderator

Create the first account through the app, then promote that account once from the Supabase SQL Editor. Substitute the account email you own:

```sql
update public.profiles
set role = 'moderator'
where id = (select id from auth.users where email = 'YOUR_EMAIL');
```

Only moderators can approve listings, review TUM verification requests, and resolve reports. Verification is manual; submitting a university email does not automatically award a verified badge.

## Privacy and safety

- Seller phone numbers are stored separately from public listing data and are not readable through the public database API.
- The contact edge function returns a seller phone only to the listing owner or a signed-in buyer with a verified `contact_unlocks` row.
- Use a server-side payment verifier to create verified contact unlocks and boost records. Never allow browser code to mark a payment verified.
- Listing photos accept JPG, PNG, and WebP up to 5 MB. Do not upload IDs, payment details, or private documents. Uploaded listing images are public listing media; moderation controls whether the associated listing appears in browse results.
- Meet sellers in public and view a property in person before sending rent or a deposit.
- Reports are tied to the signed-in reporter and can be reviewed only by moderators.

## Payment and deployment boundary

The KSh 20 contact reveal and KSh 50 boost checkout are intentionally not connected. The database includes private payment record tables, and the contact lookup requires a verified unlock, but transaction initialization, callback verification, and writing those verified records are not implemented here. Keep Paystack secret credentials on your secure server or edge function. Production hosting/domain setup is also left for the project owner.

Never put a Supabase service-role key or Paystack secret key in `VITE_*` variables or browser code. Only the publishable/anon Supabase key belongs in `.env.local`.
