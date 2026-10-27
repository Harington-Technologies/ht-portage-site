// HT Portage — reprise des consultants déjà en poste (salariés VSP) et invitations à l'espace.
//
//   POST { action: "creer", consultants: [{ prenom, nom, email, telephone?, vsp_id? }] }   (administrateur)
//        → crée le compte (sans mot de passe) et le profil « consultant » ; un compte existant est simplement mis à jour.
//          Aucun e-mail n'est envoyé à cette étape.
//   POST { action: "inviter", user_id }                                                    (administrateur)
//        → envoie l'e-mail « Votre espace HT Portage est prêt » avec un lien personnel valable 30 jours.
//   POST { action: "activer", t }                                                          (public)
//        → le lien de l'e-mail ouvre espace/activer.html, qui appelle cette action : on renvoie un lien
//          Supabase tout neuf vers espace/reset.html, où le consultant choisit son mot de passe.
//
// Secrets : RESEND_API_KEY, NOTIFY_FROM (ex. noreply@htportage.fr), NOTIFY_TO (réponses → contact@).
// Déploiement : « Verify JWT » désactivé — l'identité est vérifiée dans la fonction (getUser + admins + aal2).

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const SITE = "https://www.htportage.fr";
const CONTACT = "contact@htportage.fr";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const NOTIFY_FROM = Deno.env.get("NOTIFY_FROM") ?? "";
const NOTIFY_TO = (Deno.env.get("NOTIFY_TO") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const VALIDITE_JOURS = 30;

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
// Contrôles (testés à part)
// ---------------------------------------------------------------------------
export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
export function nettoyerConsultant(c: Record<string, unknown>): { ok: true; v: { prenom: string; nom: string; email: string; telephone: string | null; vsp_id: string | null } } | { ok: false; erreur: string } {
  const t = (x: unknown, n: number) => String(x ?? "").trim().replace(/\s+/g, " ").slice(0, n);
  const prenom = t(c.prenom, 100), nom = t(c.nom, 100), email = t(c.email, 254).toLowerCase();
  const telephone = t(c.telephone, 40) || null, vsp_id = t(c.vsp_id, 100) || null;
  if (!EMAIL_RE.test(email)) return { ok: false, erreur: "e-mail invalide" };
  if (!prenom || !nom) return { ok: false, erreur: "prénom et nom obligatoires" };
  return { ok: true, v: { prenom, nom, email, telephone, vsp_id } };
}
export function niveauAuth(jwt: string): string {
  try {
    const p = jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(p + "=".repeat((4 - p.length % 4) % 4))).aal ?? "";
  } catch { return ""; }
}
export async function empreinte(jeton: string): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(jeton));
  return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
