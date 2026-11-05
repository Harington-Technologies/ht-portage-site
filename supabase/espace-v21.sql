-- =====================================================================
-- HT Portage — v21 : synchronisation depuis VSP (étape 2 : notes de frais et déclenchement mensuel)
-- À exécuter une fois dans Supabase › SQL Editor, APRÈS espace-v20.sql. Peut être relancé sans risque.
-- =====================================================================

-- Notes de frais, recopiées de VSP (/v1/expenses) par la fonction vsp-sync. Lecture seule dans l'espace.
create table if not exists public.notes_frais (
  id           uuid primary key default gen_random_uuid(),
  vsp_id       text not null unique check (char_length(vsp_id) <= 100),
  user_id      uuid not null references auth.users (id) on delete cascade,
  mois         date not null check (extract(day from mois) = 1),
  date_frais   date,
  type         text check (char_length(type) <= 150),
  montant_ht   numeric(12, 2),
  montant_ttc  numeric(12, 2),
  devise       text not null default 'EUR' check (char_length(devise) <= 3),
  motif        text check (char_length(motif) <= 500),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists notes_frais_user_idx on public.notes_frais (user_id, mois desc);
alter table public.notes_frais enable row level security;
revoke all on public.notes_frais from anon, authenticated;
grant select on public.notes_frais to authenticated;
drop policy if exists notes_frais_lecture on public.notes_frais;
create policy notes_frais_lecture on public.notes_frais
  for select to authenticated using (user_id = auth.uid() or public.is_admin());
-- Pas d'écriture depuis le navigateur : seule la synchronisation (clé serveur) écrit.

create or replace function public.notes_frais_touch() returns trigger
language plpgsql set search_path = public as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists notes_frais_touch on public.notes_frais;
create trigger notes_frais_touch before update on public.notes_frais
  for each row execute function public.notes_frais_touch();

-- Déclenchement mensuel : chaque jour à 6 h (Paris, ≈ 5 h UTC), la fonction vérifie si tous les CRA
-- du mois écoulé sont validés ; si oui, elle synchronise ce mois une seule fois, sinon elle attend le lendemain.
select cron.unschedule(jobid) from cron.job where jobname = 'vsp-sync-mensuel';
select cron.schedule(
  'vsp-sync-mensuel',
  '0 5 * * *',
  $job$
  select net.http_post(
    url := 'https://krcsbskmttgmzzqjfudo.supabase.co/functions/v1/vsp-sync',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', public.vsp_sync_secret()),
    body := '{"action":"auto"}'::jsonb,
    timeout_milliseconds := 150000
  );
  $job$
);

-- Contrôle
select jobname, schedule, active from cron.job where jobname = 'vsp-sync-mensuel';
