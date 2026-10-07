create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'TUM student' check (char_length(display_name) between 1 and 60),
  campus text not null default 'TUM' check (campus = 'TUM'),
  is_tum_verified boolean not null default false,
  role text not null default 'member' check (role in ('member', 'moderator')),
  created_at timestamptz not null default now()
);

create table public.listings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(title) between 5 and 80),
  price integer not null check (price > 0 and price <= 100000000),
  unit text check (unit is null or char_length(unit) <= 30),
  category text not null check (category in ('Buy & sell', 'Houses', 'Vacancies', 'Gigs', 'Services')),
  location text not null check (char_length(location) between 2 and 80),
  description text not null check (char_length(description) between 10 and 1200),
  image_urls text[] not null default '{}',
  status text not null default 'pending' check (status in ('pending', 'active', 'rejected', 'removed')),
  boost_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index listings_public_browse_idx on public.listings (status, created_at desc);
create index listings_category_location_idx on public.listings (category, location);
create index listings_owner_idx on public.listings (owner_id, created_at desc);

create table public.listing_contacts (
  listing_id uuid primary key references public.listings(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  phone text not null check (phone ~ '^\+?[0-9 ()-]{8,20}$'),
  created_at timestamptz not null default now()
);

create table public.contact_unlocks (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  buyer_id uuid not null references public.profiles(id) on delete cascade,
  payment_reference text not null unique,
  status text not null default 'pending' check (status in ('pending', 'verified', 'failed')),
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  unique (listing_id, buyer_id)
);

create table public.boost_purchases (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  payment_reference text not null unique,
  status text not null default 'pending' check (status in ('pending', 'verified', 'failed')),
  expires_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reason text not null check (reason in ('Scam or suspicious', 'Wrong information', 'Inappropriate content', 'Already sold or unavailable', 'Other')),
  details text check (details is null or char_length(details) <= 500),
  status text not null default 'open' check (status in ('open', 'reviewing', 'resolved', 'dismissed')),
  created_at timestamptz not null default now(),
  unique (listing_id, reporter_id)
);

create table public.student_verification_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  university_email text not null check (char_length(university_email) <= 254),
  note text check (note is null or char_length(note) <= 300),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.saved_listings (
  user_id uuid not null references public.profiles(id) on delete cascade,
  listing_id uuid not null references public.listings(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, listing_id)
);

create or replace function public.is_market_moderator()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'moderator'
  );
$$;

