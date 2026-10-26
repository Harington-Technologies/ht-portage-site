// HT Portage — point d'entrée unique et protégé des formulaires publics du site
// (contact, simulation, candidature avec CV, recommandation ambassadeur).
//
// Protections, dans l'ordre :
//   1. Piège à robots : champ caché « site_web » rempli, ou formulaire envoyé en moins de 3 s → ignoré sans erreur
//   2. Cloudflare Turnstile (si le secret TURNSTILE_SECRET est défini)
//   3. Limites : 5 envois / 10 min par adresse IP, 3 envois / heure par adresse e-mail
//   4. Liste blanche des champs par formulaire ; contrôles de la base (longueurs, formats, consentement)
// L'enregistrement se fait avec la clé serveur : les visiteurs anonymes n'écrivent plus directement dans la base.
//
// Secrets : TURNSTILE_SECRET (facultatif tant que Turnstile n'est pas activé).
// SUPABASE_URL et la clé serveur sont fournis par Supabase.
// Déploiement : « Verify JWT » désactivé (formulaire public).

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

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
const TURNSTILE_SECRET = Deno.env.get("TURNSTILE_SECRET") ?? "";

const ORIGINES = ["https://www.htportage.fr", "https://htportage.fr", "https://harington-technologies.github.io"];
function cors(req: Request) {
  const o = req.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": ORIGINES.includes(o) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o) ? o : ORIGINES[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

// Champs acceptés pour chaque formulaire (tout le reste est ignoré)
export const FORMULAIRES: Record<string, { table: string; champs: string[]; email: string; fixes?: Record<string, unknown> }> = {
  contact: { table: "contacts", champs: ["nom", "email", "telephone", "situation", "message", "consentement"], email: "email", fixes: { type: "contact", traite: false } },
  simulation: { table: "contacts", champs: ["nom", "email", "telephone", "message", "situation", "tjm", "jours", "net_estime", "consentement"], email: "email", fixes: { type: "simulation", traite: false } },
  candidature: { table: "candidatures", champs: ["nom", "email", "telephone", "mission_ref", "tjm_souhaite", "disponibilite", "message", "consentement"], email: "email", fixes: { statut: "nouvelle" } },
  recommandation: { table: "recommandations", champs: ["type", "ambassadeur_nom", "ambassadeur_email", "contact_nom", "contact_telephone", "contact_email", "details", "consentement"], email: "ambassadeur_email", fixes: { statut: "nouvelle" } },
};
const NOMBRES = new Set(["tjm", "jours", "net_estime", "tjm_souhaite"]);
const CV_TYPES = ["application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"];
const CV_MAX = 5 * 1024 * 1024;
export const DELAI_MIN_MS = 3000;

export function nettoyer(kind: string, brut: Record<string, unknown>): Record<string, unknown> | null {
  const f = FORMULAIRES[kind];
  if (!f) return null;
  const d: Record<string, unknown> = {};
  for (const k of f.champs) {
    let v = brut[k];
    if (v === undefined || v === null || v === "") continue;
    if (k === "consentement") { d[k] = v === true || v === "true" || v === "on"; continue; }
    if (NOMBRES.has(k)) { const n = Number(v); if (Number.isFinite(n)) d[k] = Math.round(n); continue; }
    v = String(v).trim().slice(0, 5000);
    if (v) d[k] = v;
  }
  return { ...d, ...(f.fixes ?? {}) };
}

export function ipDe(req: Request): string {
  return (req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip") || (req.headers.get("x-forwarded-for") ?? "").split(",")[0] || "inconnue").trim();
}

async function limite(cle: string, max: number, fenetre: number): Promise<boolean> {
  const { data, error } = await admin.rpc("limiter", { p_cle: cle, p_max: max, p_fenetre: fenetre });
  if (error) { console.error("limiter", error.message); return true; } // en cas de panne, on ne bloque pas les vrais visiteurs
  return data === true;
}

async function turnstileOk(jeton: string, ip: string): Promise<boolean> {
  if (!TURNSTILE_SECRET) return true;
  if (!jeton) return false;
  const fd = new FormData();
  fd.append("secret", TURNSTILE_SECRET); fd.append("response", jeton);
  if (ip && ip !== "inconnue") fd.append("remoteip", ip);
  try {
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: fd });
    const j = await r.json();
    return j.success === true;
  } catch (e) { console.error("Turnstile", e); return false; }
}

