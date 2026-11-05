-- =====================================================================
-- HT Portage — v20 : synchronisation depuis VSP (étape 1 : suivi et accès serveur)
-- À exécuter une fois dans Supabase › SQL Editor. Peut être relancé sans risque.
-- =====================================================================

-- Historique des passages de la fonction vsp-sync (exploration, aperçu, synchronisation)
create table if not exists public.vsp_sync_runs (
  id         bigserial primary key,
  quand      timestamptz not null default now(),
  action     text not null check (char_length(action) <= 30),
  mois       date,
  par        text,
  statut     text not null check (statut in ('ok', 'erreur', 'partiel')),
  duree_ms   integer,
  resultat   jsonb
);
create index if not exists vsp_sync_runs_quand_idx on public.vsp_sync_runs (quand desc);
alter table public.vsp_sync_runs enable row level security;
revoke all on public.vsp_sync_runs from anon, authenticated;
grant select on public.vsp_sync_runs to authenticated;
drop policy if exists vsp_sync_runs_admin on public.vsp_sync_runs;
create policy vsp_sync_runs_admin on public.vsp_sync_runs for select to authenticated using ((select public.is_admin()));

-- Secret des appels serveur (déclenchement mensuel) : généré ici, gardé dans le coffre (Vault),
-- jamais affiché ni recopié. Seule la clé serveur de la fonction peut le lire.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'vsp_sync_cron') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'vsp_sync_cron', 'Appels serveur de la fonction vsp-sync');
  end if;
end $$;

create or replace function public.vsp_sync_secret()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'vsp_sync_cron';
$$;
revoke all on function public.vsp_sync_secret() from public, anon, authenticated;
grant execute on function public.vsp_sync_secret() to service_role;

-- Contrôle
select (select count(*) from vault.secrets where name = 'vsp_sync_cron') as secret_cree,
       (select count(*) from pg_extension where extname = 'pg_net') as pg_net,
       (select count(*) from pg_extension where extname = 'pg_cron') as pg_cron;
