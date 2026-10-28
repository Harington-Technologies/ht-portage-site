-- =====================================================================
-- HT Portage — v16 : suppression par l'administration
--  • demandes reçues (contacts et simulations, candidatures, recommandations) et CV associés
--  • (missions, documents et fichiers des consultants : déjà permis aux administrateurs)
--  • la suppression d'un compte consultant passe par la fonction « consultants » (clé serveur)
-- Peut être relancé sans risque.
-- =====================================================================

grant delete on public.contacts, public.candidatures, public.recommandations to authenticated;

drop policy if exists "contacts_admin_suppr" on public.contacts;
create policy "contacts_admin_suppr" on public.contacts for delete to authenticated using (public.is_admin());

drop policy if exists "candidatures_admin_suppr" on public.candidatures;
create policy "candidatures_admin_suppr" on public.candidatures for delete to authenticated using (public.is_admin());

drop policy if exists "reco_admin_suppr" on public.recommandations;
create policy "reco_admin_suppr" on public.recommandations for delete to authenticated using (public.is_admin());

drop policy if exists "cv_admin_suppr" on storage.objects;
create policy "cv_admin_suppr" on storage.objects for delete to authenticated using (bucket_id = 'cv' and public.is_admin());

-- Contrôle : doit afficher les 4 règles
select policyname from pg_policies where policyname in ('contacts_admin_suppr', 'candidatures_admin_suppr', 'reco_admin_suppr', 'cv_admin_suppr');
