// HT Portage — génération des contrats (CDI + annexe 1) et envoi en signature Yousign.
// Appelée depuis l'administration de l'espace (utilisateur connecté et administrateur).
//   POST { mission_id, action: "apercu" }  → renvoie les .docx remplis (base64) pour relecture
//   POST { mission_id, action: "envoyer" } → crée les demandes de signature Yousign
//
// Secrets : YOUSIGN_API_KEY, YOUSIGN_ENV ("sandbox" | "production"), MODELES_URL (facultatif).
// SUPABASE_URL et la clé serveur sont fournis par Supabase.
// Déploiement : « Verify JWT » désactivé — l'identité est vérifiée dans la fonction (getUser + table admins).

import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import PizZip from "npm:pizzip@3.1.7";
import Docxtemplater from "npm:docxtemplater@3.47.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const YS_KEY = Deno.env.get("YOUSIGN_API_KEY") ?? "";
const YS_URL = Deno.env.get("YOUSIGN_ENV") === "production" ? "https://api.yousign.app/v3" : "https://api-sandbox.yousign.app/v3";
const MODELES_URL = Deno.env.get("MODELES_URL") ?? "https://raw.githubusercontent.com/Harington-Technologies/ht-portage-site/main/contrats/modeles/";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function serverKey(): string {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
    const vals = Array.isArray(keys) ? keys : Object.values(keys);
    return (vals.map((v: unknown) => typeof v === "string" ? v : (v as { key?: string })?.key).find(Boolean) as string) ?? "";
  } catch { return ""; }
}
const admin = createClient(Deno.env.get("SUPABASE_URL") ?? "", serverKey(), { auth: { persistSession: false } });

