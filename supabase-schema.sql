-- NOOR & TIME — Supabase setup
-- Run this entire file in Supabase Dashboard → SQL Editor.
-- Before the final owner INSERT near the bottom, create your owner user
-- in Authentication → Users and copy that user's UUID.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner')),
  created_at timestamptz not null default now()
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null check (category in ('attar','watch')),
  description text not null default '',
  price numeric(12,2) not null check (price >= 0),
  image_url text,
  stock integer not null default 0 check (stock >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  customer_name text not null,
  phone text not null,
  address text not null,
  city text not null,
  state text not null,
  pincode text not null,
  notes text,
  total_amount numeric(12,2) not null check (total_amount >= 0),
  payment_method text not null default 'COD' check (payment_method = 'COD'),
  status text not null default 'new'
    check (status in ('new','confirmed','packed','shipped','delivered','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  product_name text not null,
  unit_price numeric(12,2) not null check (unit_price >= 0),
  quantity integer not null check (quantity > 0),
  created_at timestamptz not null default now()
);

create index if not exists products_active_idx on public.products (is_active, created_at desc);
create index if not exists orders_created_idx on public.orders (created_at desc);
create index if not exists order_items_order_idx on public.order_items (order_id);
create index if not exists order_items_product_idx on public.order_items (product_id);

-- Owner check function used by RLS policies.
create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'owner'
  );
$$;

grant execute on function public.is_owner() to anon, authenticated;

-- Secure COD checkout. Customers do NOT get direct INSERT access to the
-- orders/order_items tables; they call this function instead.
create or replace function public.place_order(
  p_customer_name text,
  p_phone text,
  p_address text,
  p_city text,
  p_state text,
  p_pincode text,
  p_notes text,
  p_items jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid := gen_random_uuid();
  v_total numeric(12,2) := 0;
  v_item jsonb;
  v_product public.products%rowtype;
  v_product_id uuid;
  v_qty integer;
begin
  if length(trim(coalesce(p_customer_name,''))) < 2 then
    raise exception 'Enter a valid name.';
  end if;

  if regexp_replace(coalesce(p_phone,''), '\D', '', 'g') !~ '^[0-9]{10,15}$' then
    raise exception 'Enter a valid phone number.';
  end if;

  if length(trim(coalesce(p_address,''))) < 5 then
    raise exception 'Enter a valid delivery address.';
  end if;

  if length(trim(coalesce(p_city,''))) < 2
     or length(trim(coalesce(p_state,''))) < 2
     or length(trim(coalesce(p_pincode,''))) < 4 then
    raise exception 'Complete the city, state and PIN code.';
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Your cart is empty.';
  end if;

  insert into public.orders (
    id, customer_name, phone, address, city, state, pincode, notes,
    total_amount, payment_method, status
  )
  values (
    v_order_id,
    trim(p_customer_name),
    trim(p_phone),
    trim(p_address),
    trim(p_city),
    trim(p_state),
    trim(p_pincode),
    nullif(trim(coalesce(p_notes,'')), ''),
    0,
    'COD',
    'new'
  );

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    begin
      v_product_id := (v_item->>'product_id')::uuid;
      v_qty := (v_item->>'quantity')::integer;
    exception when others then
      raise exception 'Invalid cart item.';
    end;

    if v_qty < 1 or v_qty > 50 then
      raise exception 'Invalid quantity.';
    end if;

    select *
    into v_product
    from public.products
    where id = v_product_id
      and is_active = true
    for update;

    if not found then
      raise exception 'A product in your cart is no longer available.';
    end if;

    if v_product.stock < v_qty then
      raise exception 'Not enough stock for "%".', v_product.name;
    end if;

    insert into public.order_items (
      order_id, product_id, product_name, unit_price, quantity
    )
    values (
      v_order_id, v_product.id, v_product.name, v_product.price, v_qty
    );

    v_total := v_total + (v_product.price * v_qty);

    update public.products
    set stock = stock - v_qty,
        updated_at = now()
    where id = v_product.id;
  end loop;

  if v_total <= 0 then
    raise exception 'Order total must be greater than zero.';
  end if;

  update public.orders
  set total_amount = v_total,
      updated_at = now()
  where id = v_order_id;

  return v_order_id;
end;
$$;

grant execute on function public.place_order(text,text,text,text,text,text,text,jsonb) to anon, authenticated;

-- RLS
alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;

-- Remove broad defaults, then add least-privilege grants.
revoke all on table public.profiles from anon, authenticated;
revoke all on table public.products from anon, authenticated;
revoke all on table public.orders from anon, authenticated;
revoke all on table public.order_items from anon, authenticated;

grant select on table public.products to anon, authenticated;
grant select, insert, update, delete on table public.products to authenticated;

grant select, update on table public.orders to authenticated;
grant select on table public.order_items to authenticated;

-- Profiles: the owner may read their own row.
create policy "owner can read own profile"
on public.profiles
for select
to authenticated
using (id = auth.uid());

-- Products: public can see only active products.
create policy "public can view active products"
on public.products
for select
to anon
using (is_active = true);

create policy "owner can read all products"
on public.products
for select
to authenticated
using ((select public.is_owner()));

create policy "owner can insert products"
on public.products
for insert
to authenticated
with check (public.is_owner());

create policy "owner can update products"
on public.products
for update
to authenticated
using (public.is_owner())
with check (public.is_owner());

create policy "owner can delete products"
on public.products
for delete
to authenticated
using (public.is_owner());

-- Orders: customers cannot select orders. Only the owner can read/update.
create policy "owner can read orders"
on public.orders
for select
to authenticated
using (public.is_owner());

create policy "owner can update orders"
on public.orders
for update
to authenticated
using (public.is_owner())
with check (public.is_owner());

create policy "owner can read order items"
on public.order_items
for select
to authenticated
using (public.is_owner());

-- Realtime needs orders in the publication.
do $$
begin
  alter publication supabase_realtime add table public.orders;
exception
  when duplicate_object then null;
end $$;

-- IMPORTANT:
-- After creating your owner user in Authentication → Users,
-- run the following with that user's real UUID:
--
-- insert into public.profiles (id, role)
-- values ('YOUR-AUTH-USER-UUID-HERE', 'owner')
-- on conflict (id) do update set role = 'owner';

-- IMPORTANT STORAGE SETUP:
-- Create a Storage bucket named exactly: product-images
-- Make the bucket Public.
-- Then run the storage policies below.

create policy "public can view product images"
on storage.objects
for select
to anon, authenticated
using (bucket_id = 'product-images');

create policy "owner can upload product images"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'product-images'
  and public.is_owner()
);

create policy "owner can update product images"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'product-images'
  and public.is_owner()
)
with check (
  bucket_id = 'product-images'
  and public.is_owner()
);

create policy "owner can delete product images"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'product-images'
  and public.is_owner()
);

-- Customers use the RPC anonymously; signed-in users do not need direct execute access.
revoke execute on function public.place_order(text,text,text,text,text,text,text,jsonb) from authenticated;
