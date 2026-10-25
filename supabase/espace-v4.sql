-- =====================================================================
-- HT Portage — Espace consultant, v4 : e-mail à HT Portage quand un dossier est envoyé
-- Crée un déclencheur sur consultant_missions qui appelle la fonction notify-lead,
-- en reprenant l'adresse et l'en-tête secret du déclencheur existant « notify_contacts ».
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
  def := replace(def, 'CREATE TRIGGER notify_contacts', 'CREATE TRIGGER notify_missions');
  def := regexp_replace(def, 'AFTER INSERT ON public\.contacts', 'AFTER INSERT OR UPDATE OF statut ON public.consultant_missions');
  if position('consultant_missions' in def) = 0 then
    raise exception 'Format de déclencheur inattendu : %', left(def, 120);
  end if;
  execute 'drop trigger if exists notify_missions on public.consultant_missions';
  execute def;
end $$;

-- Contrôle : doit afficher notify_missions
select tgname from pg_trigger where tgname = 'notify_missions';
