-- =====================================================================
-- HT Portage — v14 : reprise des consultants déjà en poste (VSP)
--  1. Table des invitations : lien personnel « Activer mon espace », valable 30 jours
--     (seule l'empreinte du lien est enregistrée, jamais le lien lui-même)
--  2. Les comptes créés par l'administration (fonction « consultants ») ne déclenchent pas
--     l'e-mail « Informations consultant modifiées » : seul le consultant lui-même le déclenche.
-- Peut être relancé sans risque.
-- =====================================================================

create table if not exists public.invitations (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  jeton_hash  text not null unique,
  envoye_le   timestamptz not null default now(),
  envoye_par  uuid references auth.users (id) on delete set null,
  expire_le   timestamptz not null default now() + interval '30 days',
  ouvert_le   timestamptz
);
alter table public.invitations enable row level security;
drop policy if exists "invitations_admin_lecture" on public.invitations;
create policy "invitations_admin_lecture" on public.invitations for select to authenticated using (public.is_admin());

-- E-mail « informations modifiées » : seulement quand la modification ne vient pas du serveur
do $$
declare
  def text;
begin
  select pg_get_triggerdef(oid) into def from pg_trigger where tgname = 'notify_profils' and not tgisinternal limit 1;
  if def is null then
    raise exception 'Déclencheur notify_profils introuvable : lancez d''abord espace-v12.sql.';
  end if;
  if position('WHEN' in def) = 0 then
    def := regexp_replace(def, 'FOR EACH ROW EXECUTE', 'FOR EACH ROW WHEN (coalesce(auth.role(), '''') <> ''service_role'') EXECUTE');
    if position('WHEN' in def) = 0 then
      raise exception 'Format de déclencheur inattendu : %', left(def, 160);
    end if;
    execute 'drop trigger if exists notify_profils on public.profils';
    execute def;
  end if;
end $$;

-- Contrôle : doit afficher la table invitations et un déclencheur notify_profils avec « WHEN »
select (select count(*) from public.invitations) as invitations,
       (select position('WHEN' in pg_get_triggerdef(oid)) > 0 from pg_trigger where tgname = 'notify_profils') as filtre_serveur;
