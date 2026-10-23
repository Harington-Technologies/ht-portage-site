-- =====================================================================
-- HT Portage — schéma Supabase du site
-- À exécuter une fois dans Supabase › SQL Editor.
-- Principe de sécurité : le site (clé « anon ») peut seulement
--   - AJOUTER des demandes (contacts, candidatures, recommandations) ;
--   - LIRE les missions publiées ;
--   - DÉPOSER un CV dans le bucket privé « cv ».
-- Il ne peut ni lire, ni modifier, ni supprimer les demandes reçues.
-- Vous les consultez depuis le tableau de bord Supabase.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Demandes de contact et de simulation détaillée
-- ---------------------------------------------------------------------
create table if not exists public.contacts (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  type          text not null default 'contact' check (type in ('contact', 'simulation')),
  nom           text not null check (char_length(nom) between 2 and 200),
  email         text not null check (char_length(email) <= 254 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  telephone     text check (char_length(telephone) <= 40),
  situation     text check (char_length(situation) <= 200),
  message       text check (char_length(message) <= 5000),
  tjm           integer check (tjm between 100 and 5000),
  jours         integer check (jours between 1 and 31),
  net_estime    integer check (net_estime between 0 and 200000),
  consentement  boolean not null check (consentement),
  traite        boolean not null default false
);

-- ---------------------------------------------------------------------
-- Candidatures aux missions (CV dans le bucket « cv »)
-- ---------------------------------------------------------------------
create table if not exists public.candidatures (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  mission_ref    text check (char_length(mission_ref) <= 200),
  nom            text not null check (char_length(nom) between 2 and 200),
  email          text not null check (char_length(email) <= 254 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  telephone      text not null check (char_length(telephone) <= 40),
  tjm_souhaite   integer check (tjm_souhaite between 100 and 5000),
  disponibilite  text check (char_length(disponibilite) <= 100),
  cv_path        text check (char_length(cv_path) <= 300),
  message        text check (char_length(message) <= 5000),
  consentement   boolean not null check (consentement),
  statut         text not null default 'nouvelle' check (statut in ('nouvelle', 'en cours', 'retenue', 'archivee'))
);

-- ---------------------------------------------------------------------
-- Recommandations du programme Ambassadeur
-- ---------------------------------------------------------------------
create table if not exists public.recommandations (
  id                 uuid primary key default gen_random_uuid(),
  created_at         timestamptz not null default now(),
  type               text not null check (type in ('consultant', 'mission', 'client', 'formation')),
  ambassadeur_nom    text not null check (char_length(ambassadeur_nom) between 2 and 200),
  ambassadeur_email  text not null check (char_length(ambassadeur_email) <= 254 and ambassadeur_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  contact_nom        text not null check (char_length(contact_nom) between 2 and 200),
  contact_email      text check (char_length(contact_email) <= 254),
  details            text not null check (char_length(details) between 2 and 5000),
  consentement       boolean not null check (consentement),
  statut             text not null default 'nouvelle' check (statut in ('nouvelle', 'en cours', 'validee', 'prime versee', 'refusee'))
);

-- ---------------------------------------------------------------------
-- Offres de missions (saisies depuis le tableau de bord Supabase)
-- ---------------------------------------------------------------------
create table if not exists public.missions (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  ref         text unique not null,
  titre       text not null,
  domaine     text not null check (domaine in ('Développement', 'Data & IA', 'Cloud & DevOps', 'Pilotage')),
  resume      text,
  lieu        text,
  duree       text,
  rythme      text,
  tjm         text,            -- texte libre, ex. « 650-750 € » ; vide = « selon profil »
  publiee     boolean not null default false
);

-- ---------------------------------------------------------------------
-- Sécurité (Row Level Security)
-- ---------------------------------------------------------------------
alter table public.contacts        enable row level security;
alter table public.candidatures    enable row level security;
alter table public.recommandations enable row level security;
alter table public.missions        enable row level security;

drop policy if exists "site_insert_contacts" on public.contacts;
create policy "site_insert_contacts" on public.contacts
  for insert to anon with check (consentement and traite = false);

drop policy if exists "site_insert_candidatures" on public.candidatures;
create policy "site_insert_candidatures" on public.candidatures
  for insert to anon with check (consentement and statut = 'nouvelle');

drop policy if exists "site_insert_recommandations" on public.recommandations;
create policy "site_insert_recommandations" on public.recommandations
  for insert to anon with check (consentement and statut = 'nouvelle');

drop policy if exists "site_read_missions" on public.missions;
create policy "site_read_missions" on public.missions
  for select to anon using (publiee);

-- Droits minimaux pour le rôle du site
revoke all on public.contacts, public.candidatures, public.recommandations, public.missions from anon;
grant insert on public.contacts, public.candidatures, public.recommandations to anon;
grant select on public.missions to anon;

-- ---------------------------------------------------------------------
-- Stockage des CV : bucket privé, 5 Mo max, PDF ou Word
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cv', 'cv', false, 5242880, array[
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "site_upload_cv" on storage.objects;
create policy "site_upload_cv" on storage.objects
  for insert to anon with check (bucket_id = 'cv');
-- Aucune policy de lecture : les CV ne sont visibles que depuis le tableau de bord.

-- ---------------------------------------------------------------------
-- Missions d'exemple (non publiées) — à adapter puis passer publiee = true
-- ---------------------------------------------------------------------
insert into public.missions (ref, titre, domaine, resume, lieu, duree, rythme, publiee) values
  ('HTP-001', 'Tech Lead Java / Spring', 'Développement', 'Pilotage technique d’une équipe produit, architecture microservices et revue de code.', 'Paris', '12 mois', '2 j télétravail / sem.', false),
  ('HTP-002', 'Data Engineer Python', 'Data & IA', 'Conception de pipelines de données et industrialisation de modèles en production.', 'Paris', '6 mois renouvelables', 'Hybride', false)
on conflict (ref) do nothing;
