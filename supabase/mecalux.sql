-- =====================================================================
-- Pilotage équipe Mecalux · schéma Supabase (tables préfixées mecalux_, projet ht-portage)
-- Déjà appliqué sur le projet ht-portage le 14/11/2026 (migrations mecalux_pilotage_init et mecalux_revoke_anon_est_membre).
-- Idempotent : peut être relancé sans risque dans SQL Editor.
-- =====================================================================

-- ---------- Équipe autorisée (liste blanche) ----------
-- Seules les adresses présentes ici peuvent lire ou écrire les données,
-- même si quelqu'un parvenait à se créer un compte.
create table if not exists public.mecalux_equipe (
  email      text primary key,
  nom        text,
  ajoute_le  timestamptz not null default now()
);

create or replace function public.mecalux_est_membre()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.mecalux_equipe
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

-- ---------- Tables métier ----------
create table if not exists public.mecalux_ressources (
  id         text primary key,
  nom        text not null,
  code       text,                                 -- trigramme (SBO, BHI…)
  role       text,
  ville      text,
  profil     text not null default 'fr',          -- barème : 'fr' (France), 'tn' (Tunisie)…
  tjm_vente  numeric(10,2),
  tjm_cout   numeric(10,2),
  email      text,
  actif      boolean not null default true,
  date_fin   date,                                 -- fin de mission ou départ : au-delà, inactif
  maj_le     timestamptz not null default now()
);

create table if not exists public.mecalux_projets (
  id              text primary key,
  client          text not null,
  nom             text not null,
  site            text,
  distance_km     numeric(8,1),
  ref_mecalux     text,
  dev_debut       date,
  dev_fin         date,
  mes_debut       date,
  mes_fin         date,
  budget_montant  numeric(12,2),
  cloture         boolean not null default false,
  notes           text,
  maj_le          timestamptz not null default now(),
  constraint dev_dates check (dev_fin is null or dev_debut is null or dev_fin >= dev_debut),
  constraint mes_dates check (mes_fin is null or mes_debut is null or mes_fin >= mes_debut)
);

create table if not exists public.mecalux_affectations (
  id            text primary key,
  projet_id     text not null references public.mecalux_projets(id) on delete cascade,
  ressource_id  text not null references public.mecalux_ressources(id) on delete restrict,
  phase         text not null check (phase in ('dev','mes')),
  jours_prevus  numeric(8,2) not null default 0,
  tjm           numeric(10,2),                     -- vide = TJM de la ressource
  maj_le        timestamptz not null default now()
);

create table if not exists public.mecalux_temps (
  id            text primary key,                 -- projet_ressource_mois_phase
  projet_id     text not null references public.mecalux_projets(id) on delete cascade,
  ressource_id  text not null references public.mecalux_ressources(id) on delete restrict,
  mois          text not null check (mois ~ '^\d{4}-\d{2}$'),
  phase         text not null check (phase in ('dev','mes')),
  jours         numeric(6,2) not null default 0,
  maj_le        timestamptz not null default now()
);

create table if not exists public.mecalux_frais (
  id            text primary key,
  projet_id     text not null references public.mecalux_projets(id) on delete cascade,
  ressource_id  text references public.mecalux_ressources(id) on delete restrict,
  mois          text not null check (mois ~ '^\d{4}-\d{2}$'),
  date          date,
  categorie     text not null,
  montant       numeric(10,2) not null,
  note          text,
  refacturable  boolean not null default true,
  justif        boolean not null default false,  -- justificatif détaillé joint dans Pleo
  deja_facture  boolean not null default false,  -- hôtel / location / billet déjà facturés
  maj_le        timestamptz not null default now()
);

create table if not exists public.mecalux_estimations (
  id            text primary key,
  projet_id     text not null references public.mecalux_projets(id) on delete cascade,
  ressource_id  text references public.mecalux_ressources(id) on delete set null,
  libelle       text,
  params        jsonb,
  detail        jsonb,
  total_frais   numeric(12,2),
  trajet        numeric(12,2),
  refac         numeric(12,2),
  maj_le        timestamptz not null default now()
);

