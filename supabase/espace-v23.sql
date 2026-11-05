-- =====================================================================
-- HT Portage — v23 : validation des notes de frais douteuses
-- À exécuter une fois dans Supabase › SQL Editor, APRÈS espace-v21.sql. Peut être relancé sans risque.
-- Un administrateur valide une ligne signalée : elle ne ressort plus en anomalie.
-- Le montant validé est mémorisé : si VSP change le montant, la validation ne vaut plus.
-- La synchronisation ne touche pas à ces colonnes (elle n'écrit que les colonnes venant de VSP).
-- =====================================================================
alter table public.notes_frais add column if not exists valide_le          timestamptz;
alter table public.notes_frais add column if not exists valide_par         text check (char_length(valide_par) <= 200);
alter table public.notes_frais add column if not exists valide_montant     numeric(12, 2);
alter table public.notes_frais add column if not exists valide_commentaire text check (char_length(valide_commentaire) <= 500);

-- Valider (p_valider = true) ou annuler la validation (false). Réservé aux administrateurs (double authentification).
create or replace function public.valider_note_frais(p_id uuid, p_valider boolean, p_commentaire text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  qui text;
begin
  if not public.is_admin() then
    raise exception 'Réservé aux administrateurs HT Portage.';
  end if;
  if p_valider then
    select coalesce(nullif(trim(coalesce(prenom, '') || ' ' || coalesce(nom, '')), ''), email) into qui
      from public.profils where id = auth.uid();
    update public.notes_frais
       set valide_le = now(), valide_par = left(coalesce(qui, 'administrateur'), 200),
           valide_montant = montant_ttc, valide_commentaire = left(nullif(trim(p_commentaire), ''), 500)
     where id = p_id;
  else
    update public.notes_frais
       set valide_le = null, valide_par = null, valide_montant = null, valide_commentaire = null
     where id = p_id;
  end if;
end $$;
revoke all on function public.valider_note_frais(uuid, boolean, text) from public, anon;
grant execute on function public.valider_note_frais(uuid, boolean, text) to authenticated;

-- Contrôle
select count(*) filter (where column_name like 'valide_%') as colonnes_validation
  from information_schema.columns where table_schema = 'public' and table_name = 'notes_frais';
