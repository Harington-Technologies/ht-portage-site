-- =====================================================================
-- Outil « Chantier » (indépendant de HT Portage, hébergé sur le même projet)
-- Les données ne sont accessibles qu'à travers la fonction « chantier » (code d'accès) :
-- aucun accès direct depuis le navigateur.
-- Peut être relancé sans risque.
-- =====================================================================

create table if not exists public.chantier_lots (
  id            serial primary key,
  code          text unique not null,
  nom           text not null,
  remarque      text,
  marche        numeric(14, 3) not null default 0,
  paye_initial  numeric(14, 3) not null default 0,
  ordre         int not null default 0
);
create table if not exists public.chantier_lignes (
  id            serial primary key,
  lot_id        int not null references public.chantier_lots (id) on delete cascade,
  libelle       text, detail text, remarque text,
  marche        numeric(14, 3) not null default 0,
  paye          numeric(14, 3) not null default 0,
  paye_par      text,
  a_rembourser  numeric(14, 3),
  ordre         int not null default 0
);
create table if not exists public.chantier_postes (
  id      serial primary key,
  nom     text unique not null,
  lot_id  int references public.chantier_lots (id) on delete set null,
  ordre   int not null default 0,
  actif   boolean not null default true
);
create table if not exists public.chantier_depenses (
  id              uuid primary key default gen_random_uuid(),
  cree_le         timestamptz not null default now(),
  modifie_le      timestamptz,
  date            date not null,
  poste           text not null,
  lot_id          int references public.chantier_lots (id) on delete set null,
  detail          text,
  montant         numeric(14, 3) not null check (montant >= 0),
  paye_par        text not null default 'Caisse',
  photo           text,
  deja_au_budget  boolean not null default false,
  saisi_par       text
);
create index if not exists chantier_depenses_date_idx on public.chantier_depenses (date desc);
create table if not exists public.chantier_versements (
  id         uuid primary key default gen_random_uuid(),
  cree_le    timestamptz not null default now(),
  date       date not null,
  libelle    text,
  montant    numeric(14, 3) not null,
  saisi_par  text
);

do $$
declare t text;
begin
  foreach t in array array['chantier_lots', 'chantier_lignes', 'chantier_postes', 'chantier_depenses', 'chantier_versements'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- Photos des tickets : stockage privé
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chantier', 'chantier', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false;

select (select count(*) from public.chantier_lots) as lots, (select count(*) from public.chantier_depenses) as depenses;