create table if not exists public.mecalux_prefactures (
  id          text primary key,                   -- projet_mois
  projet_id   text not null references public.mecalux_projets(id) on delete cascade,
  mois        text not null check (mois ~ '^\d{4}-\d{2}$'),
  statut      text not null default 'Brouillon'
              check (statut in ('Brouillon','Envoyée à Zakia','Validée Mecalux','BDC reçu','Facturée')),
  bdc         text,
  notes       text,
  lignes      jsonb not null default '[]'::jsonb,
  historique  jsonb not null default '[]'::jsonb,
  maj_le      timestamptz not null default now(),
  unique (projet_id, mois)
);

create table if not exists public.mecalux_config (
  id      text primary key,                       -- 'regles'
  data    jsonb not null,
  maj_le  timestamptz not null default now()
);

-- ---------- Index ----------
create index if not exists mecalux_affectations_projet on public.mecalux_affectations(projet_id);
create index if not exists mecalux_temps_projet_mois   on public.mecalux_temps(projet_id, mois);
create index if not exists mecalux_frais_projet_mois   on public.mecalux_frais(projet_id, mois);
create index if not exists mecalux_estimations_projet  on public.mecalux_estimations(projet_id);

-- ---------- Sécurité : RLS, accès réservé à l'équipe ----------
do $$
declare t text;
begin
  foreach t in array array['mecalux_ressources','mecalux_projets','mecalux_affectations','mecalux_temps','mecalux_frais','mecalux_estimations','mecalux_prefactures','mecalux_config']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "equipe_tout" on public.%I', t);
    execute format('create policy "equipe_tout" on public.%I for all to authenticated using (public.mecalux_est_membre()) with check (public.mecalux_est_membre())', t);
  end loop;
end $$;

alter table public.mecalux_equipe enable row level security;
drop policy if exists "equipe_lecture" on public.mecalux_equipe;
create policy "equipe_lecture" on public.mecalux_equipe for select to authenticated using (public.mecalux_est_membre());
-- L'ajout de membres se fait depuis le Table Editor de Supabase (pas depuis le site).

-- ---------- Temps réel (mises à jour en direct entre collègues) ----------
do $$
declare t text;
begin
  foreach t in array array['mecalux_ressources','mecalux_projets','mecalux_affectations','mecalux_temps','mecalux_frais','mecalux_estimations','mecalux_prefactures','mecalux_config']
  loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- ---------- Membres de l'équipe ----------
-- Les vraies adresses se gèrent dans Table Editor › mecalux_equipe (pas dans ce fichier public). Puis créez
-- leur compte dans Authentication > Users > Add user (cocher « Auto Confirm User »).
insert into public.mecalux_equipe (email, nom) values
  ('prenom.nom@exemple.fr', 'Exemple')
on conflict (email) do nothing;

-- ---------- Durcissement : la fonction de contrôle n'est pas appelable sans connexion ----------
revoke execute on function public.mecalux_est_membre() from public, anon;
grant execute on function public.mecalux_est_membre() to authenticated;

-- ---------- Évolutions ----------
alter table public.mecalux_ressources add column if not exists code text;
alter table public.mecalux_ressources add column if not exists actif boolean not null default true;
alter table public.mecalux_ressources add column if not exists date_fin date;

-- Saisie jour par jour (un enregistrement par projet, ressource et mois)
create table if not exists public.mecalux_calendrier (
  id            text primary key,                 -- projet_ressource_mois
  projet_id     text not null references public.mecalux_projets(id) on delete cascade,
  ressource_id  text not null references public.mecalux_ressources(id) on delete restrict,
  mois          text not null check (mois ~ '^\d{4}-\d{2}$'),
  jours         jsonb not null default '{}'::jsonb, -- {"2026-11-03":"mes", ...}
  resume        jsonb,                             -- par type : ouvre, we, ferie, total
  valide        boolean not null default false,
  valide_le     timestamptz,
  maj_le        timestamptz not null default now(),
  unique (projet_id, ressource_id, mois)
);
create index if not exists mecalux_calendrier_projet_mois on public.mecalux_calendrier(projet_id, mois);
alter table public.mecalux_calendrier enable row level security;
drop policy if exists "equipe_tout" on public.mecalux_calendrier;
create policy "equipe_tout" on public.mecalux_calendrier for all to authenticated using (public.mecalux_est_membre()) with check (public.mecalux_est_membre());
do $$ begin alter publication supabase_realtime add table public.mecalux_calendrier; exception when duplicate_object then null; end $$;

