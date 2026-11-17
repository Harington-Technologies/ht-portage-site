-- =====================================================================
-- Pilotage Mecalux · MODE DÉVELOPPEMENT (accès sans connexion)
-- Appliqué le 14/11/2026 (migration mecalux_mode_dev_acces_anonyme) parce que
-- la connexion (Cloudflare Turnstile) ne passait pas pendant le développement.
-- Tant que ce mode est actif, toute personne qui a l'adresse de la page peut lire
-- et modifier les tables mecalux_* (sauf mecalux_equipe).
-- =====================================================================

-- ---------- Activation (déjà fait) ----------
do $$
declare t text;
begin
  foreach t in array array['mecalux_ressources','mecalux_projets','mecalux_affectations','mecalux_temps','mecalux_frais','mecalux_estimations','mecalux_prefactures','mecalux_config','mecalux_calendrier','mecalux_imports']
  loop
    execute format('drop policy if exists "dev_anon_tout" on public.%I', t);
    execute format('create policy "dev_anon_tout" on public.%I for all to anon using (true) with check (true)', t);
    execute format('grant select, insert, update, delete on public.%I to anon', t);
  end loop;
end $$;

-- ---------- Retour au mode sécurisé (à exécuter avant la mise en service) ----------
-- 1. Exécuter ce bloc dans Supabase › SQL Editor.
-- 2. Dans mecalux/index.html, passer MODE_DEV à false.
--
-- do $$
-- declare t text;
-- begin
--   foreach t in array array['mecalux_ressources','mecalux_projets','mecalux_affectations','mecalux_temps','mecalux_frais','mecalux_estimations','mecalux_prefactures','mecalux_config','mecalux_calendrier','mecalux_imports']
--   loop
--     execute format('drop policy if exists "dev_anon_tout" on public.%I', t);
--     execute format('revoke insert, update, delete on public.%I from anon', t);
--   end loop;
-- end $$;
-- drop policy if exists "mecalux_justifs_dev_anon" on storage.objects;

-- Justificatifs (bucket privé mecalux-justifs) : accès anonyme temporaire, supprimé par le bloc ci-dessus
-- create policy "mecalux_justifs_dev_anon" on storage.objects for all to anon
--   using (bucket_id = 'mecalux-justifs') with check (bucket_id = 'mecalux-justifs');

-- 17/11/2026 : mode développement terminé (politiques anonymes supprimées, accès anonyme révoqué).
