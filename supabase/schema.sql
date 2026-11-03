-- =====================================================================
-- Chantiers — base de données, dans le schéma « chantiers » du projet Supabase ht-portage
-- (séparé des tables HT Portage du schéma « public »).
-- Rôles : admin (l'entreprise), chef (chef de chantier), client (lecture seule)
-- Toutes les règles d'accès sont dans la base (RLS).
-- Peut être relancé sans risque.
-- =====================================================================

create extension if not exists pgcrypto;
create schema if not exists chantiers;
grant usage on schema chantiers to anon, authenticated, service_role;
alter default privileges in schema chantiers grant all on tables to service_role;
alter default privileges in schema chantiers grant all on functions to service_role;

-- ---------- Tables ----------
create table if not exists chantiers.parametres (
  id          int primary key default 1 check (id = 1),
  entreprise  text not null default 'Mon entreprise',
  devise      text not null default 'DT',
  decimales   int  not null default 3 check (decimales between 0 and 3),
  logo        text,
  modifie_le  timestamptz not null default now()
);
insert into chantiers.parametres (id) values (1) on conflict do nothing;

create table if not exists chantiers.clients (
  id         uuid primary key default gen_random_uuid(),
  nom        text not null check (length(trim(nom)) > 0),
  telephone  text,
  email      text,
  adresse    text,
  notes      text,
  cree_le    timestamptz not null default now()
);

create table if not exists chantiers.profils (
  id         uuid primary key references auth.users (id) on delete cascade,
  nom        text not null,
  email      text,
  telephone  text,
  role       text not null check (role in ('admin', 'chef', 'client')),
  client_id  uuid references chantiers.clients (id) on delete set null,
  actif      boolean not null default true,
  cree_le    timestamptz not null default now(),
  constraint profil_client check (role <> 'client' or client_id is not null)
);

create table if not exists chantiers.chantiers (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references chantiers.clients (id) on delete restrict,
  nom         text not null check (length(trim(nom)) > 0),
  adresse     text,
  debut       date,
  fin_prevue  date,
  statut      text not null default 'en_cours' check (statut in ('preparation', 'en_cours', 'suspendu', 'termine')),
  notes       text,
  cree_le     timestamptz not null default now()
);
create index if not exists chantiers_client_idx on chantiers.chantiers (client_id);

create table if not exists chantiers.modeles_lots (
  id     uuid primary key default gen_random_uuid(),
  code   text not null,
  nom    text not null,
  ordre  int  not null default 0
);

create table if not exists chantiers.lots (
  id           uuid primary key default gen_random_uuid(),
  chantier_id  uuid not null references chantiers.chantiers (id) on delete cascade,
  code         text not null default '',
  nom          text not null check (length(trim(nom)) > 0),
  marche       numeric(14, 3) not null default 0 check (marche >= 0),
  avancement   int not null default 0 check (avancement between 0 and 100),
  ordre        int not null default 0
);
create index if not exists lots_chantier_idx on chantiers.lots (chantier_id);

create table if not exists chantiers.affectations (
  profil_id    uuid not null references chantiers.profils (id) on delete cascade,
  chantier_id  uuid not null references chantiers.chantiers (id) on delete cascade,
  primary key (profil_id, chantier_id)
);

create table if not exists chantiers.depenses (
  id           uuid primary key default gen_random_uuid(),
  chantier_id  uuid not null references chantiers.chantiers (id) on delete cascade,
  lot_id       uuid references chantiers.lots (id) on delete set null,
  date         date not null default current_date,
  libelle      text not null check (length(trim(libelle)) > 0),
  montant      numeric(14, 3) not null check (montant >= 0),
  paye_par     text,
  photo        text,
  saisi_par    uuid references chantiers.profils (id) on delete set null default auth.uid(),
  saisi_nom    text,
  cree_le      timestamptz not null default now(),
  modifie_le   timestamptz
);
create index if not exists depenses_chantier_idx on chantiers.depenses (chantier_id, date desc);

create table if not exists chantiers.versements (
  id           uuid primary key default gen_random_uuid(),
  chantier_id  uuid not null references chantiers.chantiers (id) on delete cascade,
  date         date not null default current_date,
  libelle      text,
  mode         text,
  montant      numeric(14, 3) not null check (montant > 0),
  saisi_par    uuid references chantiers.profils (id) on delete set null default auth.uid(),
  cree_le      timestamptz not null default now()
);
create index if not exists versements_chantier_idx on chantiers.versements (chantier_id, date desc);

create table if not exists chantiers.photos (
  id           uuid primary key default gen_random_uuid(),
  chantier_id  uuid not null references chantiers.chantiers (id) on delete cascade,
  lot_id       uuid references chantiers.lots (id) on delete set null,
  chemin       text not null,
  legende      text,
  date         date not null default current_date,
  saisi_par    uuid references chantiers.profils (id) on delete set null default auth.uid(),
  cree_le      timestamptz not null default now()
);
create index if not exists photos_chantier_idx on chantiers.photos (chantier_id, date desc);

-- ---------- Fonctions d'accès ----------
create or replace function chantiers.mon_role() returns text
language sql stable security definer set search_path = chantiers as $$
  select role from chantiers.profils where id = auth.uid() and actif
$$;

create or replace function chantiers.est_admin() returns boolean
language sql stable security definer set search_path = chantiers as $$
  select coalesce(chantiers.mon_role() = 'admin', false)
$$;

create or replace function chantiers.peut_saisir(ch uuid) returns boolean
language sql stable security definer set search_path = chantiers as $$
  select chantiers.est_admin()
      or (chantiers.mon_role() = 'chef'
          and exists (select 1 from chantiers.affectations a where a.profil_id = auth.uid() and a.chantier_id = ch))
$$;

create or replace function chantiers.peut_voir(ch uuid) returns boolean
language sql stable security definer set search_path = chantiers as $$
  select chantiers.peut_saisir(ch)
      or (chantiers.mon_role() = 'client'
          and exists (select 1 from chantiers.chantiers c join chantiers.profils p on p.client_id = c.client_id
                      where c.id = ch and p.id = auth.uid()))
$$;

-- Le chef met à jour l'avancement d'un lot (seule modification de lot permise hors admin)
create or replace function chantiers.maj_avancement(lot uuid, pct int) returns void
language plpgsql security definer set search_path = chantiers as $$
declare ch uuid;
begin
  select chantier_id into ch from chantiers.lots where id = lot;
  if ch is null or not chantiers.peut_saisir(ch) then raise exception 'Accès refusé'; end if;
  update chantiers.lots set avancement = greatest(0, least(100, pct)) where id = lot;
end $$;

-- Nom de l'auteur de chaque saisie (affiché sans exposer la table des comptes)
create or replace function chantiers.depense_auteur() returns trigger
language plpgsql security definer set search_path = chantiers as $$
begin
  if tg_op = 'INSERT' then
    new.saisi_par := auth.uid();
    new.saisi_nom := (select nom from chantiers.profils where id = auth.uid());
  else
    new.saisi_par := old.saisi_par; new.saisi_nom := old.saisi_nom; new.cree_le := old.cree_le;
    new.chantier_id := old.chantier_id;
    new.modifie_le := now();
  end if;
  return new;
end $$;
drop trigger if exists depense_auteur on chantiers.depenses;
create trigger depense_auteur before insert or update on chantiers.depenses
  for each row execute function chantiers.depense_auteur();

-- Un lot imputé doit appartenir au même chantier
create or replace function chantiers.lot_coherent() returns trigger
language plpgsql as $$
begin
  if new.lot_id is not null and not exists (select 1 from chantiers.lots where id = new.lot_id and chantier_id = new.chantier_id) then
    raise exception 'Le lot ne fait pas partie de ce chantier';
  end if;
  return new;
end $$;
drop trigger if exists depense_lot on chantiers.depenses;
create trigger depense_lot before insert or update on chantiers.depenses for each row execute function chantiers.lot_coherent();
drop trigger if exists photo_lot on chantiers.photos;
create trigger photo_lot before insert or update on chantiers.photos for each row execute function chantiers.lot_coherent();

-- ---------- Sécurité (RLS) ----------
do $$
declare t text;
begin
  foreach t in array array['parametres','clients','profils','chantiers','modeles_lots','lots','affectations','depenses','versements','photos'] loop
    execute format('alter table chantiers.%I enable row level security', t);
    execute format('revoke all on chantiers.%I from anon', t);
    execute format('grant select, insert, update, delete on chantiers.%I to authenticated', t);
    execute format('grant all on chantiers.%I to service_role', t);
  end loop;
end $$;
revoke execute on function chantiers.maj_avancement(uuid, int) from anon, public;
grant execute on function chantiers.maj_avancement(uuid, int) to authenticated;

-- (re)création des règles
do $$
declare r record;
begin
  for r in select policyname, tablename from pg_policies where schemaname = 'chantiers'
           and tablename in ('parametres','clients','profils','chantiers','modeles_lots','lots','affectations','depenses','versements','photos') loop
    execute format('drop policy %I on chantiers.%I', r.policyname, r.tablename);
  end loop;
end $$;

create policy lire on chantiers.parametres for select to authenticated using (true);
create policy admin on chantiers.parametres for update to authenticated using (chantiers.est_admin()) with check (chantiers.est_admin());

create policy admin on chantiers.clients for all to authenticated using (chantiers.est_admin()) with check (chantiers.est_admin());
create policy lire on chantiers.clients for select to authenticated using (
  exists (select 1 from chantiers.chantiers c where c.client_id = clients.id and chantiers.peut_voir(c.id))
  or id = (select client_id from chantiers.profils where id = auth.uid()));

create policy admin on chantiers.profils for all to authenticated using (chantiers.est_admin()) with check (chantiers.est_admin());
create policy soi on chantiers.profils for select to authenticated using (id = auth.uid());

create policy admin on chantiers.chantiers for all to authenticated using (chantiers.est_admin()) with check (chantiers.est_admin());
create policy lire on chantiers.chantiers for select to authenticated using (chantiers.peut_voir(id));

create policy admin on chantiers.modeles_lots for all to authenticated using (chantiers.est_admin()) with check (chantiers.est_admin());

create policy admin on chantiers.lots for all to authenticated using (chantiers.est_admin()) with check (chantiers.est_admin());
create policy lire on chantiers.lots for select to authenticated using (chantiers.peut_voir(chantier_id));

create policy admin on chantiers.affectations for all to authenticated using (chantiers.est_admin()) with check (chantiers.est_admin());
create policy soi on chantiers.affectations for select to authenticated using (profil_id = auth.uid());

create policy lire on chantiers.depenses for select to authenticated using (chantiers.peut_voir(chantier_id));
create policy saisir on chantiers.depenses for insert to authenticated with check (chantiers.peut_saisir(chantier_id));
create policy modifier on chantiers.depenses for update to authenticated
  using (chantiers.est_admin() or (saisi_par = auth.uid() and chantiers.peut_saisir(chantier_id)))
  with check (chantiers.peut_saisir(chantier_id));
create policy supprimer on chantiers.depenses for delete to authenticated
  using (chantiers.est_admin() or (saisi_par = auth.uid() and chantiers.peut_saisir(chantier_id)));

create policy admin on chantiers.versements for all to authenticated using (chantiers.est_admin()) with check (chantiers.est_admin());
-- les versements du client ne sont visibles que de l'admin et du client (pas des chefs de chantier)
create policy lire on chantiers.versements for select to authenticated using (chantiers.mon_role() = 'client' and chantiers.peut_voir(chantier_id));

create policy lire on chantiers.photos for select to authenticated using (chantiers.peut_voir(chantier_id));
create policy ajouter on chantiers.photos for insert to authenticated with check (chantiers.peut_saisir(chantier_id));
create policy modifier on chantiers.photos for update to authenticated
  using (chantiers.est_admin() or (saisi_par = auth.uid() and chantiers.peut_saisir(chantier_id)))
  with check (chantiers.peut_saisir(chantier_id));
create policy supprimer on chantiers.photos for delete to authenticated
  using (chantiers.est_admin() or (saisi_par = auth.uid() and chantiers.peut_saisir(chantier_id)));

-- ---------- Fichiers (tickets et photos) : stockage privé ----------
-- Chemin : <chantier_id>/<nom>.jpg
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chantiers-fichiers', 'chantiers-fichiers', false, 8388608, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = 8388608, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

create or replace function chantiers.dossier_chantier(nom text) returns uuid
language plpgsql immutable as $$
begin
  return split_part(nom, '/', 1)::uuid;
exception when others then return null;
end $$;

drop policy if exists "chantiers fichiers lire" on storage.objects;
drop policy if exists "chantiers fichiers ajouter" on storage.objects;
drop policy if exists "chantiers fichiers supprimer" on storage.objects;
create policy "chantiers fichiers lire" on storage.objects for select to authenticated
  using (bucket_id = 'chantiers-fichiers' and chantiers.peut_voir(chantiers.dossier_chantier(name)));
create policy "chantiers fichiers ajouter" on storage.objects for insert to authenticated
  with check (bucket_id = 'chantiers-fichiers' and chantiers.peut_saisir(chantiers.dossier_chantier(name)));
create policy "chantiers fichiers supprimer" on storage.objects for delete to authenticated
  using (bucket_id = 'chantiers-fichiers' and chantiers.peut_saisir(chantiers.dossier_chantier(name)));

-- ---------- Premier compte administrateur ----------
-- Vrai tant qu'aucun administrateur n'existe (écran « Créer le compte administrateur »)
create or replace function chantiers.installation_requise() returns boolean
language sql stable security definer set search_path = chantiers as $$
  select not exists (select 1 from chantiers.profils where role = 'admin')
$$;
grant execute on function chantiers.installation_requise() to anon, authenticated;

grant execute on all functions in schema chantiers to service_role;

-- ---------- Comptes « chantiers » et HT Portage ----------
-- Les comptes créés par l'application Chantiers portent app_metadata.app = 'chantiers' :
-- on ne leur crée pas de profil HT Portage (pas de candidat, pas d'e-mail de notification).
create or replace function public.creer_profil()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(new.raw_app_meta_data ->> 'app', '') = 'chantiers' then
    return new;
  end if;
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

-- Le schéma doit aussi être ajouté dans Settings › Data API › Exposed schemas.
notify pgrst, 'reload schema';

select 'ok' as installation;