// --- coeur (sans dépendance, testé à part) ---
const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
export function dateFr(d: any) {
  if (!d) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d));
  const x = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(d);
  return x.getDate() + (x.getDate() === 1 ? "er" : "") + " " + MOIS[x.getMonth()] + " " + x.getFullYear();
}
export function nombreFr(n: any, dec?: number) {
  const v = Number(n);
  if (!isFinite(v)) return "";
  return v.toLocaleString("fr-FR", { minimumFractionDigits: dec ?? 0, maximumFractionDigits: dec ?? 2 }).replace(/ /g, " ");
}
export function secuFr(s: any) {
  const v = String(s || "").replace(/\s/g, "");
  if (v.length < 13) return v;
  return [v.slice(0, 1), v.slice(1, 3), v.slice(3, 5), v.slice(5, 7), v.slice(7, 10), v.slice(10, 13), v.slice(13)].filter(Boolean).join(" ");
}
export function nomComplet(p: any) { return [p && p.prenom, p && p.nom].filter(Boolean).join(" ").trim(); }
export function decouperNom(t: any) {
  const parts = String(t || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { first_name: "", last_name: "" };
  if (parts.length === 1) return { first_name: parts[0], last_name: parts[0] };
  return { first_name: parts[0], last_name: parts.slice(1).join(" ") };
}
export function donneesContrats(m: any, p: any, htp: any, aujourdHui: any) {
  const salarie = nomComplet(p);
  const ville = [p.code_postal, p.ville].filter(Boolean).join(" ") + (p.pays && p.pays !== "France" ? ", " + p.pays : "");
  const signe = dateFr(aujourdHui);
  const htpNom = nomComplet(htp) || "HT Portage";
  const cdi = {
    case_m: p.civilite === "M." ? "☒" : "☐", case_mme: p.civilite === "Mme" ? "☒" : "☐",
    salarie_nom: salarie, date_naissance: dateFr(p.date_naissance), lieu_naissance: p.lieu_naissance || "",
    nationalite: p.nationalite || "", adresse: p.adresse || "", adresse_ville: ville, num_secu: secuFr(p.num_secu),
    date_effet: dateFr(m.date_debut), competences: m.competences || p.competences || "",
    frais_gestion: nombreFr(m.frais_gestion ?? 5) + " %", date_signature: signe,
    reference_cdi: "CDI-" + (m.numero_contrat || ""),
  };
  const annexe = {
    numero_contrat: m.numero_contrat || "", client: m.client || "", client_siret: m.client_siret || "",
    client_adresse: m.client_adresse || "",
    client_representant: [m.client_representant, m.client_representant_qualite].filter(Boolean).join(", "),
    client_signataire: [m.client_representant, m.client_representant_qualite].filter(Boolean).join(", "),
    salarie_nom: salarie, objet: m.intitule || "", date_debut: dateFr(m.date_debut),
    date_fin: m.date_fin ? dateFr(m.date_fin) : "la fin de la prestation",
    periode: dateFr(m.date_debut) + (m.date_fin ? " → " + dateFr(m.date_fin) : ""),
    client_final: m.client_final || m.client || "", adresse_execution: m.adresse_execution || "",
    ic_nom: m.interlocuteur_nom || "", ic_tel: m.interlocuteur_tel || "", ic_email: m.interlocuteur_email || "",
    ip_nom: m.htp_interlocuteur_nom || htpNom, ip_tel: m.htp_interlocuteur_tel || "", ip_email: m.htp_interlocuteur_email || "",
    tjm: nombreFr(m.tjm, 2) + " € HT", frais_gestion: nombreFr(m.frais_gestion ?? 5) + " %",
    lieu_signature: "Bois-Colombes", date_signature: signe, htp_signataire: htpNom + ", Président",
  };
  return { cdi, annexe };
}
export function controlerDossier(m: any, p: any) {
  const manque: string[] = [];
  [["civilite", "civilité"], ["prenom", "prénom"], ["nom", "nom"], ["date_naissance", "date de naissance"], ["lieu_naissance", "lieu de naissance"],
   ["adresse", "adresse"], ["code_postal", "code postal"], ["ville", "ville"]]
    .forEach(([k, l]) => { if (!p[k]) manque.push(l + " du consultant"); });
  [["intitule", "objet de la prestation"], ["date_debut", "date de début"], ["tjm", "TJ"], ["client", "société cliente"],
   ["client_adresse", "adresse du client"], ["client_representant", "signataire client"], ["client_signataire_email", "e-mail du signataire client"],
   ["numero_contrat", "n° de contrat"]].forEach(([k, l]) => { if (!m[k]) manque.push(l); });
  return manque;
}
// --- fin coeur ---

export function remplir(modele: ArrayBuffer, donnees: Record<string, string>): Uint8Array {
  const doc = new Docxtemplater(new PizZip(modele), {
    delimiters: { start: "[[", end: "]]" }, paragraphLoop: true, linebreaks: true, nullGetter: () => "",
  });
  doc.render(donnees);
  return doc.getZip().generate({ type: "uint8array", compression: "DEFLATE" });
}

async function ys(path: string, init: RequestInit = {}) {
  const r = await fetch(YS_URL + path, { ...init, headers: { Authorization: "Bearer " + YS_KEY, ...(init.headers ?? {}) } });
  const txt = await r.text();
  if (!r.ok) throw new Error("Yousign " + (init.method ?? "GET") + " " + path + " → " + r.status + " " + txt.slice(0, 300));
  return txt ? JSON.parse(txt) : {};
}

type Signataire = { first_name: string; last_name: string; email: string; texte?: { request_subject: string; request_body: string; reminder_subject: string; reminder_body: string } };

// Textes des e-mails Yousign (texte brut, sans HTML ; insérés dans l'e-mail standard Yousign)
const SIGNATURE_MAIL = "\n\nBien cordialement,\nService Administratif HT PORTAGE\ncontact@htportage.fr · www.htportage.fr";
export function textesInvitation(role: "consultant" | "client" | "htp", doc: "cdi" | "annexe", o: { prenom?: string; consultant: string; client?: string; numero?: string }) {
  const bj = "Bonjour" + (o.prenom ? " " + o.prenom : "") + ",\n\n";
  const ref = o.numero ? " (réf. " + o.numero + ")" : "";
  let sujet = "", corps = "";
  if (doc === "cdi") {
    if (role === "consultant") {
      sujet = "HT Portage — votre contrat de travail à signer";
      corps = bj + "Nous avons le plaisir de vous adresser votre contrat de travail à durée indéterminée en portage salarial. Nous vous invitons à le relire attentivement puis à le signer en ligne : un code de vérification vous sera envoyé par e-mail au moment de la signature.\n\nUne fois toutes les signatures recueillies, le document signé sera disponible dans votre espace consultant.";
    } else {
      sujet = "À signer — CDI de portage salarial de " + o.consultant;
      corps = bj + "Le contrat de travail de " + o.consultant + " est prêt à être signé pour HT Portage.";
    }
  } else if (role === "consultant") {
    sujet = "HT Portage — l'annexe de votre mission chez " + (o.client || "votre client") + " à signer";
    corps = bj + "Votre mission chez " + (o.client || "votre client") + ref + " a été validée. Voici l'annexe à votre contrat de travail, qui en précise les conditions. Merci de la relire puis de la signer en ligne. Votre client et HT Portage la signent en parallèle.";
  } else if (role === "client") {
    sujet = "HT Portage — conditions de la mission de " + o.consultant + " à signer";
    corps = bj + "Dans le cadre de la mission de " + o.consultant + " au sein de " + (o.client || "votre société") + ref + ", HT Portage vous adresse le document fixant les conditions de la prestation. Nous vous remercions de bien vouloir le signer en ligne : un code de vérification vous sera envoyé par e-mail au moment de la signature.\n\nPour toute question, notre équipe reste à votre disposition à l'adresse contact@htportage.fr.";
  } else {
    sujet = "À signer — annexe de mission " + o.consultant + (o.client ? " · " + o.client : "");
    corps = bj + "L'annexe de la mission de " + o.consultant + (o.client ? " chez " + o.client : "") + ref + " est prête à être signée pour HT Portage.";
  }
  const rappel = (o.prenom ? "Bonjour " + o.prenom + ",\n\n" : "Bonjour,\n\n") + "Petit rappel : un document HT Portage est toujours en attente de votre signature. La signature en ligne ne prend que quelques minutes.";
  return { request_subject: sujet.slice(0, 150), request_body: (corps + SIGNATURE_MAIL).slice(0, 1000), reminder_subject: ("Rappel : " + sujet).slice(0, 150), reminder_body: (rappel + SIGNATURE_MAIL).slice(0, 1000) };
}

async function creerDemande(nom: string, externalId: string) {
  const base = { name: nom, delivery_mode: "email", ordered_signers: false, timezone: "Europe/Paris", external_id: externalId };
  // Personnalisation : expéditeur « Service Administratif HT PORTAGE » + relances tous les 2 jours (3 max).
  // Si l'offre Yousign ne permet pas une option, on réessaie sans elle plutôt que de bloquer l'envoi.
  const essais = [
    { ...base, email_notification: { sender: { type: "custom", custom_name: "Service Administratif HT PORTAGE" } }, reminder_settings: { interval_in_days: 2, max_occurrences: 3 } },
    { ...base, reminder_settings: { interval_in_days: 2, max_occurrences: 3 } },
    base,
  ];
  let derniere: unknown;
  for (const corps of essais) {
    try {
      return await ys("/signature_requests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corps) });
    } catch (e) { derniere = e; console.warn("Création demande Yousign, nouvel essai sans option :", (e as Error).message); }
  }
  throw derniere;
}

async function envoyerYousign(nom: string, fichier: Uint8Array, nomFichier: string, signataires: Signataire[], externalId: string) {
  const sr = await creerDemande(nom, externalId);
  const fd = new FormData();
  fd.append("file", new Blob([fichier], { type: DOCX }), nomFichier);
  fd.append("nature", "signable_document");
  fd.append("parse_anchors", "true");
  const doc = await ys("/signature_requests/" + sr.id + "/documents", { method: "POST", body: fd });
  if (!doc.total_anchors) throw new Error("Aucune zone de signature détectée dans " + nomFichier);
  for (const s of signataires) {
    const { texte, ...info } = s;
    const corps = { info: { ...info, locale: "fr" }, signature_level: "electronic_signature", signature_authentication_mode: "otp_email" };
    try {
      await ys("/signature_requests/" + sr.id + "/signers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(texte ? { ...corps, custom_text: texte } : corps) });
    } catch (e) {
      if (!texte) throw e;
      console.warn("Texte personnalisé refusé, signataire ajouté sans :", (e as Error).message);
      await ys("/signature_requests/" + sr.id + "/signers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corps) });
    }
  }
  await ys("/signature_requests/" + sr.id + "/activate", { method: "POST" });
  return sr.id as string;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
function b64(u: Uint8Array) {
  let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}

// Niveau d'authentification (aal1 = mot de passe seul, aal2 = double authentification) lu dans le jeton
export function niveauAuth(jwt: string): string {
  try {
    const p = jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(p + "=".repeat((4 - p.length % 4) % 4))).aal ?? "";
  } catch { return ""; }
}

if (Deno.env.get("HTP_TEST") !== "1") Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ erreur: "Méthode non autorisée" }, 405);
  try {
    // 1. Appelant : utilisateur connecté ET administrateur
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: u } = await admin.auth.getUser(token);
    if (!u?.user) return json({ erreur: "Session invalide : reconnectez-vous." }, 401);
    const { data: estAdmin } = await admin.from("admins").select("user_id").eq("user_id", u.user.id).maybeSingle();
    if (!estAdmin) return json({ erreur: "Réservé aux administrateurs HT Portage." }, 403);
    // Double authentification obligatoire (jeton déjà validé par getUser ci-dessus)
    if (niveauAuth(token) !== "aal2") return json({ erreur: "Validez d'abord votre code de double authentification (reconnectez-vous)." }, 403);

    const { mission_id, action } = await req.json().catch(() => ({}));
    if (!mission_id || !["apercu", "envoyer"].includes(action)) return json({ erreur: "Requête incomplète." }, 400);

    // 2. Dossier
    const { data: m } = await admin.from("consultant_missions").select("*").eq("id", mission_id).maybeSingle();
    if (!m) return json({ erreur: "Mission introuvable." }, 404);
    if (m.statut !== "validee") return json({ erreur: "Le dossier doit être validé avant de générer les contrats." }, 409);
    const [{ data: p }, { data: htp }, { data: docs }] = await Promise.all([
      admin.from("profils").select("*").eq("id", m.user_id).maybeSingle(),
      admin.from("profils").select("*").eq("id", u.user.id).maybeSingle(),
      admin.from("documents").select("id, type, statut, mission_id").eq("user_id", m.user_id).in("type", ["cdi", "annexe"]),
    ]);
    if (!p) return json({ erreur: "Profil du consultant introuvable." }, 404);
    const manque = controlerDossier(m, p);
    if (manque.length) return json({ erreur: "Informations manquantes : " + manque.join(", ") + "." }, 422);

    const actifs = (docs ?? []).filter((d) => ["a_signer", "signe"].includes(d.statut));
    const besoinCdi = !actifs.some((d) => d.type === "cdi");
    if (action === "envoyer" && actifs.some((d) => d.type === "annexe" && d.mission_id === m.id)) {
      return json({ erreur: "Les contrats de cette mission ont déjà été envoyés en signature." }, 409);
    }

    // 3. Remplissage des modèles
    const d = donneesContrats(m, p, htp ?? {}, new Date().toISOString().slice(0, 10));
    const charger = async (nom: string) => {
      const r = await fetch(MODELES_URL + nom, { cache: "no-store" });
      if (!r.ok) throw new Error("Modèle introuvable : " + nom);
      return await r.arrayBuffer();
    };
    const fichiers: { type: string; nom: string; titre: string; contenu: Uint8Array }[] = [];
    const slug = (p.nom || "consultant").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-");
    if (besoinCdi) fichiers.push({ type: "cdi", nom: "CDI_" + slug + ".docx", titre: "CDI de portage salarial", contenu: remplir(await charger("cdi.docx"), d.cdi) });
    fichiers.push({ type: "annexe", nom: "Annexe1_" + m.numero_contrat + "_" + slug + ".docx", titre: "Annexe 1 · " + (m.client || "mission") + " · " + m.numero_contrat, contenu: remplir(await charger("annexe.docx"), d.annexe) });

    if (action === "apercu") {
      return json({ fichiers: fichiers.map((f) => ({ nom: f.nom, type: f.type, base64: b64(f.contenu) })) });
    }

    // 4. Envoi Yousign : CDI (consultant + HT Portage) et annexe (consultant + client + HT Portage), séparément, tous les signataires en même temps
    if (!YS_KEY) return json({ erreur: "Clé Yousign absente (secret YOUSIGN_API_KEY)." }, 500);
    const consultant = { ...decouperNom(nomComplet(p)), first_name: p.prenom, last_name: p.nom, email: p.email };
    const client = { ...decouperNom(m.client_representant), email: m.client_signataire_email };
    const htpNom = decouperNom(nomComplet(htp ?? {}) || "HT Portage");
    const signataireHtp = { ...htpNom, email: htp?.email ?? u.user.email ?? "" };
    const resultats = [];
    const ctx = { consultant: nomComplet(p), client: m.client || "", numero: m.numero_contrat || "" };
    for (const f of fichiers) {
      const t = (role: "consultant" | "client" | "htp", prenom?: string) => textesInvitation(role, f.type as "cdi" | "annexe", { ...ctx, prenom });
      const signataires: Signataire[] = f.type === "cdi"
        ? [{ ...consultant, texte: t("consultant", p.prenom) }, { ...signataireHtp, texte: t("htp", signataireHtp.first_name) }]
        : [{ ...consultant, texte: t("consultant", p.prenom) }, { ...client, texte: t("client", client.first_name) }, { ...signataireHtp, texte: t("htp", signataireHtp.first_name) }];
      const srId = await envoyerYousign(f.titre + " · " + nomComplet(p), f.contenu, f.nom, signataires, f.type + "-" + m.id);
      const { error } = await admin.from("documents").insert({
        user_id: m.user_id, mission_id: m.id, type: f.type, titre: f.titre, statut: "a_signer",
        yousign_sr_id: srId, yousign_statut: "ongoing", envoye_le: new Date().toISOString(),
      });
      if (error) throw new Error("Enregistrement du document : " + error.message);
      resultats.push({ type: f.type, yousign_sr_id: srId });
    }
    return json({ ok: true, envoyes: resultats });
  } catch (e) {
    console.error(e);
    return json({ erreur: (e as Error).message ?? String(e) }, 500);
  }
});
