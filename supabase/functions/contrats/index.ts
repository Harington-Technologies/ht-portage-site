// HT Portage — génération des contrats (CDI + annexe 1) et envoi en signature électronique (Firma.dev).
// Appelée depuis l'administration de l'espace (utilisateur connecté et administrateur).
//   POST { mission_id, action: "apercu" }  → renvoie les .docx remplis (base64) pour relecture
//   POST { mission_id, action: "envoyer" } → crée et envoie les demandes de signature Firma
//
// Secrets : FIRMA_API_KEY (clé de l'espace de travail Firma ; une clé de test produit des documents filigranés),
//           CLOUDCONVERT_API_KEY (conversion fidèle du .docx en PDF avant envoi ; sans elle, Firma convertit lui-même,
//           avec une mise en page approximative), MODELES_URL (facultatif).
// Les identifiants Firma sont rangés dans les colonnes documents.yousign_sr_id / yousign_statut (noms historiques).
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
const FIRMA_KEY = Deno.env.get("FIRMA_API_KEY") ?? "";
const FIRMA_URL = "https://api.firma.dev/functions/v1/signing-request-api";
const CC_KEY = Deno.env.get("CLOUDCONVERT_API_KEY") ?? "";
const MODELES_URL = Deno.env.get("MODELES_URL") ?? "https://raw.githubusercontent.com/Harington-Technologies/ht-portage-site/main/contrats/modeles/";

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

async function firma(path: string, init: RequestInit = {}) {
  const r = await fetch(FIRMA_URL + path, { ...init, headers: { Authorization: FIRMA_KEY, ...(init.headers ?? {}) } });
  const txt = await r.text();
  if (!r.ok) throw new Error("Firma " + (init.method ?? "GET") + " " + path + " → " + r.status + " " + txt.slice(0, 300));
  return txt ? JSON.parse(txt) : {};
}

type Signataire = { first_name: string; last_name: string; email: string; ancre: string };

// Demande de signature Firma : le .docx rempli, les signataires (tous en même temps) et une zone de signature
// posée sur chaque repère {{sN|signature|l|h}} du modèle (texte blanc, effacé par Firma).
export function corpsDemande(nom: string, fichier: string, signataires: Signataire[], externalId: string, diag = false) {
  return {
    name: nom.slice(0, 255),
    description: "HT Portage · " + externalId,
    document: fichier,
    language: "fr",
    expiration_hours: 14 * 24,
    reminders: [{ hours_before_expiration: 7 * 24 }, { hours_before_expiration: 48 }],
    recipients: signataires.map((s, i) => ({
      id: "temp_" + (i + 1), first_name: s.first_name, last_name: s.last_name, email: s.email, designation: "Signer", order: i + 1,
    })),
    anchor_tags: signataires.map((s, i) => ({ anchor_string: s.ancre, type: "signature", recipient_id: "temp_" + (i + 1), case_sensitive: true, match_whole_word: false, ...(diag ? { ignore_if_not_present: true } : {}) })),
    settings: { use_signing_order: false, allow_decline: true },
    completion_title: "Merci, votre signature est enregistrée",
    completion_message: "Le document signé par toutes les parties vous sera envoyé par e-mail. Il sera aussi disponible dans votre espace HT Portage. Pour toute question : contact@htportage.fr",
  };
}

// Conversion fidèle .docx → PDF (CloudConvert, moteur bureautique) ; le travail est supprimé aussitôt après.
async function enPdf(docx: Uint8Array, nom: string): Promise<Uint8Array> {
  const cc = (url: string, init: RequestInit = {}) => fetch(url, { ...init, headers: { Authorization: "Bearer " + CC_KEY, "Content-Type": "application/json", ...(init.headers ?? {}) } });
  const r = await cc("https://sync.api.cloudconvert.com/v2/jobs", { method: "POST", body: JSON.stringify({
    tag: "htp-contrat",
    tasks: {
      importer: { operation: "import/base64", file: b64(docx), filename: nom },
      convertir: { operation: "convert", input: "importer", input_format: "docx", output_format: "pdf" },
      exporter: { operation: "export/url", input: "convertir" },
    },
  }) });
  const txt = await r.text();
  if (!r.ok) throw new Error("CloudConvert → " + r.status + " " + txt.slice(0, 300));
  const job = JSON.parse(txt).data ?? {};
  try {
    const exp = (job.tasks ?? []).find((t: { operation: string }) => t.operation === "export/url");
    const erreur = (job.tasks ?? []).find((t: { status: string }) => t.status === "error");
    if (erreur) throw new Error("CloudConvert : " + (erreur.message ?? erreur.code ?? "échec de conversion"));
    const url = exp?.result?.files?.[0]?.url;
    if (!url) throw new Error("CloudConvert : PDF introuvable");
    const f = await fetch(url);
    if (!f.ok) throw new Error("CloudConvert : téléchargement du PDF → " + f.status);
    return new Uint8Array(await f.arrayBuffer());
  } finally {
    if (job.id) await cc("https://api.cloudconvert.com/v2/jobs/" + job.id, { method: "DELETE" }).catch(() => null);
  }
}

