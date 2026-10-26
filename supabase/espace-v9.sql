-- =====================================================================
-- HT Portage — v9 : nouveaux administrateurs
--   Zakia Chafai  — adv@htportage.fr
--   Aymen Ben Ayed — abenayed@htportage.fr
-- Prérequis : chacun a d'abord créé son compte sur https://www.htportage.fr/espace/connexion.html
-- (« Créer mon espace ») et cliqué sur le lien de confirmation reçu par e-mail.
-- À la première connexion, l'administration leur demandera d'activer la double authentification.
-- Peut être relancé sans risque (par exemple quand le second compte a été créé).
-- =====================================================================

-- Liste des comptes administrateurs, visible uniquement par un administrateur
-- (sert à ne pas les afficher parmi les candidats et consultants)
create or replace function public.ids_admins()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select user_id from public.admins where public.is_admin();
$$;
revoke all on function public.ids_admins() from public;
grant execute on function public.ids_admins() to authenticated;

-- Ajout des administrateurs
insert into public.admins (user_id)
select id from auth.users where lower(email) in ('adv@htportage.fr', 'abenayed@htportage.fr')
on conflict do nothing;

-- Noms dans leur profil (s'ils ne les ont pas déjà saisis)
update public.profils set prenom = coalesce(prenom, 'Zakia'), nom = coalesce(nom, 'Chafai') where lower(email) = 'adv@htportage.fr';
update public.profils set prenom = coalesce(prenom, 'Aymen'), nom = coalesce(nom, 'Ben Ayed') where lower(email) = 'abenayed@htportage.fr';

-- Contrôle : chaque adresse doit apparaître avec compte_cree = true et administrateur = true
select x.email,
       u.id is not null as compte_cree,
       u.email_confirmed_at is not null as email_confirme,
       a.user_id is not null as administrateur
from (values ('adv@htportage.fr'), ('abenayed@htportage.fr')) as x(email)
left join auth.users u on lower(u.email) = x.email
left join public.admins a on a.user_id = u.id;
