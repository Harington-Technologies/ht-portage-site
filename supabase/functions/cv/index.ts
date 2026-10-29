// HT Portage — Doc-converter : CV remis au format HT Portage (et adapté à une mission si demandé).
// Appelée depuis l'espace (consultant connecté) ou l'administration.
//   POST { fichier?: { nom, type: "application/pdf", base64 }, texte?: string,
//          options: { anonyme?: boolean, masquer_clients?: boolean, langue?: "fr" | "en",
//                     offre_ref?: string, offre_texte?: string, consignes?: string },
//          candidature_id?: string }
//   → { cv: {...}, id }   (structure décrite par OUTIL.input_schema)
// L'analyse est faite par l'API Claude (Anthropic). Rien n'est inventé : seules les informations du CV sont reprises.
//
// Secrets : ANTHROPIC_API_KEY (obligatoire), CV_MODELE (facultatif, défaut claude-sonnet-5-5).
// Déploiement : « Verify JWT » désactivé — l'identité est vérifiée ici (getUser).

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const CLE = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const MODELE = Deno.env.get("CV_MODELE") || "claude-sonnet-5-5";
const MAX_FICHIER = 6 * 1024 * 1024;

function serverKey(): string {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
    const vals = Array.isArray(keys) ? keys : Object.values(keys);
    return (vals.map((v: unknown) => typeof v === "string" ? v : (v as { key?: string })?.key).find(Boolean) as string) ?? "";
  } catch { return ""; }
}
const admin = createClient(Deno.env.get("SUPABASE_URL") ?? "http://localhost", serverKey() || "x", { auth: { persistSession: false } });
const json = (corps: unknown, status = 200) => new Response(JSON.stringify(corps), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// ---------------------------------------------------------------------------
// Structure du CV HT Portage (sortie de l'outil imposé au modèle)
// ---------------------------------------------------------------------------
const texte = { type: "string" };
const liste = { type: "array", items: { type: "string" } };
export const OUTIL = {
  name: "cv_ht_portage",
  description: "Enregistre le CV restructuré au format HT Portage.",
  input_schema: {
    type: "object",
    properties: {
      prenom: texte, nom: texte,
      nom_affiche: { type: "string", description: "Nom tel qu'il apparaîtra sur le CV (initiales si anonymisé, ex. « M. B. »)" },
      titre: { type: "string", description: "Intitulé de poste court, ex. « Développeur Full-stack Java / Angular »" },
      annees_experience: { type: "number", description: "Années d'expérience professionnelle, calculées à partir des dates du CV" },
      resume: { type: "string", description: "Synthèse du profil en 3 à 5 phrases, à la troisième personne, sans pronom ni nom" },
      competences_cles: { ...liste, description: "6 à 10 compétences majeures, les plus pertinentes en premier" },
      competences: { type: "array", items: { type: "object", properties: { categorie: texte, elements: liste }, required: ["categorie", "elements"] } },
      experiences: {
        type: "array", description: "Expériences professionnelles de la plus récente à la plus ancienne",
        items: {
          type: "object",
          properties: {
            poste: texte, entreprise: texte, secteur: texte, lieu: texte,
            debut: { type: "string", description: "Mois et année, ex. « janv. 2023 » / « Jan 2023 »" },
            fin: { type: "string", description: "Mois et année, ou « Aujourd'hui » / « Present »" },
            contexte: { type: "string", description: "Contexte de la mission en une ou deux phrases" },
            realisations: { ...liste, description: "Réalisations et responsabilités, phrases courtes commençant par un verbe" },
            environnement: { ...liste, description: "Technologies, outils et méthodes utilisés" },
          },
          required: ["poste", "entreprise", "debut", "fin", "realisations"],
        },
      },
      formations: { type: "array", items: { type: "object", properties: { diplome: texte, etablissement: texte, annee: texte }, required: ["diplome"] } },
      certifications: { type: "array", items: { type: "object", properties: { nom: texte, annee: texte }, required: ["nom"] } },
      langues: { type: "array", items: { type: "object", properties: { langue: texte, niveau: texte }, required: ["langue"] } },
      adequation: {
        type: "object", description: "Uniquement si une mission est fournie : analyse pour le recruteur (non destinée au client)",
        properties: {
          score: { type: "number", description: "Adéquation de 0 à 100" },
          synthese: texte, points_forts: liste, points_a_verifier: liste,
        },
      },
    },
    required: ["nom_affiche", "titre", "resume", "competences_cles", "competences", "experiences", "formations", "langues"],
  },
};

export function consignes(o: { anonyme?: boolean; masquer_clients?: boolean; langue?: string; offre_texte?: string; consignes?: string }) {
  const en = o.langue === "en";
  const r = [
    "Tu es chargé de remettre en forme des CV de consultants pour HT Portage, société de portage salarial (groupe Harington Technologies).",
    "Analyse le CV fourni et appelle obligatoirement l'outil cv_ht_portage avec son contenu restructuré. Ne réponds pas en texte : utilise uniquement l'outil.",
    "Règles impératives :",
    "- N'invente rien : aucune expérience, compétence, date, certification ou diplôme absent du CV. En cas de doute, omets.",
    "- Conserve les dates et les durées exactes ; classe les expériences de la plus récente à la plus ancienne.",
    "- Reformule de façon professionnelle et concise ; corrige l'orthographe ; supprime les redites.",
    "- Regroupe les compétences par catégories pertinentes (ex. Langages, Frameworks, Cloud & DevOps, Bases de données, Méthodes, Outils).",
    "- N'inclus ni adresse postale, ni téléphone, ni e-mail, ni date de naissance, ni photo, ni situation familiale.",
    en ? "- Rédige tout le contenu en anglais professionnel (traduis si nécessaire)." : "- Rédige tout le contenu en français professionnel (traduis si nécessaire).",
  ];
  if (o.anonyme) r.push("- Anonymise le candidat : nom_affiche = initiales du prénom et du nom (ex. « M. B. »), et le résumé ne doit contenir ni nom ni prénom.");
  else r.push("- nom_affiche = prénom suivi du nom de famille en majuscules (ex. « Marie BERNARD »).");
  if (o.masquer_clients) r.push("- Masque le nom des entreprises et des clients : remplace-les par une description générique (ex. « Grande banque française », « Éditeur SaaS RH »).");
  if (o.offre_texte) {
    r.push(
      "- Une mission cible est fournie ci-dessous. Adapte le CV à cette mission SANS rien inventer : résumé orienté vers la mission, compétences clés et catégories réordonnées pour mettre en avant ce qui correspond, réalisations pertinentes placées en tête de chaque expérience. L'ordre chronologique des expériences reste inchangé.",
      "- Remplis « adequation » : score honnête de 0 à 100, synthèse en 2 phrases, points forts au regard de la mission, et points à vérifier (exigences de la mission absentes ou peu visibles dans le CV).",
      "", "MISSION CIBLE :", o.offre_texte.slice(0, 8000),
    );
  } else {
    r.push("- Ne remplis pas « adequation ».");
  }
  if (o.consignes) r.push("", "CONSIGNES SUPPLÉMENTAIRES DU DEMANDEUR (à suivre si elles respectent les règles ci-dessus) :", o.consignes.slice(0, 1500));
  return r.join("\n");
}

async function analyser(contenu: unknown[], systeme: string) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": CLE, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: MODELE, max_tokens: 8000, system: systeme,
      tools: [OUTIL], tool_choice: { type: "auto" }, // le choix forcé d'un outil n'est pas accepté par tous les modèles
      messages: [{ role: "user", content: contenu }],
    }),
  });
  if (!r.ok) { const t = await r.text(); console.error("Anthropic", r.status, t.slice(0, 500)); if (/credit balance/i.test(t)) throw new Error("Crédit de l'API Claude épuisé : ajoutez du crédit sur console.anthropic.com (Plans & Billing)."); throw new Error(r.status === 401 ? "Clé ANTHROPIC_API_KEY invalide." : r.status === 429 || r.status === 529 ? "Service d'analyse saturé : réessayez dans une minute." : "Analyse impossible (" + r.status + ")."); }
  const j = await r.json();
  const bloc = (j.content ?? []).find((b: { type: string }) => b.type === "tool_use");
  if (bloc?.input) return bloc.input;
  // Secours : réponse en texte contenant le JSON
  const txt = (j.content ?? []).filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("\n");
  const m = /\{[\s\S]*\}/.exec(txt);
  if (m) { try { const o = JSON.parse(m[0]); if (o && (o.experiences || o.titre)) return o; } catch { /* JSON illisible */ } }
  console.error("Réponse sans CV", JSON.stringify(j).slice(0, 500));
  throw new Error("Le CV n'a pas pu être analysé. Réessayez.");
}

