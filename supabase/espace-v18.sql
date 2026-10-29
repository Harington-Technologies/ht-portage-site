-- =====================================================================
-- HT Portage — v18 : Doc-converter (CV au format HT Portage)
-- Les CV convertis sont enregistrés par la fonction « cv » ; chacun retrouve les siens,
-- l'équipe les voit tous. Conservation : 2 ans (comme les candidatures).
-- Peut être relancé sans risque.
-- =====================================================================

create table if not exists public.cvs (
  id              uuid primary key default gen_random_uuid(),
  cree_le         timestamptz not null default now(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  candidature_id  uuid,
  source_nom      text,
  candidat_nom    text,
  offre_ref       text,
  options         jsonb not null default '{}'::jsonb,
  donnees         jsonb not null
);
create index if not exists cvs_user_idx on public.cvs (user_id, cree_le desc);
alter table public.cvs enable row level security;
revoke all on public.cvs from anon, authenticated;
grant select, delete on public.cvs to authenticated;
drop policy if exists "cvs_lecture" on public.cvs;
create policy "cvs_lecture" on public.cvs for select to authenticated using (user_id = auth.uid() or public.is_admin());
drop policy if exists "cvs_suppression" on public.cvs;
create policy "cvs_suppression" on public.cvs for delete to authenticated using (user_id = auth.uid() or public.is_admin());

-- Purge RGPD : CV convertis de plus de 2 ans
create or replace function public.purge_cvs() returns void language sql security definer set search_path = public as $$
  delete from public.cvs where cree_le < now() - interval '2 years';
$$;
revoke all on function public.purge_cvs() from public, anon, authenticated;
select cron.schedule('htp-purge-cvs', '27 3 * * *', 'select public.purge_cvs()');

-- Contrôle
select to_regclass('public.cvs') is not null as table_cvs, (select count(*) from cron.job where jobname = 'htp-purge-cvs') as purge;

-- Les consultants connectés voient aussi les offres publiées (adaptation de leur CV à une offre)
drop policy if exists "missions_lecture_connecte" on public.missions;
create policy "missions_lecture_connecte" on public.missions for select to authenticated using (publiee);
