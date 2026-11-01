# Contrats HT Portage

- `modeles/cdi.docx`, `modeles/annexe.docx` : modèles « à remplir » utilisés par la fonction Supabase `contrats` (balises `[[champ]]`, repères de signature `{{sN|signature|l|h}}` en blanc, transformés en zones de signature par Firma.dev (paramètre anchor_tags)).
- `generateur/build.js` : génère les modèles. `node build.js` (vierges) puis `MODE=modele node build.js` (à remplir). Après une modification du texte, recalculer les pages du sommaire avec `pages.py`, puis régénérer.

Signataires : CDI = s1 consultant, s2 HT Portage · Annexe = s1 consultant, s2 client, s3 HT Portage.

Signature électronique : Firma.dev (fonctions `contrats` et `firma-webhook`). Firma convertit le .docx en PDF A4 avant signature ; les images du .docx (logo) ne sont pas reprises.
