# Site HT Portage

Site vitrine de HT Portage, filiale de Harington Technologies. Il comprend l'accueil, le simulateur de revenus, le programme Ambassadeur et les offres de missions.

Même recette que Cultikids : des pages **HTML/CSS/JS statiques** sans étape de compilation, et **Supabase** pour les formulaires, les CV et les missions.

## Contenu

```
index.html              Accueil + formulaire de contact
simulateur.html         Simulateur de revenus + demande de simulation détaillée
ambassadeur.html        Programme Ambassadeur + formulaire de recommandation
missions.html           Offres de missions (Supabase) + candidature avec CV
mentions-legales.html   Mentions légales (champs [À COMPLÉTER])
confidentialite.html    Politique de confidentialité RGPD (champs [À COMPLÉTER])
assets/css/style.css    Charte Harington (marine, rose, prune · Open Sans)
assets/js/config.js     URL et clé publique Supabase  ← à renseigner
assets/js/main.js       Menu mobile + envoi des formulaires
assets/js/simulateur.js Calcul du simulateur
assets/js/missions.js   Chargement et filtres des missions
assets/img/favicon.svg  Monogramme HTP (pastille rose)
supabase/schema.sql     Tables, sécurité RLS, bucket des CV
supabase/functions/notify-lead/  E-mail de notification (Resend) à chaque demande
```

## Mise en route

### 1. Supabase (≈ 10 min)
1. Créez un projet sur supabase.com, **région UE** (Paris ou Francfort).
2. Dans **SQL Editor**, collez et exécutez `supabase/schema.sql`. Cela crée :
   - les tables `contacts`, `candidatures`, `recommandations` et `missions` ;
   - le bucket privé `cv`.
3. Dans **Project Settings › API**, copiez le *Project URL* et la clé **anon public** dans `assets/js/config.js`.
   La clé `service_role` ne doit jamais apparaître dans le site.

Le site peut seulement **ajouter** des demandes et **lire** les missions publiées. Les demandes reçues se consultent dans **Table Editor**, et les CV dans **Storage › cv**.

### 2. Publier des missions
Dans **Table Editor › missions**, ajoutez une ligne pour chaque mission :
- `ref`, `titre` ;
- `domaine` : Développement, Data & IA, Cloud & DevOps ou Pilotage ;
- `resume`, `lieu`, `duree`, `rythme` ;
- `tjm` en texte libre (laissez vide pour « selon profil ») ;
- `publiee = true` pour l'afficher sur le site.

Tant que `config.js` est vide, la page Missions affiche des offres d'exemple.

### 3. Notifications par e-mail (facultatif, recommandé)
1. Installez la CLI Supabase, puis lancez :
   `supabase functions deploy notify-lead --no-verify-jwt`
2. Dans **Edge Functions › Secrets**, ajoutez :
   - `RESEND_API_KEY` ;
   - `NOTIFY_TO` (ex. `contact@htportage.fr`) ;
   - `NOTIFY_FROM` (un expéditeur vérifié dans Resend) ;
   - `WEBHOOK_SECRET` (une chaîne aléatoire).
3. Dans **Database › Webhooks**, créez un webhook :
   - événement *Insert* sur `contacts`, `candidatures` et `recommandations` ;
   - méthode POST vers l'URL de la fonction `notify-lead` ;
   - en-tête `x-webhook-secret: <WEBHOOK_SECRET>`.

Vous recevez alors un e-mail à chaque demande. Pour les candidatures, il contient un lien de téléchargement du CV valable 7 jours.

### 4. Mettre en ligne
Le site est statique : n'importe quel hébergement de fichiers convient.
- **GitHub Pages** : poussez le dossier dans un dépôt, puis activez *Settings › Pages › Deploy from branch (main, /root)*.
- **Netlify / Vercel / Scaleway / OVH** : déposez le dossier tel quel, sans commande de build.

Pour tester en local : `python3 -m http.server 8000` dans le dossier, puis ouvrez http://localhost:8000.

## À compléter avant la mise en ligne
- `assets/js/config.js` : URL et clé anon Supabase.
- Mentions légales : forme juridique, capital, adresse, RCS/SIRET, directeur de publication, **garantie financière**, hébergeur.
- Confidentialité : DPO, durées de conservation, région Supabase.
- Ambassadeur : modalités de versement, éligibilité, règles de cumul (champs `[À PRÉCISER]`).
- Pied de page : organisme de garantie financière.
- Missions : vos vraies offres dans Supabase.

## Hypothèses du simulateur
Le net est estimé à **67 % du chiffre d'affaires** (cible HT Portage), avec des frais de gestion fixes de **5 %**. La comparaison se fait avec un net de **~58 %** pour la moyenne du marché. Ces taux se règlent en haut de `assets/js/simulateur.js`. L'estimation est indicative et signalée comme telle sur la page.

## Espace consultant (`/espace/`)

Pages statiques + Supabase Auth (e-mail et mot de passe). Schéma : `supabase/espace.sql` (à exécuter après `schema.sql`).

- `connexion.html` / `reset.html` : connexion, inscription (reprend la simulation et le code de parrainage), mot de passe oublié
- `index.html` : tableau de bord · `informations.html` : profil (n° sécu, IBAN vérifiés)
- `contrats.html`, `reporting.html`, `ambassadeur.html` : documents, missions, comptes d'activité, recommandations
- `contractualisation.html`, `cv.html` : à venir (phases 2 et 4)
- `admin.html` : réservé aux comptes de la table `admins` (consultants, validation des missions, import CSV des comptes d'activité VSP, dépôt de documents, demandes reçues)

Sécurité : Row Level Security, chaque consultant ne voit que ses données ; fichiers dans le bucket privé `documents/<id du consultant>/`.