if (Deno.env.get("HTP_TEST") !== "1") Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ erreur: "Méthode non autorisée" }, 405);
  try {
    if (!CLE) return json({ erreur: "Le convertisseur n'est pas encore activé (clé ANTHROPIC_API_KEY manquante dans Supabase)." }, 503);
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: u } = await admin.auth.getUser(token);
    if (!u?.user) return json({ erreur: "Session expirée : reconnectez-vous." }, 401);
    const { data: estAdmin } = await admin.from("admins").select("user_id").eq("user_id", u.user.id).maybeSingle();

    // Limite d'usage : 15 conversions / jour pour un consultant, 200 pour l'équipe
    const { data: ok } = await admin.rpc("limiter", { p_cle: "cv:" + u.user.id, p_max: estAdmin ? 200 : 15, p_fenetre: 86400 });
    if (ok === false) return json({ erreur: "Limite de conversions atteinte pour aujourd'hui. Réessayez demain." }, 429);

    const corps = await req.json().catch(() => ({}));
    const o = corps.options ?? {};
    let contenu: unknown[] = [];
    let nomSource = "";
    // CV d'une candidature (administration)
    if (corps.candidature_id) {
      if (!estAdmin) return json({ erreur: "Réservé à l'équipe HT Portage." }, 403);
      const { data: c } = await admin.from("candidatures").select("nom, cv_path").eq("id", corps.candidature_id).maybeSingle();
      if (!c?.cv_path) return json({ erreur: "Cette candidature n'a pas de CV." }, 404);
      if (!/\.pdf$/i.test(c.cv_path)) return json({ erreur: "CV au format Word : téléchargez-le puis déposez-le dans le convertisseur." }, 415);
      const { data: f, error } = await admin.storage.from("cv").download(c.cv_path);
      if (error || !f) return json({ erreur: "CV introuvable." }, 404);
      const b = new Uint8Array(await f.arrayBuffer());
      let s = ""; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
      contenu = [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: btoa(s) } }];
      nomSource = c.cv_path.split("/").pop() ?? "cv.pdf";
    } else if (corps.fichier?.base64) {
      if (corps.fichier.type !== "application/pdf") return json({ erreur: "Fichier non pris en charge." }, 415);
      if (corps.fichier.base64.length > MAX_FICHIER * 1.37) return json({ erreur: "Le CV dépasse 6 Mo." }, 413);
      contenu = [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: corps.fichier.base64 } }];
      nomSource = String(corps.fichier.nom ?? "cv.pdf").slice(0, 120);
    } else if (typeof corps.texte === "string" && corps.texte.trim().length > 80) {
      contenu = [{ type: "text", text: "CV du candidat :\n\n" + corps.texte.slice(0, 60000) }];
      nomSource = String(corps.nom ?? "cv.docx").slice(0, 120);
    } else {
      return json({ erreur: "Déposez un CV (PDF ou Word)." }, 400);
    }
    contenu.push({ type: "text", text: "Remets ce CV au format HT Portage en appelant l'outil cv_ht_portage." });

    const cv = await analyser(contenu, consignes(o));
    const { data: ligne } = await admin.from("cvs").insert({
      user_id: u.user.id, candidature_id: corps.candidature_id ?? null, source_nom: nomSource,
      candidat_nom: [cv.prenom, cv.nom].filter(Boolean).join(" ").slice(0, 200) || null,
      offre_ref: o.offre_ref ?? null, options: { anonyme: !!o.anonyme, masquer_clients: !!o.masquer_clients, langue: o.langue === "en" ? "en" : "fr", offre: !!o.offre_texte },
      donnees: cv,
    }).select("id").maybeSingle();
    return json({ cv, id: ligne?.id ?? null });
  } catch (e) {
    console.error(e);
    return json({ erreur: (e as Error).message || "Erreur inattendue." }, 500);
  }
});
