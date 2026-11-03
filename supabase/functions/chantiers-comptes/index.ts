// Chantiers — gestion des comptes (création, modification, suppression)
// Fonction « chantiers-comptes » du projet Supabase ht-portage ; données dans le schéma « chantiers ».
// Réservé à l'administrateur, sauf « installer » (premier compte admin, une seule fois).
// Verify JWT : désactivé (contrôle fait ici).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const URL_SB = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ORIGINES = (Deno.env.get("ORIGINES") || "https://chantiers.htportage.fr,http://localhost:8080")
  .split(",").map((s) => s.trim());

const db = createClient(URL_SB, SERVICE, { auth: { persistSession: false }, db: { schema: "chantiers" } });

function entetes(origine: string | null) {
  return {
    "Access-Control-Allow-Origin": origine && ORIGINES.includes(origine) ? origine : ORIGINES[0],
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
    "Content-Type": "application/json",
  };
}

class Erreur extends Error {
  constructor(msg: string, public code = 400) { super(msg); }
}

const ROLES = ["admin", "chef", "client"];
const emailOk = (e: unknown) => typeof e === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const texte = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");

function verifierMdp(m: unknown) {
  if (typeof m !== "string" || m.length < 8) throw new Error("Le mot de passe doit faire au moins 8 caractères.");
}

async function appelant(req: Request) {
  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) throw new Erreur("Non connecté", 401);
  const { data, error } = await db.auth.getUser(jwt);
  if (error || !data.user) throw new Erreur("Session expirée", 401);
  const { data: p } = await db.from("profils").select("id, role, actif").eq("id", data.user.id).maybeSingle();
  if (!p || p.role !== "admin" || !p.actif) throw new Erreur("Réservé à l'administrateur", 403);
  return data.user.id as string;
}

async function verifierProfil(b: Record<string, unknown>) {
  const role = String(b.role || "");
  if (!ROLES.includes(role)) throw new Error("Rôle inconnu.");
  const nom = texte(b.nom, 120);
  if (!nom) throw new Error("Le nom est obligatoire.");
  let client_id: string | null = null;
  if (role === "client") {
    client_id = String(b.client_id || "");
    const { data } = await db.from("clients").select("id").eq("id", client_id).maybeSingle();
    if (!data) throw new Error("Choisissez le client rattaché à ce compte.");
  }
  const chantiers = role === "chef" && Array.isArray(b.chantiers) ? (b.chantiers as unknown[]).map(String) : [];
  return { role, nom, client_id, telephone: texte(b.telephone, 40) || null, chantiers };
}

async function affecter(id: string, chantiers: string[]) {
  await db.from("affectations").delete().eq("profil_id", id);
  if (chantiers.length) {
    const { error } = await db.from("affectations").insert(chantiers.map((c) => ({ profil_id: id, chantier_id: c })));
    if (error) throw new Error("Chantiers attribués : " + error.message);
  }
}

async function creer(b: Record<string, unknown>) {
  const email = texte(b.email, 200).toLowerCase();
  if (!emailOk(email)) throw new Error("Adresse e-mail invalide.");
  verifierMdp(b.mot_de_passe);
  const p = await verifierProfil(b);
  const { data, error } = await db.auth.admin.createUser({
    email, password: String(b.mot_de_passe), email_confirm: true,
    app_metadata: { app: "chantiers" }, user_metadata: { nom: p.nom },
  });
  if (error || !data.user) {
    throw new Error(/already|registered|exists/i.test(error?.message || "") ? "Un compte existe déjà avec cette adresse." : (error?.message || "Création impossible."));
  }
  const id = data.user.id;
  const { error: e2 } = await db.from("profils").insert({ id, email, nom: p.nom, telephone: p.telephone, role: p.role, client_id: p.client_id });
  if (e2) { await db.auth.admin.deleteUser(id); throw new Error(e2.message); }
  await affecter(id, p.chantiers);
  return { id };
}

async function modifier(b: Record<string, unknown>, moi: string) {
  const id = String(b.id || "");
  const { data: avant } = await db.from("profils").select("id, role").eq("id", id).maybeSingle();
  if (!avant) throw new Error("Compte introuvable.");
  const { data: u } = await db.auth.admin.getUserById(id);
  if (u?.user?.app_metadata?.app !== "chantiers") throw new Error("Ce compte n'appartient pas à l'application Chantiers.");
  const p = await verifierProfil(b);
  const actif = b.actif !== false;
  if (id === moi && (p.role !== "admin" || !actif)) throw new Error("Vous ne pouvez pas retirer vos propres droits d'administrateur.");
  const maj: Record<string, unknown> = {};
  const email = texte(b.email, 200).toLowerCase();
  if (email) { if (!emailOk(email)) throw new Error("Adresse e-mail invalide."); maj.email = email; }
  if (b.mot_de_passe) { verifierMdp(b.mot_de_passe); maj.password = String(b.mot_de_passe); }
  if (Object.keys(maj).length) {
    const { error } = await db.auth.admin.updateUserById(id, maj);
    if (error) throw new Error(/already|registered|exists/i.test(error.message) ? "Un compte existe déjà avec cette adresse." : error.message);
  }
  const { error } = await db.from("profils").update({
    nom: p.nom, telephone: p.telephone, role: p.role, client_id: p.client_id, actif, ...(email ? { email } : {}),
  }).eq("id", id);
  if (error) throw new Error(error.message);
  await affecter(id, p.chantiers);
  // compte désactivé : connexion bloquée (et plus aucun accès aux données, cf. mon_role())
  await db.auth.admin.updateUserById(id, { ban_duration: actif ? "none" : "876000h" });
  return { id };
}

async function supprimer(b: Record<string, unknown>, moi: string) {
  const id = String(b.id || "");
  if (id === moi) throw new Error("Vous ne pouvez pas supprimer votre propre compte.");
  // seuls les comptes de l'application Chantiers peuvent être supprimés ici
  const { data: p } = await db.from("profils").select("id").eq("id", id).maybeSingle();
  if (!p) throw new Error("Compte introuvable.");
  const { data: u } = await db.auth.admin.getUserById(id);
  if (u?.user?.app_metadata?.app !== "chantiers") throw new Error("Ce compte n'appartient pas à l'application Chantiers.");
  const { error } = await db.auth.admin.deleteUser(id);
  if (error) throw new Error(error.message);
  return { id };
}

async function installer(b: Record<string, unknown>) {
  const { count } = await db.from("profils").select("id", { count: "exact", head: true }).eq("role", "admin");
  if ((count || 0) > 0) throw new Erreur("L'application est déjà installée.", 403);
  return await creer({ ...b, role: "admin" });
}

Deno.serve(async (req) => {
  const h = entetes(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response("ok", { headers: h });
  try {
    if (req.method !== "POST") throw new Erreur("Méthode non autorisée", 405);
    const b = await req.json().catch(() => ({})) as Record<string, unknown>;
    let r;
    if (b.action === "installer") r = await installer(b);
    else {
      const moi = await appelant(req);
      if (b.action === "creer") r = await creer(b);
      else if (b.action === "modifier") r = await modifier(b, moi);
      else if (b.action === "supprimer") r = await supprimer(b, moi);
      else throw new Erreur("Action inconnue");
    }
    return new Response(JSON.stringify({ ok: true, ...r }), { headers: h });
  } catch (e) {
    const code = e instanceof Erreur ? e.code : 400;
    return new Response(JSON.stringify({ ok: false, erreur: (e as Error).message }), { status: code, headers: h });
  }
});
