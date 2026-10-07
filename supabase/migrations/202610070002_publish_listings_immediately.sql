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

update public.listings
set status = 'active',
    updated_at = now()
where status = 'pending';