-- Import Pleo : traçabilité des frais validés ou écartés
alter table public.mecalux_frais
  add column if not exists source text,
  add column if not exists statut text,
  add column if not exists motif text,
  add column if not exists pleo_ref text,
  add column if not exists marchand text,
  add column if not exists categorie_pleo text;
do $$ begin
  alter table public.mecalux_frais add constraint mecalux_frais_statut check (statut is null or statut in ('valide','ecarte'));
exception when duplicate_object then null; end $$;
create index if not exists mecalux_frais_pleo_ref on public.mecalux_frais(pleo_ref);

-- Barème de frais par jour (H avec hébergement, J sans hébergement, P per diem, 0 aucun)
alter table public.mecalux_calendrier add column if not exists baremes jsonb not null default '{}'::jsonb;

-- Pays du collaborateur (indépendant du barème) ; le calendrier référence l'identifiant du barème configuré
alter table public.mecalux_ressources add column if not exists pays text;

-- Frais au réel saisis en prix par jour × jours travaillés (hôtel, location, voiture Harington)
alter table public.mecalux_frais add column if not exists par_jour boolean not null default false, add column if not exists prix_jour numeric(10,2), add column if not exists jours numeric(6,2), add column if not exists jours_auto boolean not null default true;

-- Justificatifs Pleo stockés chez nous (bucket privé, aucun lien vers Pleo)
insert into storage.buckets (id, name, public, file_size_limit)
values ('mecalux-justifs', 'mecalux-justifs', false, 10485760)
on conflict (id) do nothing;
alter table public.mecalux_frais add column if not exists justifs jsonb not null default '[]'::jsonb, add column if not exists pleo_receipt text;
drop policy if exists "mecalux_justifs_equipe" on storage.objects;
create policy "mecalux_justifs_equipe" on storage.objects for all to authenticated
  using (bucket_id = 'mecalux-justifs' and public.mecalux_est_membre())
  with check (bucket_id = 'mecalux-justifs' and public.mecalux_est_membre());

-- Imports Pleo nommés (liste, renommage, suppression d'un import et de ses dépenses)
create table if not exists public.mecalux_imports (
  id text primary key, nom text not null, fichier text, source text not null default 'pleo',
  date_debut date, date_fin date, nb_lignes integer, total numeric(12,2),
  cree_le timestamptz not null default now(), maj_le timestamptz not null default now()
);
alter table public.mecalux_imports enable row level security;
drop policy if exists "equipe_tout" on public.mecalux_imports;
create policy "equipe_tout" on public.mecalux_imports for all to authenticated
  using (public.mecalux_est_membre()) with check (public.mecalux_est_membre());
grant select, insert, update, delete on public.mecalux_imports to authenticated;
alter table public.mecalux_frais add column if not exists import_id text references public.mecalux_imports(id) on delete set null;
create index if not exists mecalux_frais_import_idx on public.mecalux_frais(import_id);
alter publication supabase_realtime add table public.mecalux_imports;

-- ============ Authentification (pilotage ouvert à Mecalux) ============
-- Comptes créés depuis mecalux/connexion.html via la fonction mecalux-acces (e-mails « Pilotage Mecalux »).
-- Chaque compte confirmé crée une demande d'accès ; les administrateurs la valident ou la refusent (e-mail ou page Accès).
alter table public.mecalux_equipe add column if not exists admin boolean not null default false;
create or replace function public.mecalux_est_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.mecalux_equipe where lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')) and admin);
$$;
revoke execute on function public.mecalux_est_admin() from anon;
drop policy if exists "equipe_admin_ecriture" on public.mecalux_equipe;
create policy "equipe_admin_ecriture" on public.mecalux_equipe for all to authenticated
  using (public.mecalux_est_admin()) with check (public.mecalux_est_admin());
grant insert, update, delete on public.mecalux_equipe to authenticated;

create table if not exists public.mecalux_demandes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  email text not null, prenom text, nom text,
  statut text not null default 'en_attente' check (statut in ('en_attente','acceptee','refusee')),
  jeton text not null default encode(gen_random_bytes(24), 'hex'),
  cree_le timestamptz not null default now(), traite_le timestamptz, traite_par text
);
create unique index if not exists mecalux_demandes_attente on public.mecalux_demandes (lower(email)) where statut = 'en_attente';
alter table public.mecalux_demandes enable row level security;
drop policy if exists "demandes_admin" on public.mecalux_demandes;
create policy "demandes_admin" on public.mecalux_demandes for select to authenticated using (public.mecalux_est_admin());
grant select on public.mecalux_demandes to authenticated;

