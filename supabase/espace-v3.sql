-- =====================================================================
-- HT Portage — Espace consultant, v3 : signature électronique (Yousign)
-- À exécuter une fois dans Supabase › SQL Editor, APRÈS espace-v2.sql.
-- Peut être relancé sans risque.
-- =====================================================================

-- Suivi des demandes de signature Yousign sur les documents
alter table public.documents add column if not exists yousign_sr_id  text unique check (char_length(yousign_sr_id) <= 100);
alter table public.documents add column if not exists yousign_statut text check (char_length(yousign_statut) <= 50);
alter table public.documents add column if not exists envoye_le      timestamptz;
alter table public.documents add column if not exists signe_le       timestamptz;

-- Statuts possibles d'un document : ajout de « refusé » et « annulé »
alter table public.documents drop constraint if exists documents_statut_check;
alter table public.documents add constraint documents_statut_check
  check (statut in ('en_preparation', 'a_signer', 'signe', 'disponible', 'refuse', 'annule'));

-- Événements Yousign déjà traités (une notification peut arriver plusieurs fois)
create table if not exists public.yousign_evenements (
  event_id    text primary key,
  recu_le     timestamptz not null default now(),
  event_name  text,
  sr_id       text
);
alter table public.yousign_evenements enable row level security;
revoke all on public.yousign_evenements from anon, authenticated;
