-- =====================================================================
-- HT Portage — v11 : programme ambassadeur
--  1. Chaque changement de statut d'une recommandation déclenche un e-mail de suivi à l'ambassadeur
--     (même adresse et même en-tête secret que le déclencheur existant « notify_contacts »)
--  2. Un ambassadeur retrouve dans son espace les recommandations faites avec son adresse e-mail,
--     y compris celles envoyées depuis le formulaire public avant la création de son compte
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
  def := replace(def, 'CREATE TRIGGER notify_contacts', 'CREATE TRIGGER notify_recos_suivi');
  def := regexp_replace(def, 'AFTER INSERT ON public\.contacts', 'AFTER UPDATE OF statut ON public.recommandations');
  if position('recommandations' in def) = 0 then
    raise exception 'Format de déclencheur inattendu : %', left(def, 120);
  end if;
  execute 'drop trigger if exists notify_recos_suivi on public.recommandations';
  execute def;
end $$;

drop policy if exists "reco_lecture" on public.recommandations;
create policy "reco_lecture" on public.recommandations
  for select to authenticated
  using (user_id = auth.uid() or lower(ambassadeur_email) = lower(auth.email()) or public.is_admin());

-- Contrôle : doit afficher notify_recos_suivi
select tgname from pg_trigger where tgname = 'notify_recos_suivi';