create or replace function public.mecalux_nouvelle_demande() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(new.raw_user_meta_data ->> 'app', '') <> 'mecalux' or new.email_confirmed_at is null then return new; end if;
  if tg_op = 'UPDATE' and old.email_confirmed_at is not null then return new; end if;
  if exists (select 1 from public.mecalux_equipe where lower(email) = lower(new.email)) then return new; end if;
  insert into public.mecalux_demandes (user_id, email, prenom, nom)
  values (new.id, new.email, nullif(left(new.raw_user_meta_data ->> 'prenom', 100), ''), nullif(left(new.raw_user_meta_data ->> 'nom', 100), ''))
  on conflict do nothing;
  return new;
end; $$;
drop trigger if exists mecalux_demande_acces on auth.users;
create trigger mecalux_demande_acces after insert or update of email_confirmed_at on auth.users
  for each row execute function public.mecalux_nouvelle_demande();
-- Déclencheur e-mail (remplacer <WEBHOOK_SECRET> par le secret des fonctions) :
-- create trigger notify_mecalux_demandes after insert on public.mecalux_demandes for each row execute function
--   supabase_functions.http_request('https://krcsbskmttgmzzqjfudo.supabase.co/functions/v1/mecalux-acces', 'POST',
--   '{"Content-type":"application/json","x-webhook-secret":"<WEBHOOK_SECRET>"}', '{}', '5000');
-- creer_profil() ignore aussi les comptes dont raw_user_meta_data->>'app' = 'mecalux' (pas de fiche consultant HT Portage).

