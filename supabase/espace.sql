-- =====================================================================
-- HT Portage — Espace consultant (phase 1 : le socle)
-- À exécuter une fois dans Supabase › SQL Editor, APRÈS schema.sql.
-- Peut être relancé sans risque (idempotent).
--
-- Principe de sécurité (Row Level Security) :
--   - chaque consultant connecté ne voit QUE ses propres données ;
--   - il peut modifier son profil, mais pas son statut ni son identifiant VSP ;
--   - les administrateurs HT Portage (table admins) voient et gèrent tout ;
--   - les visiteurs non connectés (clé publique) n'ont accès à rien de tout cela.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Administrateurs HT Portage
-- ---------------------------------------------------------------------
create table if not exists public.admins (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now()
);
alter table public.admins enable row level security;
revoke all on public.admins from anon, authenticated;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- ---------------------------------------------------------------------
-- Profils consultants (1 ligne par compte, créée automatiquement)
-- ---------------------------------------------------------------------
create table if not exists public.profils (
  id                uuid primary key references auth.users (id) on delete cascade,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  email             text not null,
  civilite          text check (civilite in ('M.', 'Mme')),
  prenom            text check (char_length(prenom) <= 100),
  nom               text check (char_length(nom) <= 100),
  telephone         text check (char_length(telephone) <= 40),
  adresse           text check (char_length(adresse) <= 300),
  code_postal       text check (char_length(code_postal) <= 20),
  ville             text check (char_length(ville) <= 100),
  pays              text not null default 'France' check (char_length(pays) <= 100),
  date_naissance    date check (date_naissance between date '1930-01-01' and current_date),
  lieu_naissance    text check (char_length(lieu_naissance) <= 150),
  nationalite       text check (char_length(nationalite) <= 100),
  num_secu          text check (num_secu ~ '^[12][0-9]{4}(2A|2B|[0-9]{2})[0-9]{6}([0-9]{2})?$'),
  iban              text check (iban ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$'),
  bic               text check (bic ~ '^[A-Z0-9]{8}([A-Z0-9]{3})?$'),
  competences       text check (char_length(competences) <= 500),
  statut            text not null default 'candidat' check (statut in ('candidat', 'consultant', 'sorti')),
  vsp_id            text unique check (char_length(vsp_id) <= 100),
  code_parrainage   text unique not null default substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
  parrain_code      text check (char_length(parrain_code) <= 20)
);

-- Création automatique du profil à l'inscription
create or replace function public.creer_profil()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profils (id, email, prenom, nom, parrain_code)
  values (
    new.id,
    new.email,
    nullif(left(new.raw_user_meta_data ->> 'prenom', 100), ''),
    nullif(left(new.raw_user_meta_data ->> 'nom', 100), ''),
    nullif(left(new.raw_user_meta_data ->> 'parrain', 20), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.creer_profil();

-- Le consultant ne peut pas changer son statut, son id VSP, son e-mail de compte ni son code
create or replace function public.proteger_profil()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    new.id              := old.id;
    new.email           := old.email;
    new.statut          := old.statut;
    new.vsp_id          := old.vsp_id;
    new.code_parrainage := old.code_parrainage;
    new.parrain_code    := old.parrain_code;
    new.created_at      := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists proteger_profil on public.profils;
create trigger proteger_profil
  before update on public.profils
  for each row execute function public.proteger_profil();

-- ---------------------------------------------------------------------
-- Simulations enregistrées depuis le simulateur
-- ---------------------------------------------------------------------
create table if not exists public.simulations (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  tjm         integer not null check (tjm between 100 and 5000),
  jours       integer not null check (jours between 1 and 31),
  net_estime  integer not null check (net_estime between 0 and 200000)
);
create index if not exists simulations_user_idx on public.simulations (user_id, created_at desc);

-- ---------------------------------------------------------------------
-- Missions du consultant (≠ table « missions » = offres publiées sur le site)
-- ---------------------------------------------------------------------
create table if not exists public.consultant_missions (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  intitule             text not null check (char_length(intitule) between 2 and 300),
  competences          text check (char_length(competences) <= 500),
  client               text check (char_length(client) <= 200),
  client_siret         text check (client_siret ~ '^[0-9]{14}$'),
  client_final         text check (char_length(client_final) <= 200),
  lieu                 text check (char_length(lieu) <= 200),
  date_debut           date,
  date_fin             date check (date_fin is null or date_debut is null or date_fin >= date_debut),
  tjm                  numeric(8, 2) check (tjm between 100 and 5000),
  interlocuteur_nom    text check (char_length(interlocuteur_nom) <= 200),
  interlocuteur_tel    text check (char_length(interlocuteur_tel) <= 40),
  interlocuteur_email  text check (char_length(interlocuteur_email) <= 254),
  statut               text not null default 'brouillon'
                         check (statut in ('brouillon', 'a_valider', 'validee', 'active', 'terminee', 'annulee')),
  vsp_id               text check (char_length(vsp_id) <= 100)
);
create index if not exists consultant_missions_user_idx on public.consultant_missions (user_id, date_debut desc);

-- Le consultant ne modifie qu'un brouillon, et ne peut que le passer « à valider »
create or replace function public.proteger_mission()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    if tg_op = 'INSERT' then
      new.user_id := auth.uid();
      new.vsp_id  := null;
      if new.statut not in ('brouillon', 'a_valider') then new.statut := 'brouillon'; end if;
    else
      if old.statut <> 'brouillon' then
        raise exception 'Cette mission est en cours de validation : elle ne peut plus être modifiée.';
      end if;
      new.user_id    := old.user_id;
      new.vsp_id     := old.vsp_id;
      new.created_at := old.created_at;
      if new.statut not in ('brouillon', 'a_valider') then new.statut := old.statut; end if;
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists proteger_mission on public.consultant_missions;
create trigger proteger_mission
  before insert or update on public.consultant_missions
  for each row execute function public.proteger_mission();

-- ---------------------------------------------------------------------
-- Documents (contrats, annexes, bulletins, comptes d'activité…)
-- Les fichiers sont dans le bucket privé « documents », dossier = id du consultant.
-- ---------------------------------------------------------------------
create table if not exists public.documents (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  mission_id     uuid references public.consultant_missions (id) on delete set null,
  created_at     timestamptz not null default now(),
  type           text not null check (type in ('cdi', 'annexe', 'avenant', 'bulletin', 'compte_activite', 'attestation', 'autre')),
  titre          text not null check (char_length(titre) between 2 and 200),
  statut         text not null default 'disponible' check (statut in ('en_preparation', 'a_signer', 'signe', 'disponible')),
  date_document  date,
  storage_path   text check (char_length(storage_path) <= 400)
);
create index if not exists documents_user_idx on public.documents (user_id, created_at desc);

-- ---------------------------------------------------------------------
-- Comptes d'activité mensuels (import VSP)
-- ---------------------------------------------------------------------
create table if not exists public.comptes_activite (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  created_at     timestamptz not null default now(),
  mois           date not null check (extract(day from mois) = 1),
  jours          numeric(5, 2) check (jours between 0 and 31),
  ca_ht          numeric(12, 2),
  frais_gestion  numeric(12, 2),
  charges        numeric(12, 2),
  net_verse      numeric(12, 2),
  reserve        numeric(12, 2),
  statut         text not null default 'definitif' check (statut in ('provisoire', 'definitif')),
  source         text not null default 'import' check (source in ('vsp', 'import', 'saisie')),
  unique (user_id, mois)
);

-- ---------------------------------------------------------------------
-- Recommandations : rattachement au compte de l'ambassadeur
-- ---------------------------------------------------------------------
alter table public.recommandations add column if not exists user_id uuid references auth.users (id) on delete set null;
alter table public.recommandations add column if not exists prime_montant numeric(10, 2);
create index if not exists recommandations_user_idx on public.recommandations (user_id, created_at desc);

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
alter table public.profils             enable row level security;
alter table public.simulations         enable row level security;
alter table public.consultant_missions enable row level security;
alter table public.documents           enable row level security;
alter table public.comptes_activite    enable row level security;

-- Profils
drop policy if exists "profil_lecture" on public.profils;
create policy "profil_lecture" on public.profils
  for select to authenticated using (id = auth.uid() or public.is_admin());
drop policy if exists "profil_modification" on public.profils;
create policy "profil_modification" on public.profils
  for update to authenticated using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

-- Simulations
drop policy if exists "simulation_lecture" on public.simulations;
create policy "simulation_lecture" on public.simulations
  for select to authenticated using (user_id = auth.uid() or public.is_admin());
drop policy if exists "simulation_ajout" on public.simulations;
create policy "simulation_ajout" on public.simulations
  for insert to authenticated with check (user_id = auth.uid());

-- Missions du consultant
drop policy if exists "mission_lecture" on public.consultant_missions;
create policy "mission_lecture" on public.consultant_missions
  for select to authenticated using (user_id = auth.uid() or public.is_admin());
drop policy if exists "mission_ajout" on public.consultant_missions;
create policy "mission_ajout" on public.consultant_missions
  for insert to authenticated with check (user_id = auth.uid() or public.is_admin());
drop policy if exists "mission_modification" on public.consultant_missions;
create policy "mission_modification" on public.consultant_missions
  for update to authenticated using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());
drop policy if exists "mission_suppression" on public.consultant_missions;
create policy "mission_suppression" on public.consultant_missions
  for delete to authenticated using (public.is_admin() or (user_id = auth.uid() and statut = 'brouillon'));

-- Documents et comptes d'activité : lecture par le consultant, gestion par l'admin
drop policy if exists "document_lecture" on public.documents;
create policy "document_lecture" on public.documents
  for select to authenticated using (user_id = auth.uid() or public.is_admin());
drop policy if exists "document_admin" on public.documents;
create policy "document_admin" on public.documents
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "compte_lecture" on public.comptes_activite;
create policy "compte_lecture" on public.comptes_activite
  for select to authenticated using (user_id = auth.uid() or public.is_admin());
drop policy if exists "compte_admin" on public.comptes_activite;
create policy "compte_admin" on public.comptes_activite
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Recommandations : le consultant connecté voit et ajoute les siennes ; l'admin gère tout
drop policy if exists "reco_lecture" on public.recommandations;
create policy "reco_lecture" on public.recommandations
  for select to authenticated using (user_id = auth.uid() or public.is_admin());
drop policy if exists "reco_ajout_connecte" on public.recommandations;
create policy "reco_ajout_connecte" on public.recommandations
  for insert to authenticated with check (user_id = auth.uid() and consentement and statut = 'nouvelle' and prime_montant is null);
drop policy if exists "reco_admin" on public.recommandations;
create policy "reco_admin" on public.recommandations
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- Demandes reçues par le site : consultables et traitables par l'admin depuis l'espace
drop policy if exists "contacts_admin" on public.contacts;
create policy "contacts_admin" on public.contacts
  for select to authenticated using (public.is_admin());
drop policy if exists "contacts_admin_maj" on public.contacts;
create policy "contacts_admin_maj" on public.contacts
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "candidatures_admin" on public.candidatures;
create policy "candidatures_admin" on public.candidatures
  for select to authenticated using (public.is_admin());
drop policy if exists "candidatures_admin_maj" on public.candidatures;
create policy "candidatures_admin_maj" on public.candidatures
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- Droits des rôles (la RLS ci-dessus filtre ensuite ligne par ligne)
revoke all on public.profils, public.simulations, public.consultant_missions, public.documents, public.comptes_activite from anon;
grant select, update                 on public.profils             to authenticated;
grant select, insert                 on public.simulations         to authenticated;
grant select, insert, update, delete on public.consultant_missions to authenticated;
grant select, insert, update, delete on public.documents           to authenticated;
grant select, insert, update, delete on public.comptes_activite    to authenticated;
grant select, insert, update         on public.recommandations     to authenticated;
grant select, update                 on public.contacts, public.candidatures to authenticated;

-- ---------------------------------------------------------------------
-- Stockage : bucket privé « documents » (10 Mo, PDF et images)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documents', 'documents', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "documents_lecture" on storage.objects;
create policy "documents_lecture" on storage.objects
  for select to authenticated
  using (bucket_id = 'documents' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));
drop policy if exists "documents_admin_ajout" on storage.objects;
create policy "documents_admin_ajout" on storage.objects
  for insert to authenticated with check (bucket_id = 'documents' and public.is_admin());
drop policy if exists "documents_admin_maj" on storage.objects;
create policy "documents_admin_maj" on storage.objects
  for update to authenticated using (bucket_id = 'documents' and public.is_admin());
drop policy if exists "documents_admin_suppr" on storage.objects;
create policy "documents_admin_suppr" on storage.objects
  for delete to authenticated using (bucket_id = 'documents' and public.is_admin());

-- L'admin peut aussi télécharger les CV reçus par le site
drop policy if exists "cv_admin_lecture" on storage.objects;
create policy "cv_admin_lecture" on storage.objects
  for select to authenticated using (bucket_id = 'cv' and public.is_admin());

-- ---------------------------------------------------------------------
-- Premier administrateur : APRÈS avoir créé votre compte sur /espace/connexion.html,
-- remplacez l'adresse ci-dessous par la vôtre, puis exécutez ces 2 lignes seules.
-- ---------------------------------------------------------------------
-- insert into public.admins (user_id)
-- select id from auth.users where email = 'VOTRE-ADRESSE@htportage.fr' on conflict do nothing;
