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