const nomFichier = (n: string) => n.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9._-]+/g, "-").slice(-80);

if (Deno.env.get("HTP_TEST") !== "1") Deno.serve(async (req) => {
  const h = cors(req);
  const rep = (corps: unknown, status = 200) => new Response(JSON.stringify(corps), { status, headers: { ...h, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: h });
  if (req.method !== "POST") return rep({ erreur: "Méthode non autorisée" }, 405);

  let fd: FormData;
  try { fd = await req.formData(); } catch { return rep({ erreur: "Requête invalide." }, 400); }
  const kind = String(fd.get("formulaire") ?? "");
  const conf = FORMULAIRES[kind];
  if (!conf) return rep({ erreur: "Formulaire inconnu." }, 400);

  // 1. Piège à robots : on répond « OK » pour ne rien apprendre au robot
  const delai = Number(fd.get("delai") ?? 0);
  if (String(fd.get("site_web") ?? "") !== "" || !(delai >= DELAI_MIN_MS)) {
    console.log("Robot ignoré", kind, ipDe(req), delai);
    return rep({ ok: true });
  }

  // 2. Captcha
  const ip = ipDe(req);
  if (!(await turnstileOk(String(fd.get("cf-turnstile-response") ?? ""), ip))) {
    return rep({ erreur: "La vérification anti-robot a échoué. Rechargez la page et réessayez." }, 400);
  }

  // 3. Données et limites
  let brut: Record<string, unknown> = {};
  try { brut = JSON.parse(String(fd.get("donnees") ?? "{}")); } catch { return rep({ erreur: "Données illisibles." }, 400); }
  const d = nettoyer(kind, brut)!;
  if (d.consentement !== true) return rep({ erreur: "Merci d'accepter l'utilisation de vos données pour être recontacté." }, 400);
  if (kind === "recommandation" && !d.contact_telephone) return rep({ erreur: "Indiquez le téléphone de la personne recommandée pour que nous puissions l'appeler." }, 400);
  const email = String(d[conf.email] ?? "").toLowerCase();
  if (!(await limite("ip:" + ip, 5, 600))) return rep({ erreur: "Trop d'envois depuis votre connexion. Réessayez dans quelques minutes." }, 429);
  if (email && !(await limite("email:" + email, 3, 3600))) return rep({ erreur: "Vous avez déjà envoyé plusieurs demandes avec cette adresse : notre équipe revient vers vous rapidement." }, 429);

  // 4. CV éventuel
  let cvPath: string | null = null;
  const cv = fd.get("cv");
  if (kind === "candidature" && cv instanceof File && cv.size > 0) {
    if (!CV_TYPES.includes(cv.type)) return rep({ erreur: "Le CV doit être un fichier PDF ou Word." }, 400);
    if (cv.size > CV_MAX) return rep({ erreur: "Le CV ne doit pas dépasser 5 Mo." }, 400);
    cvPath = crypto.randomUUID() + "/" + nomFichier(cv.name || "cv");
    const up = await admin.storage.from("cv").upload(cvPath, cv, { contentType: cv.type, upsert: false });
    if (up.error) { console.error("CV", up.error.message); return rep({ erreur: "Le CV n'a pas pu être enregistré." }, 500); }
    d.cv_path = cvPath;
  }

  // Recommandation faite depuis le site par un ambassadeur qui a déjà un espace : on la rattache à son compte
  if (kind === "recommandation" && email) {
    const { data: compte } = await admin.from("profils").select("id").ilike("email", email).maybeSingle();
    if (compte?.id) d.user_id = compte.id;
  }
  const { error } = await admin.from(conf.table).insert(d);
  if (error) {
    console.error("Insertion", kind, error.message);
    if (cvPath) await admin.storage.from("cv").remove([cvPath]);
    return rep({ erreur: "Certaines informations ne sont pas valides. Vérifiez le formulaire et réessayez." }, 400);
  }
  return rep({ ok: true });
});
