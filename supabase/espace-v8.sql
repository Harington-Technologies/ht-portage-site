-- =====================================================================
-- HT Portage — Sécurité v8 : double authentification obligatoire pour l'administration
-- Les droits d'administrateur (lecture de tous les dossiers, n° de sécurité sociale, IBAN, contrats…)
-- ne sont accordés qu'à une session qui a validé le code de l'application d'authentification (niveau « aal2»).
-- Un mot de passe administrateur volé ne suffit donc plus.
-- À lancer APRÈS avoir activé la double authentification sur le compte (page espace/securite.html).
-- Peut être relancé sans risque.
--
-- Téléphone perdu ? Dans l'éditeur SQL de Supabase :
--   delete from auth.mfa_factors where user_id = (select id from auth.users where email = 'wessafi@htportage.fr');
-- puis reconnectez-vous : l'espace proposera d'enregistrer un nouveau téléphone.
-- =====================================================================

-- Appartenance à l'équipe (sert seulement à orienter vers l'administration et la double authentification)
create or replace function public.compte_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;
revoke all on function public.compte_admin() from public;
grant execute on function public.compte_admin() to authenticated;

-- Droits d'administrateur : membre de l'équipe ET session validée par la double authentification
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admins where user_id = auth.uid())
     and coalesce(auth.jwt() ->> 'aal', '') = 'aal2';
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- Contrôle : le compte administrateur a-t-il un facteur vérifié ?
select u.email, count(f.id) filter (where f.status = 'verified') as facteurs_verifies
from public.admins a join auth.users u on u.id = a.user_id
left join auth.mfa_factors f on f.user_id = u.id
group by u.email;
