-- =====================================================================
-- HT Portage — v10 : téléphone de la personne recommandée (programme ambassadeur)
-- Peut être relancé sans risque.
-- =====================================================================
alter table public.recommandations add column if not exists contact_telephone text
  check (char_length(contact_telephone) <= 40);

-- Contrôle
select count(*) as recommandations, count(contact_telephone) as avec_telephone from public.recommandations;
