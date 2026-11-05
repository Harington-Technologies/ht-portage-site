-- =====================================================================
-- HT Portage — v22 : suivi d'avancement de la synchronisation VSP
-- À exécuter une fois dans Supabase › SQL Editor, APRÈS espace-v21.sql. Peut être relancé sans risque.
-- La fonction vsp-sync y écrit l'avancement de chaque tâche ; l'administration le lit pour
-- afficher la progression et bloquer un second passage pendant qu'un premier écrit.
-- =====================================================================
create table if not exists public.vsp_sync_suivi (
  id       uuid primary key,
  debut    timestamptz not null default now(),
  maj      timestamptz not null default now(),
  par      text,
  action   text,
  fini     boolean not null default false,
  etapes   jsonb not null default '{}'::jsonb
);
create index if not exists vsp_sync_suivi_actif_idx on public.vsp_sync_suivi (fini, maj desc);
alter table public.vsp_sync_suivi enable row level security;
revoke all on public.vsp_sync_suivi from anon, authenticated;
grant select on public.vsp_sync_suivi to authenticated;
drop policy if exists vsp_sync_suivi_admin on public.vsp_sync_suivi;
create policy vsp_sync_suivi_admin on public.vsp_sync_suivi for select to authenticated using ((select public.is_admin()));

-- Contrôle
select count(*) as table_suivi from information_schema.tables where table_name = 'vsp_sync_suivi';
