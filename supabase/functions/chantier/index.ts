// Outil « Chantier » : saisie des dépenses depuis un téléphone et imputation sur le budget global.
// Accès par code (en-tête x-chantier-code), sans compte :
//   CHANTIER_CODE        → saisie (dépenses, argent reçu)
//   CHANTIER_CODE_ADMIN  → saisie + budget (marché, payé initial, postes)
// Toutes les lectures et écritures passent par cette fonction (clé serveur) ; les tables ne sont pas exposées.
// Déploiement : « Verify JWT » désactivé.

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-chantier-code",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const CODE = Deno.env.get("CHANTIER_CODE") ?? "";
const CODE_ADMIN = Deno.env.get("CHANTIER_CODE_ADMIN") ?? "";
function serverKey(): string {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
    const vals = Array.isArray(keys) ? keys : Object.values(keys);
    return (vals.map((v: unknown) => typeof v === "string" ? v : (v as { key?: string })?.key).find(Boolean) as string) ?? "";
  } catch { return ""; }
}
const db = createClient(Deno.env.get("SUPABASE_URL") ?? "http://localhost", serverKey() || "x", { auth: { persistSession: false } });
const json = (c: unknown, s = 200) => new Response(JSON.stringify(c), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

function egal(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
const txt = (v: unknown, n = 200) => { const s = String(v ?? "").trim().replace(/\s+/g, " ").slice(0, n); return s || null; };
const nombre = (v: unknown) => { const n = Number(String(v ?? "").replace(/\s/g, "").replace(",", ".")); return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : NaN; };
const dateOk = (v: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(v ?? "")) ? String(v) : null;

async function etat(role: string) {
  const [lots, lignes, postes, dep, vers] = await Promise.all([
    db.from("chantier_lots").select("*").order("ordre"),
    db.from("chantier_lignes").select("*").order("ordre"),
    db.from("chantier_postes").select("*").order("ordre"),
    db.from("chantier_depenses").select("*").order("date", { ascending: false }).order("cree_le", { ascending: false }).limit(5000),
    db.from("chantier_versements").select("*").order("date", { ascending: false }).limit(2000),
  ]);
  const err = [lots, lignes, postes, dep, vers].find((r) => r.error);
  if (err) return json({ erreur: "Base non initialisée : lancez le script chantier.sql. (" + err.error!.message + ")" }, 500);
  return json({ role, lots: lots.data, lignes: lignes.data, postes: postes.data, depenses: dep.data, versements: vers.data });
}

async function photo(b64: string, type: string) {
  if (!["image/jpeg", "image/png", "image/webp"].includes(type)) throw new Error("Photo : format non pris en charge.");
  const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  if (bin.length > 5 * 1024 * 1024) throw new Error("Photo trop lourde.");
  const chemin = new Date().toISOString().slice(0, 7) + "/" + crypto.randomUUID() + "." + (type.split("/")[1] === "jpeg" ? "jpg" : type.split("/")[1]);
  const { error } = await db.storage.from("chantier").upload(chemin, bin, { contentType: type });
  if (error) throw new Error("Photo non enregistrée : " + error.message);
  return chemin;
}

if (Deno.env.get("HTP_TEST") !== "1") Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ erreur: "Méthode non autorisée" }, 405);
  try {
    if (!CODE) return json({ erreur: "Outil non configuré (secret CHANTIER_CODE manquant)." }, 503);
    const ip = (req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip") || (req.headers.get("x-forwarded-for") ?? "").split(",")[0] || "?").trim();
    const code = req.headers.get("x-chantier-code") ?? "";
    const role = egal(code, CODE_ADMIN) ? "admin" : egal(code, CODE) ? "saisie" : "";
    if (!role) {
      const { data: ok } = await db.rpc("limiter", { p_cle: "chantier-code:" + ip, p_max: 10, p_fenetre: 900 });
      return json({ erreur: ok === false ? "Trop d'essais. Réessayez dans 15 minutes." : "Code incorrect." }, 401);
    }
    const c = await req.json().catch(() => ({}));
    const qui = role === "admin" ? "admin" : "saisie";

    switch (c.action) {
      case "etat": return await etat(role);

      case "depense": {
        const d: Record<string, unknown> = {
          date: dateOk(c.date), poste: txt(c.poste, 100), lot_id: Number(c.lot_id) || null, detail: txt(c.detail, 300),
          montant: nombre(c.montant), paye_par: txt(c.paye_par, 60) || "Caisse",
        };
        if (!d.date || !d.poste || !(Number(d.montant) >= 0) || Number.isNaN(d.montant)) return json({ erreur: "Date, poste et montant obligatoires." }, 400);
        if (c.photo?.base64) d.photo = await photo(c.photo.base64, c.photo.type);
        if (role === "admin" && typeof c.deja_au_budget === "boolean") d.deja_au_budget = c.deja_au_budget;
        const r = c.id
          ? await db.from("chantier_depenses").update({ ...d, modifie_le: new Date().toISOString() }).eq("id", c.id).select().maybeSingle()
          : await db.from("chantier_depenses").insert({ ...d, saisi_par: qui }).select().maybeSingle();
        if (r.error) return json({ erreur: r.error.message }, 400);
        return json({ ok: true, depense: r.data });
      }
      case "depenses": { // plusieurs d'un coup (reprise de la semaine précédente)
        const lignes = (Array.isArray(c.lignes) ? c.lignes : []).slice(0, 60).map((l: Record<string, unknown>) => ({
          date: dateOk(l.date), poste: txt(l.poste, 100), lot_id: Number(l.lot_id) || null, detail: txt(l.detail, 300),
          montant: nombre(l.montant), paye_par: txt(l.paye_par, 60) || "Caisse", saisi_par: qui,
        })).filter((l: Record<string, unknown>) => l.date && l.poste && Number(l.montant) > 0);
        if (!lignes.length) return json({ erreur: "Aucune ligne à enregistrer." }, 400);
        const r = await db.from("chantier_depenses").insert(lignes);
        if (r.error) return json({ erreur: r.error.message }, 400);
        return json({ ok: true, n: lignes.length });
      }
      case "supprimer_depense": {
        const { data: d } = await db.from("chantier_depenses").select("photo, deja_au_budget").eq("id", c.id).maybeSingle();
        if (d?.deja_au_budget && role !== "admin") return json({ erreur: "Ligne historique : seul l'administrateur peut la supprimer." }, 403);
        const r = await db.from("chantier_depenses").delete().eq("id", c.id);
        if (r.error) return json({ erreur: r.error.message }, 400);
        if (d?.photo) await db.storage.from("chantier").remove([d.photo]);
        return json({ ok: true });
      }
      case "versement": {
        const v = { date: dateOk(c.date), libelle: txt(c.libelle, 200), montant: nombre(c.montant) };
        if (!v.date || Number.isNaN(v.montant) || !v.montant) return json({ erreur: "Date et montant obligatoires." }, 400);
        const r = c.id ? await db.from("chantier_versements").update(v).eq("id", c.id) : await db.from("chantier_versements").insert({ ...v, saisi_par: qui });
        if (r.error) return json({ erreur: r.error.message }, 400);
        return json({ ok: true });
      }
      case "supprimer_versement": {
        const r = await db.from("chantier_versements").delete().eq("id", c.id);
        if (r.error) return json({ erreur: r.error.message }, 400);
        return json({ ok: true });
      }
      case "photo": {
        const { data: d } = await db.from("chantier_depenses").select("photo").eq("id", c.id).maybeSingle();
        if (!d?.photo) return json({ erreur: "Pas de photo." }, 404);
        const { data: u } = await db.storage.from("chantier").createSignedUrl(d.photo, 300);
        return json({ url: u?.signedUrl });
      }
      // ----- administration du budget -----
      case "lot": {
        if (role !== "admin") return json({ erreur: "Réservé à l'administrateur." }, 403);
        const l: Record<string, unknown> = {};
        if (c.nom != null) l.nom = txt(c.nom, 200);
        if (c.remarque !== undefined) l.remarque = txt(c.remarque, 500);
        if (c.marche != null) l.marche = nombre(c.marche);
        if (c.paye_initial != null) l.paye_initial = nombre(c.paye_initial);
        if (Object.values(l).some((v) => Number.isNaN(v))) return json({ erreur: "Montant invalide." }, 400);
        const r = c.id ? await db.from("chantier_lots").update(l).eq("id", c.id) : await db.from("chantier_lots").insert({ ...l, code: txt(c.code, 20), ordre: Number(c.ordre) || 999 });
        if (r.error) return json({ erreur: r.error.message }, 400);
        return json({ ok: true });
      }
      case "poste": {
        if (role !== "admin") return json({ erreur: "Réservé à l'administrateur." }, 403);
        const p = { nom: txt(c.nom, 100), lot_id: Number(c.lot_id) || null, actif: c.actif !== false };
        if (!p.nom) return json({ erreur: "Nom du poste obligatoire." }, 400);
        const r = c.id ? await db.from("chantier_postes").update(p).eq("id", c.id) : await db.from("chantier_postes").insert({ ...p, ordre: 999 });
        if (r.error) return json({ erreur: /duplicate|unique/i.test(r.error.message) ? "Ce poste existe déjà." : r.error.message }, 400);
        return json({ ok: true });
      }
      default: return json({ erreur: "Action inconnue." }, 400);
    }
  } catch (e) {
    console.error(e);
    return json({ erreur: (e as Error).message || "Erreur inattendue." }, 500);
  }
});
