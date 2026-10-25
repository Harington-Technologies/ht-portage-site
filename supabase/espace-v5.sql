-- =====================================================================
-- HT Portage — Espace consultant, v5
-- Correctif : le webhook Yousign (clé serveur) ne pouvait pas passer une mission en « active »
-- une fois l'annexe signée (le déclencheur le prenait pour un consultant).
-- Peut être relancé sans risque.
-- =====================================================================
create or replace function public.proteger_mission()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Traitements serveur (webhook Yousign, fonctions Edge avec la clé serveur, éditeur SQL) : pas de restriction
  if coalesce(auth.role(), 'service_role') = 'service_role' then
    if new.statut = 'validee' and (tg_op = 'INSERT' or old.statut is distinct from 'validee') then new.validee_le := now(); end if;
    new.updated_at := now();
    return new;
  end if;
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

-- Rattrapage : missions validées dont l'annexe est déjà signée par tout le monde
update public.consultant_missions m set statut = 'active'
where m.statut = 'validee'
  and exists (select 1 from public.documents d where d.mission_id = m.id and d.type = 'annexe' and d.statut = 'signe');

-- Contrôle
select numero_contrat, statut from public.consultant_missions order by numero_contrat;