export function nouveauJeton(): string {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
const echapperLike = (s: string) => s.replace(/[\\%_]/g, (c) => "\\" + c);

// ---------------------------------------------------------------------------
// E-mail (même charte que les autres e-mails HT Portage)
// ---------------------------------------------------------------------------
export function esc(v: unknown): string {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}
const P = (t: string) => `<p style="margin:0 0 14px">${t}</p>`;
export function mailInvitation(prenom: string, lien: string) {
  const titre = "Votre espace consultant HT Portage est prêt";
  const corps =
    P(`Bonjour${prenom ? " " + esc(prenom) : ""},`) +
    P("Nous avons le plaisir de vous ouvrir votre <strong>espace consultant HT Portage</strong>. Vous y retrouverez vos contrats, vos missions, vos bulletins de paie et vos comptes d'activité, et pourrez mettre à jour vos informations personnelles.") +
    P("Pour l'activer, il vous suffit de choisir votre mot de passe en cliquant sur le bouton ci-dessous.") +
    `<p style="margin:0 0 14px;font-size:13px;color:#6B7385">Ce lien personnel est valable ${VALIDITE_JOURS} jours. Ensuite, vous pourrez toujours accéder à votre espace avec « Mot de passe oublié » sur la page de connexion, avec cette même adresse e-mail.</p>`;
  const bouton = `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0 8px"><tr><td style="background:#21324E;border-radius:999px">
        <a href="${esc(lien)}" style="display:inline-block;padding:13px 26px;font-family:Arial,sans-serif;font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none">Activer mon espace</a>
      </td></tr></table>`;
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(titre)}</title></head>
<body style="margin:0;padding:0;background:#F3F1F4">
<span style="display:none;max-height:0;overflow:hidden;opacity:0">Choisissez votre mot de passe pour accéder à vos contrats et documents.</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3F1F4"><tr><td align="center" style="padding:32px 12px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden">
    <tr><td style="background:#21324E;padding:22px 32px">
      <span style="font-family:Arial,sans-serif;font-size:18px;font-weight:bold;letter-spacing:3px;color:#ffffff">HT PORTAGE</span>
      <div style="width:36px;height:3px;background:#C187A1;margin-top:8px;border-radius:2px"></div>
    </td></tr>
    <tr><td style="padding:32px 32px 8px;font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#1B1C1C">
      <h1 style="margin:0 0 18px;font-size:21px;line-height:1.3;color:#21324E">${esc(titre)}</h1>
      ${corps}
      ${bouton}
    </td></tr>
    <tr><td style="padding:20px 32px 30px;font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#1B1C1C">
      <p style="margin:0">Bien cordialement,<br><strong style="color:#21324E">Service Administratif HT PORTAGE</strong><br>
      <a href="mailto:${CONTACT}" style="color:#784E61">${CONTACT}</a> · <a href="${SITE}" style="color:#784E61">www.htportage.fr</a></p>
    </td></tr>
    <tr><td style="background:#F7F5F8;padding:16px 32px;font-family:Arial,sans-serif;font-size:12px;line-height:1.5;color:#6B7385">
      HT Portage — portage salarial. Cet e-mail vous est adressé dans le cadre de votre espace consultant ; pour toute question, répondez simplement à ce message.
    </td></tr>
  </table>
</td></tr></table></body></html>`;
  const text = [
    `Bonjour${prenom ? " " + prenom : ""},`, "",
    "Nous avons le plaisir de vous ouvrir votre espace consultant HT Portage. Vous y retrouverez vos contrats, vos missions, vos bulletins de paie et vos comptes d'activité, et pourrez mettre à jour vos informations personnelles.", "",
    "Pour l'activer, choisissez votre mot de passe ici :", lien, "",
    `Ce lien personnel est valable ${VALIDITE_JOURS} jours. Ensuite, utilisez « Mot de passe oublié » sur la page de connexion, avec cette même adresse e-mail.`, "",
    "Bien cordialement,", "Service Administratif HT PORTAGE", `${CONTACT} · www.htportage.fr`,
  ].join("\n");
  return { sujet: titre, html, text };
}

async function envoyerMail(to: string, m: { sujet: string; html: string; text: string }) {
  if (!RESEND_API_KEY) return "Clé Resend absente (secret RESEND_API_KEY).";
  const from = (NOTIFY_FROM.match(/<([^>]+)>/)?.[1] ?? NOTIFY_FROM).trim() || "noreply@htportage.fr";
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: `HT PORTAGE <${from}>`, to: [to], subject: m.sujet, html: m.html, text: m.text, reply_to: NOTIFY_TO[0] ?? CONTACT }),
  });
  if (!r.ok) { const t = await r.text(); console.error("Resend", r.status, t); return "L'e-mail n'a pas pu être envoyé (Resend " + r.status + ")."; }
  console.log("Invitation envoyée", (await r.json().catch(() => ({})))?.id ?? "");
  return "";
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------
async function creer(liste: unknown) {
  if (!Array.isArray(liste) || !liste.length) return json({ erreur: "Aucun consultant à créer." }, 400);
  if (liste.length > 200) return json({ erreur: "200 consultants maximum par envoi." }, 400);
  const resultats = [];
  for (const brut of liste) {
    const c = nettoyerConsultant((brut ?? {}) as Record<string, unknown>);
    const email = String((brut as Record<string, unknown>)?.email ?? "");
    if (!c.ok) { resultats.push({ email, ok: false, erreur: c.erreur }); continue; }
    const v = c.v;
    try {
      const { data: existant } = await admin.from("profils").select("*").ilike("email", echapperLike(v.email)).maybeSingle();
      let id = existant?.id as string | undefined, cree = false;
      if (!id) {
        const { data, error } = await admin.auth.admin.createUser({ email: v.email, email_confirm: true, user_metadata: { prenom: v.prenom, nom: v.nom } });
        if (error || !data?.user) { resultats.push({ email: v.email, ok: false, erreur: /already|registered|exists/i.test(error?.message ?? "") ? "un compte existe déjà avec cette adresse" : (error?.message ?? "création impossible") }); continue; }
        id = data.user.id; cree = true;
      }
      const maj: Record<string, unknown> = { statut: "consultant" };
      if (!existant?.prenom) maj.prenom = v.prenom;
      if (!existant?.nom) maj.nom = v.nom;
      if (v.telephone && !existant?.telephone) maj.telephone = v.telephone;
      if (v.vsp_id) maj.vsp_id = v.vsp_id;
      // Le profil est créé par un déclencheur à la création du compte : on attend qu'il existe
      let erreur = "";
      for (let i = 0; i < 5; i++) {
        const { data: lignes, error } = await admin.from("profils").update(maj).eq("id", id).select("id");
        if (error) { erreur = /vsp_id/.test(error.message) ? "cet ID VSP est déjà utilisé par un autre compte" : error.message; break; }
        if (lignes?.length) { erreur = ""; break; }
        erreur = "profil introuvable"; await new Promise((r) => setTimeout(r, 300));
      }
      resultats.push({ email: v.email, id, ok: !erreur, cree, erreur: erreur || undefined });
    } catch (e) {
      resultats.push({ email: v.email, ok: false, erreur: String((e as Error)?.message ?? e) });
    }
  }
  return json({ resultats });
}

async function inviter(userId: unknown, par: string) {
  if (typeof userId !== "string" || !userId) return json({ erreur: "Consultant non précisé." }, 400);
  const { data: p } = await admin.from("profils").select("id, email, prenom").eq("id", userId).maybeSingle();
  if (!p) return json({ erreur: "Compte introuvable." }, 404);
  const jeton = nouveauJeton();
  const expire = new Date(Date.now() + VALIDITE_JOURS * 864e5).toISOString();
  const { error } = await admin.from("invitations").upsert({ user_id: p.id, jeton_hash: await empreinte(jeton), envoye_le: new Date().toISOString(), envoye_par: par, expire_le: expire, ouvert_le: null });
  if (error) return json({ erreur: /invitations/.test(error.message) ? "Lancez d'abord le script espace-v14.sql." : error.message }, 500);
  const echec = await envoyerMail(p.email, mailInvitation(p.prenom ?? "", `${SITE}/espace/activer.html?t=${jeton}`));
  if (echec) return json({ erreur: echec }, 502);
  return json({ ok: true, envoye_le: new Date().toISOString(), email: p.email });
}

async function activer(t: unknown, ip: string) {
  const { data: ok } = await admin.rpc("limiter", { p_cle: "activer:" + ip, p_max: 10, p_fenetre: 600 });
  if (ok === false) return json({ erreur: "Trop de tentatives. Réessayez dans quelques minutes." }, 429);
  if (typeof t !== "string" || t.length < 30 || t.length > 100) return json({ erreur: "Lien incomplet." }, 400);
  const { data: inv } = await admin.from("invitations").select("*").eq("jeton_hash", await empreinte(t)).maybeSingle();
  if (!inv) return json({ erreur: "Ce lien n'est plus valable : un lien plus récent vous a peut-être été envoyé." }, 404);
  if (new Date(inv.expire_le).getTime() < Date.now()) return json({ erreur: "Ce lien a expiré." , expire: true }, 410);
  const { data: u } = await admin.auth.admin.getUserById(inv.user_id);
  if (!u?.user?.email) return json({ erreur: "Compte introuvable." }, 404);
  const { data, error } = await admin.auth.admin.generateLink({ type: "recovery", email: u.user.email, options: { redirectTo: `${SITE}/espace/reset.html` } });
  if (error || !data?.properties?.action_link) { console.error("generateLink", error?.message); return json({ erreur: "Activation momentanément impossible. Réessayez dans un instant." }, 500); }
  if (!inv.ouvert_le) await admin.from("invitations").update({ ouvert_le: new Date().toISOString() }).eq("user_id", inv.user_id);
  return json({ url: data.properties.action_link });
}

const ipDe = (req: Request) => (req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip") || (req.headers.get("x-forwarded-for") ?? "").split(",")[0] || "inconnue").trim();

if (Deno.env.get("HTP_TEST") !== "1") Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ erreur: "Méthode non autorisée" }, 405);
  try {
    const corps = await req.json().catch(() => ({}));
    if (corps.action === "activer") return await activer(corps.t, ipDe(req));

    // Actions réservées aux administrateurs (double authentification validée)
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: u } = await admin.auth.getUser(token);
    if (!u?.user) return json({ erreur: "Session invalide : reconnectez-vous." }, 401);
    const { data: estAdmin } = await admin.from("admins").select("user_id").eq("user_id", u.user.id).maybeSingle();
    if (!estAdmin) return json({ erreur: "Réservé aux administrateurs HT Portage." }, 403);
    if (niveauAuth(token) !== "aal2") return json({ erreur: "Validez d'abord votre code de double authentification (reconnectez-vous)." }, 403);

    if (corps.action === "creer") return await creer(corps.consultants);
    if (corps.action === "inviter") return await inviter(corps.user_id, u.user.id);
    return json({ erreur: "Action inconnue." }, 400);
  } catch (e) {
    console.error(e);
    return json({ erreur: "Erreur inattendue." }, 500);
  }
});