create or replace function public.create_listing(
  listing_title text,
  listing_price integer,
  listing_unit text,
  listing_category text,
  listing_location text,
  listing_description text,
  listing_image_urls text[],
  seller_phone text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  created_listing_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in before posting a listing.' using errcode = '28000';
  end if;

  insert into public.listings (
    owner_id, title, price, unit, category, location, description, image_urls, status
  ) values (
    auth.uid(), listing_title, listing_price, listing_unit, listing_category,
    listing_location, listing_description, coalesce(listing_image_urls, '{}'), 'active'
  ) returning id into created_listing_id;

  insert into public.listing_contacts (listing_id, owner_id, phone)
  values (created_listing_id, auth.uid(), seller_phone);

  return created_listing_id;
end;
$$;

create or replace function public.moderate_listing(p_listing_id uuid, p_decision text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_market_moderator() or p_decision not in ('active', 'rejected', 'removed') then
    raise exception 'Not authorized to moderate this listing.' using errcode = '42501';
  end if;
  update public.listings set status = p_decision, updated_at = now() where id = p_listing_id;
end;
$$;

create or replace function public.review_tum_verification(p_request_id uuid, p_approved boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  request_user_id uuid;
begin
  if not public.is_market_moderator() then
    raise exception 'Not authorized to review verification requests.' using errcode = '42501';
  end if;
  update public.student_verification_requests
  set status = case when p_approved then 'approved' else 'rejected' end,
      reviewed_by = auth.uid(), reviewed_at = now()
  where id = p_request_id and status = 'pending'
  returning user_id into request_user_id;
  if request_user_id is null then
    raise exception 'Verification request is unavailable.' using errcode = 'P0002';
  end if;
  update public.profiles set is_tum_verified = p_approved where id = request_user_id;
end;
$$;

create or replace function public.review_listing_report(p_report_id uuid, p_decision text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_market_moderator() or p_decision not in ('reviewing', 'resolved', 'dismissed') then
    raise exception 'Not authorized to review this report.' using errcode = '42501';
  end if;
  update public.reports set status = p_decision where id = p_report_id;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(new.email, '@', 1), 'TUM student')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.listings enable row level security;
alter table public.listing_contacts enable row level security;
alter table public.contact_unlocks enable row level security;
alter table public.boost_purchases enable row level security;
alter table public.reports enable row level security;
alter table public.student_verification_requests enable row level security;
alter table public.saved_listings enable row level security;

create policy "Public profiles are discoverable without contact details"
  on public.profiles for select to anon, authenticated using (true);
create policy "Users may update only their display name"
  on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy "Moderators can review profiles"
  on public.profiles for update to authenticated using (public.is_market_moderator()) with check (public.is_market_moderator());

create policy "Active listings and own listings are readable"
  on public.listings for select to anon, authenticated
  using (status = 'active' or owner_id = (select auth.uid()) or public.is_market_moderator());
create policy "Owners can edit listing content"
  on public.listings for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "Owners can delete their listings"
  on public.listings for delete to authenticated using (owner_id = (select auth.uid()));
create policy "Moderators can review listings"
  on public.listings for update to authenticated
  using (public.is_market_moderator()) with check (public.is_market_moderator());

create policy "Owners can read their private contact"
  on public.listing_contacts for select to authenticated using (owner_id = (select auth.uid()));

create policy "Buyers can read their own unlock records"
  on public.contact_unlocks for select to authenticated using (buyer_id = (select auth.uid()));
create policy "Owners can read their own boost purchases"
  on public.boost_purchases for select to authenticated using (owner_id = (select auth.uid()));

create policy "Users can submit reports"
  on public.reports for insert to authenticated with check (reporter_id = (select auth.uid()));
create policy "Users can read their reports"
  on public.reports for select to authenticated using (reporter_id = (select auth.uid()));
create policy "Moderators can review reports"
  on public.reports for select to authenticated using (public.is_market_moderator());
create policy "Moderators can resolve reports"
  on public.reports for update to authenticated using (public.is_market_moderator()) with check (public.is_market_moderator());

create policy "Users can request their own verification"
  on public.student_verification_requests for insert to authenticated with check (user_id = (select auth.uid()));
create policy "Users can read their own verification requests"
  on public.student_verification_requests for select to authenticated using (user_id = (select auth.uid()));
create policy "Moderators can review verification requests"
  on public.student_verification_requests for select to authenticated using (public.is_market_moderator());
create policy "Moderators can update verification requests"
  on public.student_verification_requests for update to authenticated using (public.is_market_moderator()) with check (public.is_market_moderator());

create policy "Users manage their own saved listings"
  on public.saved_listings for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

revoke all on public.profiles, public.listings, public.listing_contacts,
  public.contact_unlocks, public.reports, public.student_verification_requests,
  public.saved_listings, public.boost_purchases from anon, authenticated;

grant select on public.profiles to anon, authenticated;
grant update (display_name) on public.profiles to authenticated;
grant select on public.listings to anon, authenticated;
grant update (title, price, unit, category, location, description, image_urls) on public.listings to authenticated;
grant delete on public.listings to authenticated;
grant select on public.listing_contacts to authenticated;
grant select on public.contact_unlocks to authenticated;
grant select on public.boost_purchases to authenticated;
grant select, insert, update on public.reports to authenticated;
grant select, insert, update on public.student_verification_requests to authenticated;
grant select, insert, delete on public.saved_listings to authenticated;
revoke all on function public.create_listing(text, integer, text, text, text, text, text[], text) from public, anon;
grant execute on function public.create_listing(text, integer, text, text, text, text, text[], text) to authenticated;
grant execute on function public.is_market_moderator() to anon, authenticated;
revoke all on function public.moderate_listing(uuid, text) from public, anon;
revoke all on function public.review_tum_verification(uuid, boolean) from public, anon;
revoke all on function public.review_listing_report(uuid, text) from public, anon;
grant execute on function public.moderate_listing(uuid, text) to authenticated;
grant execute on function public.review_tum_verification(uuid, boolean) to authenticated;
grant execute on function public.review_listing_report(uuid, text) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('listing-images', 'listing-images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "Listing images are public to view"
  on storage.objects for select to anon, authenticated
  using (bucket_id = 'listing-images');
create policy "Signed-in users upload into their own folder"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'listing-images' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Users delete only their own images"
  on storage.objects for delete to authenticated
  using (bucket_id = 'listing-images' and (storage.foldername(name))[1] = (select auth.uid())::text);
