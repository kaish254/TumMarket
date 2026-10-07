alter table public.profiles
  drop constraint if exists profiles_campus_check;

alter table public.profiles
  alter column campus set default 'Kenya',
  alter column display_name set default 'Marketplace member';

update public.profiles
set campus = 'Kenya'
where campus = 'TUM';

update public.profiles
set display_name = 'Marketplace member'
where display_name = 'TUM student';

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, campus)
  values (
    new.id,
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
      split_part(new.email, '@', 1),
      'Marketplace member'
    ),
    'Kenya'
  );
  return new;
end;
$$;