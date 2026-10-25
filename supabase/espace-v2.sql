-- =====================================================================
-- HT Portage — Espace consultant, v2 : contractualisation (étape A)
-- À exécuter une fois dans Supabase › SQL Editor, APRÈS espace.sql.
-- Peut être relancé sans risque.
-- =====================================================================

-- Champs nécessaires au remplissage du CDI et de l'annexe 1
alter table public.consultant_missions add column if not exists client_adresse              text check (char_length(client_adresse) <= 300);
alter table public.consultant_missions add column if not exists client_representant         text check (char_length(client_representant) <= 200);
alter table public.consultant_missions add column if not exists client_representant_qualite text check (char_length(client_representant_qualite) <= 200);
alter table public.consultant_missions add column if not exists client_signataire_email     text check (char_length(client_signataire_email) <= 254);
alter table public.consultant_missions add column if not exists adresse_execution           text check (char_length(adresse_execution) <= 300);
-- Renseignés par HT Portage à la validation
alter table public.consultant_missions add column if not exists numero_contrat              text check (char_length(numero_contrat) <= 50);
alter table public.consultant_missions add column if not exists frais_gestion               numeric(4, 2) not null default 5 check (frais_gestion between 0 and 30);
alter table public.consultant_missions add column if not exists htp_interlocuteur_nom       text check (char_length(htp_interlocuteur_nom) <= 200);
alter table public.consultant_missions add column if not exists htp_interlocuteur_tel       text check (char_length(htp_interlocuteur_tel) <= 40);
alter table public.consultant_missions add column if not exists htp_interlocuteur_email     text check (char_length(htp_interlocuteur_email) <= 254);
alter table public.consultant_missions add column if not exists commentaire_admin           text check (char_length(commentaire_admin) <= 2000);
alter table public.consultant_missions add column if not exists soumise_le                  timestamptz;
alter table public.consultant_missions add column if not exists validee_le                  timestamptz;

-- Protection : le consultant ne touche ni aux champs HT Portage, ni à une mission envoyée
create or replace function public.proteger_mission()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    if tg_op = 'INSERT' then
      new.user_id := auth.uid();
      new.vsp_id := null;
      if new.statut not in ('brouillon', 'a_valider') then new.statut := 'brouillon'; end if;
      new.numero_contrat := null; new.frais_gestion := 5; new.commentaire_admin := null;
      new.htp_interlocuteur_nom := null; new.htp_interlocuteur_tel := null; new.htp_interlocuteur_email := null;
      new.validee_le := null;
    else
      if old.statut <> 'brouillon' then
        raise exception 'Cette mission est en cours de validation : elle ne peut plus être modifiée.';
      end if;
      new.user_id := old.user_id; new.vsp_id := old.vsp_id; new.created_at := old.created_at;
      new.numero_contrat := old.numero_contrat; new.frais_gestion := old.frais_gestion; new.commentaire_admin := old.commentaire_admin;
      new.htp_interlocuteur_nom := old.htp_interlocuteur_nom; new.htp_interlocuteur_tel := old.htp_interlocuteur_tel;
      new.htp_interlocuteur_email := old.htp_interlocuteur_email; new.validee_le := old.validee_le;
      if new.statut not in ('brouillon', 'a_valider') then new.statut := old.statut; end if;
    end if;
    if new.statut = 'a_valider' and (tg_op = 'INSERT' or old.statut <> 'a_valider') then new.soumise_le := now(); end if;
  else
    if new.statut = 'validee' and (tg_op = 'INSERT' or old.statut is distinct from 'validee') then new.validee_le := now(); end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
