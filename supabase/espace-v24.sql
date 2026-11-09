-- =====================================================================
-- HT Portage — v24 : notes de frais, présence d'un justificatif (lu dans VSP par vsp-sync)
-- À exécuter une fois dans Supabase › SQL Editor, APRÈS espace-v23.sql. Peut être relancé sans risque.
-- =====================================================================
-- true  = au moins une pièce jointe dans VSP ; false = aucune ; null = information non fournie par VSP
alter table public.notes_frais add column if not exists justificatif boolean;
select 'ok' as resultat;
