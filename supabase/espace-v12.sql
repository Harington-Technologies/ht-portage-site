-- =====================================================================
-- HT Portage — v12 : e-mail à l'équipe à chaque modification des informations d'un consultant
-- (même adresse et même en-tête secret que le déclencheur existant « notify_contacts »)
-- La fonction notify-lead n'envoie un e-mail que si une information personnelle a réellement changé.
-- Peut être relancé sans risque.
-- =====================================================================
do $$
declare
  def text;
begin
  select pg_get_triggerdef(oid) into def from pg_trigger where tgname = 'notify_contacts' and not tgisinternal limit 1;
  if def is null then
    raise exception 'Déclencheur notify_contacts introuvable : configurez d''abord les notifications du site.';
  end if;
  def := replace(def, 'CREATE TRIGGER notify_contacts', 'CREATE TRIGGER notify_profils');
  def := regexp_replace(def, 'AFTER INSERT ON public\.contacts', 'AFTER UPDATE ON public.profils');
  if position('profils' in def) = 0 then
    raise exception 'Format de déclencheur inattendu : %', left(def, 120);
  end if;
  execute 'drop trigger if exists notify_profils on public.profils';
  execute def;
end $$;

-- Contrôle : doit afficher notify_profils
select tgname from pg_trigger where tgname = 'notify_profils';
