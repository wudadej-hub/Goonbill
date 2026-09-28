-- GoonBill cloud schema — run this in the Supabase SQL editor.
-- All tables are keyed by the app's stable uuid; every row belongs to one
-- auth user and is isolated by row-level security.

-- ============ Tables ============

create table if not exists clients (
  uuid text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default '',
  phone text not null default '',
  email text not null default '',
  address text not null default '',
  created_at text not null default '',
  updated_at bigint not null default 0,
  deleted boolean not null default false
);

create table if not exists invoices (
  uuid text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  number text not null,
  client_uuid text,
  status text not null default 'unpaid',
  subtotal_cents integer not null default 0,
  gst_rate double precision not null default 0.05,
  pst_rate double precision not null default 0.06,
  gst_cents integer not null default 0,
  pst_cents integer not null default 0,
  total_cents integer not null default 0,
  notes text not null default '',
  due_date text not null default '',
  payment_terms text not null default '',
  created_at text not null default '',
  updated_at bigint not null default 0,
  deleted boolean not null default false,
  unique (user_id, number)
);

create table if not exists line_items (
  uuid text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  invoice_uuid text,
  description text not null default '',
  quantity double precision not null default 1,
  rate_cents integer not null default 0,
  updated_at bigint not null default 0,
  deleted boolean not null default false
);

create table if not exists payments (
  uuid text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  invoice_uuid text,
  amount_cents integer not null default 0,
  method text not null default 'manual',
  reference text not null default '',
  paid_at text not null default '',
  updated_at bigint not null default 0,
  deleted boolean not null default false
);

create table if not exists quotes (
  uuid text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  number text not null,
  client_uuid text,
  status text not null default 'draft',
  title text not null default '',
  scope text not null default '',
  materials text not null default '',
  timeline text not null default '',
  subtotal_cents integer not null default 0,
  gst_rate double precision not null default 0.05,
  pst_rate double precision not null default 0.06,
  gst_cents integer not null default 0,
  pst_cents integer not null default 0,
  total_cents integer not null default 0,
  payment_schedule text not null default '',
  late_fees text not null default '',
  scope_change_policy text not null default '',
  valid_until text not null default '',
  client_signature text not null default '',
  signed_at text not null default '',
  converted_invoice_uuid text,
  created_at text not null default '',
  updated_at bigint not null default 0,
  deleted boolean not null default false,
  unique (user_id, number)
);

create table if not exists quote_items (
  uuid text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  quote_uuid text,
  description text not null default '',
  quantity double precision not null default 1,
  rate_cents integer not null default 0,
  updated_at bigint not null default 0,
  deleted boolean not null default false
);

create table if not exists change_orders (
  uuid text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  invoice_uuid text,
  description text not null default '',
  amount_cents integer not null default 0,
  status text not null default 'pending',
  client_approval text not null default '',
  approved_at text not null default '',
  billed integer not null default 0,
  created_at text not null default '',
  updated_at bigint not null default 0,
  deleted boolean not null default false
);

create table if not exists time_entries (
  uuid text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  invoice_uuid text,
  work_date text not null default '',
  hours double precision not null default 0,
  description text not null default '',
  rate_cents integer not null default 0,
  billed integer not null default 0,
  created_at text not null default '',
  updated_at bigint not null default 0,
  deleted boolean not null default false
);

create table if not exists material_entries (
  uuid text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  invoice_uuid text,
  description text not null default '',
  cost_cents integer not null default 0,
  remote_path text not null default '',
  billed integer not null default 0,
  created_at text not null default '',
  updated_at bigint not null default 0,
  deleted boolean not null default false
);

create table if not exists job_photos (
  uuid text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  invoice_uuid text,
  remote_path text not null default '',
  kind text not null default 'after',
  caption text not null default '',
  created_at text not null default '',
  updated_at bigint not null default 0,
  deleted boolean not null default false
);

-- ============ Row-level security ============

alter table clients enable row level security;
alter table invoices enable row level security;
alter table line_items enable row level security;
alter table payments enable row level security;
alter table quotes enable row level security;
alter table quote_items enable row level security;
alter table change_orders enable row level security;
alter table time_entries enable row level security;
alter table material_entries enable row level security;
alter table job_photos enable row level security;

-- One policy per table: users can do everything with their own rows.
do $$
declare t text;
begin
  foreach t in array array[
    'clients','invoices','line_items','payments','quotes','quote_items',
    'change_orders','time_entries','material_entries','job_photos'
  ] loop
    execute format(
      'drop policy if exists owner_all on %I; create policy owner_all on %I for all using (auth.uid() = user_id) with check (auth.uid() = user_id)',
      t, t
    );
  end loop;
end $$;

-- ============ Photo storage ============

insert into storage.buckets (id, name, public)
values ('job-photos', 'job-photos', false)
on conflict (id) do nothing;

drop policy if exists "own photos read" on storage.objects;
create policy "own photos read" on storage.objects for select
  using (bucket_id = 'job-photos' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists "own photos write" on storage.objects;
create policy "own photos write" on storage.objects for insert
  with check (bucket_id = 'job-photos' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists "own photos update" on storage.objects;
create policy "own photos update" on storage.objects for update
  using (bucket_id = 'job-photos' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists "own photos delete" on storage.objects;
create policy "own photos delete" on storage.objects for delete
  using (bucket_id = 'job-photos' and auth.uid()::text = (storage.foldername(name))[1]);