async function envoyerFirma(nom: string, docx: Uint8Array, signataires: Signataire[], externalId: string, diag = false) {
  // PDF fidèle si la conversion est configurée ; sinon le .docx, converti par Firma
  const fichier = CC_KEY ? await enPdf(docx, externalId + ".docx") : docx;
  const sr = await firma("/signing-requests/create-and-send", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corpsDemande(nom, b64(fichier), signataires, externalId, diag)),
  });
  if (!sr.id) throw new Error("Firma : réponse sans identifiant de demande");
  if (sr.warnings?.length) console.warn("Firma", sr.id, JSON.stringify(sr.warnings));
  if (diag) {
    // Diagnostic : où Firma a posé chaque zone de signature (page, position en %), et ses avertissements
    const qui = Object.fromEntries((sr.recipients ?? []).map((r: { id: string; first_name: string; last_name: string }) => [r.id, r.last_name || r.first_name]));
    // deno-lint-ignore no-explicit-any
    const zones = (sr.fields ?? []).map((f: any) => (qui[String(f.recipient_id ?? f.signing_request_user_id ?? "")] ?? "?") + " p" + (f.page ?? f.page_number ?? f.position?.page ?? "?") + " y" + Math.round(Number(f.y ?? f.position?.y ?? 0)));
    return sr.id + " · " + (sr.page_count ?? "?") + " pages · zones : " + (zones.join(", ") || "aucune") + (sr.warnings?.length ? " · avertissements : " + JSON.stringify(sr.warnings).slice(0, 300) : "");
  }
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
    // Test de bout en bout de la signature (dossier fictif, tous les signataires = l'administrateur connecté) : rien n'est enregistré
    if (action === "test_signature") {
      if (!FIRMA_KEY) return json({ erreur: "Clé Firma absente (secret FIRMA_API_KEY)." }, 500);
      const moi = (await admin.from("profils").select("*").eq("id", u.user.id).maybeSingle()).data ?? {};
      const email = moi.email || u.user.email || "";
      const fm = { numero_contrat: "TEST-0001", client: "Client Test SAS", client_adresse: "1 rue de l'Exemple, 75001 Paris", client_representant: "Camille Client", client_representant_qualite: "Directrice des achats",
        intitule: "Mission de test — développement", date_debut: new Date().toISOString().slice(0, 10), tjm: 600, frais_gestion: 5, competences: "Java, Spring, Angular" };
      const fp = { civilite: "M.", prenom: "Test", nom: "CONSULTANT", date_naissance: "1990-01-15", lieu_naissance: "Paris", nationalite: "Française", adresse: "2 rue du Test", code_postal: "92270", ville: "Bois-Colombes", num_secu: "1900175000000" };
      const dt = donneesContrats(fm, fp, moi, new Date().toISOString().slice(0, 10));
      const charger = async (nom: string) => { const r = await fetch(MODELES_URL + nom + "?t=" + Date.now(), { cache: "no-store" }); if (!r.ok) throw new Error("Modèle introuvable : " + nom); return await r.arrayBuffer(); };
      const sig = (prenom: string, nom: string, ancre: string) => ({ first_name: prenom, last_name: nom, email, ancre });
      const res: Record<string, string> = {};
      const essai = async (cle: string, f: () => Promise<string>) => { try { res[cle] = "envoyé (" + await f() + ")"; } catch (e) { res[cle] = "échec : " + (e as Error).message.slice(0, 300); } };
      await essai("CDI", async () => envoyerFirma("TEST · CDI de portage salarial", remplir(await charger("cdi.docx"), dt.cdi), [sig("Test", "Consultant", "HTPSIGA"), sig("Test", "HT Portage", "HTPSIGB")], "test-cdi"));
      await essai("Annexe", async () => envoyerFirma("TEST · Annexe 1 · Client Test SAS", remplir(await charger("annexe.docx"), dt.annexe), [sig("Test", "Consultant", "HTPSIGA"), sig("Test", "Client", "HTPSIGB"), sig("Test", "HT Portage", "HTPSIGC")], "test-annexe"));
      return json({ ok: true, envoyes_a: email, resultats: res });
    }
    // État Firma : compte utilisé (propriétaire, crédits) et état réel des demandes en attente ;
    // une demande terminée chez Firma mais jamais notifiée est rejouée vers firma-webhook (signature HMAC).
    if (action === "etat_firma") {
      if (!FIRMA_KEY) return json({ erreur: "Clé Firma absente (secret FIRMA_API_KEY)." }, 500);
      const c = await firma("/company");
      const compte = { nom: c.name ?? "", proprietaire: c.account_owner ?? "", email: c.account_owner_email ?? "", credits: c.credits ?? null };
      const { data: attente } = await admin.from("documents").select("id, titre, yousign_sr_id, envoye_le").eq("statut", "a_signer").not("yousign_sr_id", "is", null).order("created_at", { ascending: false }).limit(20);
      const secret = Deno.env.get("FIRMA_WEBHOOK_SECRET") ?? "";
      const demandes = [];
      for (const d of attente ?? []) {
        try {
          const j = await firma("/signing-requests/" + d.yousign_sr_id);
          const sr = j.signing_request ?? j;
          const st = sr.status ?? sr.state ?? "";
          const statut = typeof st === "object" ? JSON.stringify(st) : String(st);
          const dests = (sr.recipients ?? j.recipients ?? sr.signers ?? j.signers ?? []) as Record<string, unknown>[];
          const signataires = dests.map((r) => ({ email: String(r.email ?? ""), signe: Boolean(r.signed_at || r.completed_at || /sign|complet/i.test(String(r.status ?? ""))), statut: String(r.status ?? "") }));
          const termine = /"?(completed|finished)"?/i.test(statut) || (signataires.length > 0 && signataires.every((x) => x.signe));
          let rejoue = "";
          if (termine && secret) {
            const corps = JSON.stringify({ id: "sync-" + d.yousign_sr_id, type: "signing_request.completed", data: { signing_request: { id: d.yousign_sr_id } } });
            const t = Math.floor(Date.now() / 1000);
            const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
            const sig = Array.from(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(t + "." + corps)))).map((x) => x.toString(16).padStart(2, "0")).join("");
            const r = await fetch(Deno.env.get("SUPABASE_URL") + "/functions/v1/firma-webhook", { method: "POST", headers: { "Content-Type": "application/json", "X-Firma-Signature": "t=" + t + ",v1=" + sig, "X-Firma-Delivery": "sync-" + d.yousign_sr_id }, body: corps });
            rejoue = r.ok ? "traitement relancé" : "relance refusée (" + r.status + ")";
          }
          // réponse brute de Firma (sans données de document) pour diagnostic
          const brut = JSON.stringify(sr, (k, v) => (typeof v === "string" && v.length > 120 ? v.slice(0, 40) + "…" : v)).slice(0, 2500);
          demandes.push({ titre: d.titre, id: d.yousign_sr_id, statut, signataires, termine, rejoue, brut });
        } catch (e) {
          demandes.push({ titre: d.titre, id: d.yousign_sr_id, erreur: (e as Error).message.slice(0, 200) });
        }
      }
      return json({ ok: true, compte, demandes });
    }
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
      const r = await fetch(MODELES_URL + nom + "?t=" + Date.now(), { cache: "no-store" });
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

    // 4. Envoi Firma : CDI (consultant + HT Portage) et annexe (consultant + client + HT Portage), séparément, tous les signataires en même temps
    if (!FIRMA_KEY) return json({ erreur: "Clé Firma absente (secret FIRMA_API_KEY)." }, 500);
    const consultant = { ...decouperNom(nomComplet(p)), first_name: p.prenom, last_name: p.nom, email: p.email };
    const client = { ...decouperNom(m.client_representant), email: m.client_signataire_email };
    const htpNom = decouperNom(nomComplet(htp ?? {}) || "HT Portage");
    const signataireHtp = { ...htpNom, email: htp?.email ?? u.user.email ?? "" };
    const resultats = [];
    for (const f of fichiers) {
      // Repères des modèles : CDI = s1 consultant, s2 HT Portage · Annexe = s1 consultant, s2 client, s3 HT Portage
      const signataires: Signataire[] = f.type === "cdi"
        ? [{ ...consultant, ancre: "HTPSIGA" }, { ...signataireHtp, ancre: "HTPSIGB" }]
        : [{ ...consultant, ancre: "HTPSIGA" }, { ...client, ancre: "HTPSIGB" }, { ...signataireHtp, ancre: "HTPSIGC" }];
      const srId = await envoyerFirma(f.titre + " · " + nomComplet(p), f.contenu, signataires, f.type + "-" + m.id);
      const { error } = await admin.from("documents").insert({
        user_id: m.user_id, mission_id: m.id, type: f.type, titre: f.titre, statut: "a_signer",
        yousign_sr_id: srId, yousign_statut: "sent", envoye_le: new Date().toISOString(),
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
