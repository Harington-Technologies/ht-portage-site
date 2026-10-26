-- =====================================================================
-- HT Portage — v13 : frais professionnels et taux de prélèvement à la source des simulations
-- (servent à construire l'exemple de bulletin de salaire envoyé au candidat)
-- Peut être relancé sans risque.
-- =====================================================================
alter table public.contacts add column if not exists frais_pro integer check (frais_pro between 0 and 100000);
alter table public.contacts add column if not exists taux_pas numeric(4, 1) check (taux_pas between 0 and 45);

select column_name from information_schema.columns where table_name = 'contacts' and column_name in ('frais_pro', 'taux_pas');
