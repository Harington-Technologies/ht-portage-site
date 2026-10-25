-- =====================================================================
-- HT Portage — Sécurité v7 : protection contre les envois en masse
--  1. Compteur de limites (par IP, par e-mail, par compte) utilisé par la fonction « formulaire »
--  2. Les visiteurs anonymes n'écrivent plus directement dans la base : tout passe par la fonction
--     « formulaire » (piège à robots, captcha, limites). À lancer APRÈS la mise en ligne du site.
--  3. Limite de 10 recommandations par heure pour un compte de l'espace
-- Peut être relancé sans risque.
-- =====================================================================

create table if not exists public.limites (
  cle  text not null check (char_length(cle) <= 300),
  at   timestamptz not null default now()
);
create index if not exists limites_cle_idx on public.limites (cle, at);
alter table public.limites enable row level security;
revoke all on public.limites from anon, authenticated;

-- Renvoie true si l'action est autorisée (et la compte), false si la limite est atteinte.
create or replace function public.limiter(p_cle text, p_max integer, p_fenetre integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  -- verrou par clé : deux envois simultanés ne passent pas tous les deux sous la limite
  perform pg_advisory_xact_lock(hashtext(p_cle));
  select count(*) into n from public.limites where cle = p_cle and at > now() - make_interval(secs => p_fenetre);
  if n >= p_max then
    return false;
  end if;
  insert into public.limites (cle) values (p_cle);
  -- ménage occasionnel
  if random() < 0.02 then
    delete from public.limites where at < now() - interval '2 days';
  end if;
  return true;
end;
$$;
revoke all on function public.limiter(text, integer, integer) from public, anon, authenticated;
grant execute on function public.limiter(text, integer, integer) to service_role;

-- Comptes de l'espace : 10 recommandations par heure au maximum
create or replace function public.limiter_reco_connecte()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and not public.is_admin()
     and not public.limiter('reco:' || auth.uid()::text, 10, 3600) then
    raise exception 'Vous avez envoyé beaucoup de recommandations récemment : réessayez dans une heure.';
  end if;
  return new;
end;
$$;
drop trigger if exists limiter_reco_connecte on public.recommandations;
create trigger limiter_reco_connecte
  before insert on public.recommandations
  for each row execute function public.limiter_reco_connecte();

-- Plus d'écriture anonyme directe : formulaires et CV passent par la fonction « formulaire »
drop policy if exists "site_insert_contacts" on public.contacts;
drop policy if exists "site_insert_candidatures" on public.candidatures;
drop policy if exists "site_insert_recommandations" on public.recommandations;
drop policy if exists "site_upload_cv" on storage.objects;
revoke insert on public.contacts, public.candidatures, public.recommandations from anon;

-- Contrôle : doit afficher 0 politique d'insertion anonyme et la fonction limiter
select
  (select count(*) from pg_policies where policyname like 'site_insert_%' or policyname = 'site_upload_cv') as politiques_anonymes_restantes,
  (select count(*) from pg_proc where proname = 'limiter') as fonction_limiter;
