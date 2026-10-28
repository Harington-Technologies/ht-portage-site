-- =====================================================================
-- HT Portage — v17
--  1. Mesure d'audience sans cookie (table « mesures », écrite par la fonction « formulaire »)
--  2. Offres d'emploi gérées depuis l'administration (table « missions »)
--  3. Journal des actions (administrateurs et traitements automatiques), en lecture seule
--  4. Purge RGPD automatique chaque nuit (durées de la politique de confidentialité)
-- Peut être relancé sans risque.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Mesure d'audience : aucune donnée personnelle (ni adresse IP, ni cookie, ni identifiant)
-- ---------------------------------------------------------------------
create table if not exists public.mesures (
  id         bigserial primary key,
  cree_le    timestamptz not null default now(),
  page       text not null check (char_length(page) <= 100),
  evenement  text not null check (evenement in ('vue', 'simulation', 'clic_espace', 'clic_rappel')),
  source     text check (char_length(source) <= 100),
  appareil   text check (appareil in ('mobile', 'ordinateur'))
);
create index if not exists mesures_date_idx on public.mesures (cree_le desc);
alter table public.mesures enable row level security;
revoke all on public.mesures from anon, authenticated;
grant select on public.mesures to authenticated;
drop policy if exists "mesures_admin" on public.mesures;
create policy "mesures_admin" on public.mesures for select to authenticated using (public.is_admin());

-- ---------------------------------------------------------------------
-- 2. Offres d'emploi : lecture publique des offres publiées (inchangée), gestion par l'administration
-- ---------------------------------------------------------------------
alter table public.missions add column if not exists updated_at timestamptz not null default now();
grant select, insert, update, delete on public.missions to authenticated;
drop policy if exists "missions_admin" on public.missions;
create policy "missions_admin" on public.missions for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------
-- 3. Journal des actions
-- ---------------------------------------------------------------------
create table if not exists public.journal (
  id           bigserial primary key,
  quand        timestamptz not null default now(),
  auteur       uuid,
  auteur_nom   text,
  action       text not null,
  objet        text not null,
  cible_id     text,
  concerne     uuid,
  resume       text
);
create index if not exists journal_quand_idx on public.journal (quand desc);
alter table public.journal enable row level security;
revoke all on public.journal from anon, authenticated;
grant select on public.journal to authenticated;
drop policy if exists "journal_admin" on public.journal;
create policy "journal_admin" on public.journal for select to authenticated using (public.is_admin());

create or replace function public.journaliser()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  role text := coalesce(auth.role(), 'service_role');
  est_admin boolean := uid is not null and exists (select 1 from public.admins where user_id = uid);
  ancien jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  nouveau jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  ligne jsonb := coalesce(nouveau, ancien);
  changes text := '';
  k text;
  libelle text;