-- ============ Double authentification obligatoire (comme l'administration HT Portage) ============
-- Les données ne sont accessibles qu'à une session validée par le code TOTP (niveau aal2).
create or replace function public.mecalux_est_membre() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.mecalux_equipe where lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')))
     and coalesce(auth.jwt() ->> 'aal', '') = 'aal2';
$$;
create or replace function public.mecalux_est_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.mecalux_equipe where lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')) and admin)
     and coalesce(auth.jwt() ->> 'aal', '') = 'aal2';
$$;
create or replace function public.mecalux_id_compte(p_email text) returns uuid language sql stable security definer set search_path = public, auth as $$
  select id from auth.users where lower(email) = lower(p_email) limit 1;
$$;
revoke all on function public.mecalux_id_compte(text) from public, anon, authenticated;
grant execute on function public.mecalux_id_compte(text) to service_role;
-- Téléphone perdu (sans administrateur disponible), dans l'éditeur SQL :
--   delete from auth.mfa_factors where user_id = (select id from auth.users where email = '<adresse>');

-- Compte connecté (double authentification validée) mais non autorisé : demande d'accès créée automatiquement
-- (fonction public.mecalux_demander_acces(), appelée par la page ; une demande refusée bloque 7 jours).

-- Refus d'une demande : le compte créé pour le pilotage est supprimé (fonction mecalux-acces) ; la demande est conservée
alter table public.mecalux_demandes drop constraint if exists mecalux_demandes_user_id_fkey;
alter table public.mecalux_demandes add constraint mecalux_demandes_user_id_fkey foreign key (user_id) references auth.users(id) on delete set null;

-- ============ Rôles ============
-- admin : Admin Harington, tous les droits (reçoit et traite les demandes, gère les accès)
-- harington : Utilisateur Harington, tout sauf la gestion des accès
-- mecalux : Utilisateur Mecalux, tout sauf la gestion des accès et les imports Pleo
alter table public.mecalux_equipe add column if not exists role text;
update public.mecalux_equipe set role = case when admin then 'admin' when email ilike '%@harington.fr' then 'harington' else 'mecalux' end where role is null;
alter table public.mecalux_equipe alter column role set default 'mecalux', alter column role set not null;
alter table public.mecalux_equipe add constraint mecalux_equipe_role_check check (role in ('admin','harington','mecalux'));
alter table public.mecalux_equipe drop column admin;
alter table public.mecalux_equipe add column admin boolean generated always as (role = 'admin') stored;
create or replace function public.mecalux_role() returns text language sql stable security definer set search_path = public as $$
  select case when coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
    then (select role from public.mecalux_equipe where lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')) limit 1) end;
$$;
create or replace function public.mecalux_est_harington() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.mecalux_role() in ('admin','harington'), false);
$$;
drop policy if exists "equipe_tout" on public.mecalux_imports;
create policy "imports_lecture" on public.mecalux_imports for select to authenticated using (public.mecalux_est_membre());
create policy "imports_harington" on public.mecalux_imports for all to authenticated using (public.mecalux_est_harington()) with check (public.mecalux_est_harington());
create policy "mecalux_justifs_pleo_harington" on storage.objects as restrictive for insert to authenticated
  with check (bucket_id <> 'mecalux-justifs' or name not like 'pleo/%' or public.mecalux_est_harington());

-- ============ Visibilité des projets pour Mecalux ============
alter table public.mecalux_projets add column if not exists visible_mecalux boolean not null default false;
create or replace function public.mecalux_voit_projet(p text) returns boolean language sql stable security definer set search_path = public as $$
  select public.mecalux_est_harington()
      or (public.mecalux_est_membre() and (p is null or exists (select 1 from public.mecalux_projets where id = p and visible_mecalux)));
$$;
drop policy if exists "equipe_tout" on public.mecalux_projets;
create policy "projets_harington" on public.mecalux_projets for all to authenticated using (public.mecalux_est_harington()) with check (public.mecalux_est_harington());
create policy "projets_mecalux" on public.mecalux_projets for all to authenticated using (public.mecalux_est_membre() and visible_mecalux) with check (public.mecalux_est_membre() and visible_mecalux);
-- affectations, temps, frais, calendrier, préfactures, estimations : policy "equipe_projet_visible" = mecalux_voit_projet(projet_id)
-- justificatifs : policy restrictive "mecalux_justifs_lecture_projet" (lecture limitée aux dépenses des projets visibles)

-- ============ Super user Harington et per diem ============
-- superuser : droits d'un utilisateur Harington + rubrique Per diem pour sa propre ressource (mecalux_equipe.ressource_id)
-- Per diem du mois = jours de mise en service × taux (Règles : perDiemSuper, 70 €) − dépenses Pleo classées personnelles (mecalux_frais.perso)
alter table public.mecalux_equipe drop constraint if exists mecalux_equipe_role_check;
alter table public.mecalux_equipe add constraint mecalux_equipe_role_check check (role in ('admin','superuser','harington','mecalux'));
alter table public.mecalux_equipe add column if not exists ressource_id text;
alter table public.mecalux_frais add column if not exists perso boolean not null default false;
-- table mecalux_perdiem (montant validé par ressource et par mois) : lecture/écriture par l'admin et par le super user pour sa ressource
-- prestations : phase 'pil' (Pilotage) autorisée dans mecalux_affectations et mecalux_temps

-- ============ Analyse des frais non facturés (interne Harington) ============
-- mecalux_analyse_pleo : dépenses Pleo (montant = coût, négatif = remboursement ; net = 0 pour une caution ou annulation neutralisée)
-- mecalux_analyse_factures : lignes des factures, avoirs et préfactures émises (mois de prestation, est_frais)
-- Lecture : Harington (admin, super user, utilisateur) ; import et attribution : admin. Attributions : mecalux_config 'analyse_attrib'.

-- ---------- Droits par rubrique et par profil (réglés par l'admin dans la page Accès) ----------
create table if not exists public.mecalux_droits (
  role text not null check (role in ('superuser','harington','mecalux')),
  rubrique text not null,
  autorise boolean not null,
  maj_le timestamptz not null default now(),
  primary key (role, rubrique)
);
alter table public.mecalux_droits enable row level security;
create policy "droits_lecture" on public.mecalux_droits for select to authenticated using (public.mecalux_est_membre());
create policy "droits_admin" on public.mecalux_droits for all to authenticated using (public.mecalux_role() = 'admin') with check (public.mecalux_role() = 'admin');
create or replace function public.mecalux_droit(rub text) returns boolean language sql stable security definer set search_path = public as $$
  select case when public.mecalux_role() = 'admin' then true
              when public.mecalux_role() is null then false
              else coalesce((select autorise from public.mecalux_droits where role = public.mecalux_role() and rubrique = rub), true) end;
$$;
create policy "prefactures_droit" on public.mecalux_prefactures as restrictive for all to authenticated
  using (public.mecalux_droit('prefactures')) with check (public.mecalux_droit('prefactures'));
create policy "estimations_droit" on public.mecalux_estimations as restrictive for all to authenticated
  using (public.mecalux_droit('calculateur')) with check (public.mecalux_droit('calculateur'));
alter publication supabase_realtime add table public.mecalux_droits;

-- ---------- Type de prestation PMO ----------
alter table public.mecalux_affectations drop constraint mecalux_affectations_phase_check;
alter table public.mecalux_affectations add constraint mecalux_affectations_phase_check check (phase in ('dev','mes','pil','pmo'));
alter table public.mecalux_temps drop constraint mecalux_temps_phase_check;
alter table public.mecalux_temps add constraint mecalux_temps_phase_check check (phase in ('dev','mes','pil','pmo'));

-- ---------- Circuit de validation des préfactures (migration mecalux_circuit_prefactures) ----------
-- Projets : cp_mecalux_prenom, cp_mecalux_nom, cp_mecalux_email, cp_harington_id (ressource).
-- Préfactures : fichiers jsonb {pdf, bdc, facture}, numero_facture ; statuts Brouillon → À vérifier ADV → Envoyée à Mecalux → BDC reçu → Facturée.
-- mecalux_circuit (role preparation | adv | adv_mecalux, nom, email) : lecture membres, écriture admin.
-- mecalux_pf_action(p_id, p_action, p_commentaire, p_bdc, p_fichier, p_numero) : seule voie pour changer le statut
--   soumettre (Harington) · adv_valider / adv_renvoyer (ADV Harington ou admin) · mecalux_valider / mecalux_refuser (ADV Mecalux ou admin)
--   facturer (ADV Harington ou admin) · rouvrir (admin). Chaque étape est journalisée dans mecalux_pf_evenements.
-- Déclencheur mecalux_pf_garde : statut, BDC, pièces et numéro de facture inchangeables hors circuit ; lignes figées hors brouillon.
-- Déclencheur notify_mecalux_pf : AFTER INSERT mecalux_pf_evenements → fonction mecalux-acces (mêmes en-têtes que notify_mecalux_demandes,
--   dont x-webhook-secret = <WEBHOOK_SECRET>) → e-mails Resend aux personnes de l'étape, avec la préfacture, le BDC ou la facture en pièce jointe.

-- ---------- Frais : statut « à vérifier » (non compté) ----------
alter table public.mecalux_frais drop constraint mecalux_frais_statut;
alter table public.mecalux_frais add constraint mecalux_frais_statut check (statut is null or statut in ('valide','ecarte','averifier'));

-- ---------- Type de prestation Hypercare ----------
alter table public.mecalux_affectations drop constraint mecalux_affectations_phase_check;
alter table public.mecalux_affectations add constraint mecalux_affectations_phase_check check (phase in ('dev','mes','pil','pmo','hyp'));
alter table public.mecalux_temps drop constraint mecalux_temps_phase_check;
alter table public.mecalux_temps add constraint mecalux_temps_phase_check check (phase in ('dev','mes','pil','pmo','hyp'));

-- ---------- Frais : auteur de la saisie (renseigné par la base, non modifiable) ----------
alter table public.mecalux_frais add column if not exists cree_par text, add column if not exists cree_le timestamptz;
create or replace function public.mecalux_frais_auteur() returns trigger language plpgsql set search_path = public as $$
declare j jsonb := coalesce(auth.jwt(), '{}'::jsonb); nom text;
begin
  if tg_op = 'INSERT' then
    nom := nullif(btrim(coalesce(j->'user_metadata'->>'prenom','') || ' ' || coalesce(j->'user_metadata'->>'nom','')), '');
    new.cree_par := coalesce(nom, j->>'email');
    new.cree_le := now();
  else
    new.cree_par := old.cree_par; new.cree_le := old.cree_le;
  end if;
  return new;
end $$;
create trigger mecalux_frais_auteur before insert or update on public.mecalux_frais for each row execute function public.mecalux_frais_auteur();

-- ---------- Frais par jour : types de journée retenus (hôtel, location…) ----------
alter table public.mecalux_frais add column if not exists types_jours jsonb;
