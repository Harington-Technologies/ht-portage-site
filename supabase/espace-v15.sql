-- HT Portage — v15 : part frais professionnels et part salaire chargé dans les comptes d'activité
alter table public.comptes_activite add column if not exists frais_pro numeric(12, 2);
alter table public.comptes_activite add column if not exists salaire_charge numeric(12, 2);
comment on column public.comptes_activite.frais_pro is 'Frais professionnels remboursés (bulletin)';
comment on column public.comptes_activite.salaire_charge is 'Salaire chargé : brut + charges patronales (bulletin)';
-- Les montants sont lus dans les bulletins de paie à l'import (« Migration depuis VSP »).