begin
  -- Seules les actions des administrateurs et des traitements serveur sont journalisées
  if not est_admin and role <> 'service_role' then return null; end if;
  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(nouveau) loop
      continue when k in ('updated_at', 'created_at');
      if (ancien -> k) is distinct from (nouveau -> k) then
        if k in ('num_secu', 'iban', 'bic') then
          changes := changes || k || ' modifié ; ';
        else
          changes := changes || k || ' : ' || coalesce(left(ancien ->> k, 60), '∅') || ' → ' || coalesce(left(nouveau ->> k, 60), '∅') || ' ; ';
        end if;
      end if;
    end loop;
    if changes = '' then return null; end if;
  end if;
  libelle := coalesce(ligne ->> 'titre', ligne ->> 'intitule', nullif(trim(coalesce(ligne ->> 'prenom', '') || ' ' || coalesce(ligne ->> 'nom', '')), ''),
                      ligne ->> 'contact_nom', ligne ->> 'email', ligne ->> 'ref');
  insert into public.journal (auteur, auteur_nom, action, objet, cible_id, concerne, resume)
  values (
    uid,
    case when est_admin then (select coalesce(nullif(trim(coalesce(p.prenom, '') || ' ' || coalesce(p.nom, '')), ''), p.email) from public.profils p where p.id = uid) else 'Système' end,
    case tg_op when 'INSERT' then 'ajout' when 'UPDATE' then 'modification' else 'suppression' end,
    tg_table_name,
    coalesce(ligne ->> 'id', ligne ->> 'user_id'),
    coalesce((ligne ->> 'user_id')::uuid, case when tg_table_name = 'profils' then (ligne ->> 'id')::uuid end),
    left(coalesce(libelle, '') || case when changes <> '' then ' — ' || rtrim(changes, ' ;') else '' end, 1000)
  );
  return null;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['profils', 'consultant_missions', 'documents', 'contacts', 'candidatures', 'recommandations', 'missions', 'admins'] loop
    execute format('drop trigger if exists journal_%1$s on public.%1$I', t);
    execute format('create trigger journal_%1$s after insert or update or delete on public.%1$I for each row execute function public.journaliser()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 4. Purge RGPD (politique de confidentialité) : chaque nuit à 3 h 17
--    contacts et simulations : 3 ans · candidatures et CV : 2 ans · recommandations : 3 ans
--    mesures d'audience : 13 mois · journal : 3 ans
--    Les CV ne peuvent pas être effacés en SQL : ils sont mis en file d'attente et effacés
--    automatiquement à la prochaine ouverture de l'administration.
-- ---------------------------------------------------------------------
create table if not exists public.fichiers_a_effacer (
  id        bigserial primary key,
  bucket    text not null,
  chemin    text not null,
  ajoute_le timestamptz not null default now()
);
alter table public.fichiers_a_effacer enable row level security;
revoke all on public.fichiers_a_effacer from anon, authenticated;
grant select, delete on public.fichiers_a_effacer to authenticated;
drop policy if exists "fichiers_admin" on public.fichiers_a_effacer;
create policy "fichiers_admin" on public.fichiers_a_effacer for all to authenticated using (public.is_admin()) with check (public.is_admin());

create or replace function public.purge_rgpd()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  n_contacts int; n_cands int; n_recos int; n_mesures int; n_journal int;
begin
  delete from public.contacts where created_at < now() - interval '3 years';
  get diagnostics n_contacts = row_count;
  with sup as (delete from public.candidatures where created_at < now() - interval '2 years' returning cv_path)
  insert into public.fichiers_a_effacer (bucket, chemin) select 'cv', cv_path from sup where cv_path is not null;
  get diagnostics n_cands = row_count;
  delete from public.recommandations where created_at < now() - interval '3 years';
  get diagnostics n_recos = row_count;
  delete from public.mesures where cree_le < now() - interval '13 months';
  get diagnostics n_mesures = row_count;
  delete from public.journal where quand < now() - interval '3 years';
  get diagnostics n_journal = row_count;
  if n_contacts + n_cands + n_recos > 0 then
    insert into public.journal (auteur_nom, action, objet, resume)
    values ('Système', 'purge', 'rgpd', format('%s contact(s), %s candidature(s), %s recommandation(s) supprimés (durées de conservation)', n_contacts, n_cands, n_recos));
  end if;
  return jsonb_build_object('contacts', n_contacts, 'candidatures', n_cands, 'recommandations', n_recos, 'mesures', n_mesures, 'journal', n_journal);
end;
$$;
revoke all on function public.purge_rgpd() from public, anon, authenticated;

create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule('htp-purge-rgpd', '17 3 * * *', 'select public.purge_rgpd()');

-- Contrôle
select (select count(*) from cron.job where jobname = 'htp-purge-rgpd') as purge_programmee,
       (select count(*) from pg_trigger where tgname like 'journal_%') as declencheurs_journal,
       to_regclass('public.mesures') is not null as table_mesures;
