// HT Portage — synchronisation de l'espace depuis VSP (VSAPI Veryswing), en lecture seule sur VSP.
//
// Actions (POST { action, mois? }) :
//   explorer   lit un échantillon de chaque route utile et renvoie la STRUCTURE des réponses
//              (noms de champs, types, formats, valeurs des seuls champs « code »), jamais de données personnelles.
//   apercu     calcule ce que la synchronisation changerait (mois: "AAAA-MM" ou liste ; défaut : mois écoulé + mois en cours), sans rien écrire
//   appliquer  écrit dans l'espace : comptes (sans e-mail), profils, missions, comptes d'activité, notes de frais
//   auto       (serveur seulement) mois écoulé, une seule fois, quand tous ses CRA sont VALIDATED
//
// Accès : administrateur (session + table admins + aal2), ou appel serveur portant l'en-tête
// x-cron-secret égal au secret « vsp_sync_cron » du coffre Supabase (Vault), lu par public.vsp_sync_secret().
// Déploiement : « Verify JWT » désactivé, comme « consultants » et « vsp-proxy ».
//
// Secrets : VSP_API_URL, VSP_LOGIN, VSP_PASSWORD (les mêmes que vsp-proxy).
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

const API = (Deno.env.get("VSP_API_URL") ?? "").replace(/\/+$/, "");
const LOGIN = Deno.env.get("VSP_LOGIN") ?? "";
const PASSWORD = Deno.env.get("VSP_PASSWORD") ?? "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// ---------- Client VSP ----------
let vspToken: string | null = null;
let vspTokenAt = 0;
async function getToken(force = false): Promise<string> {
  if (!force && vspToken && Date.now() - vspTokenAt < 20 * 3600_000) return vspToken;
  if (!API || !LOGIN || !PASSWORD) throw new Error("NOT_CONFIGURED : secrets VSP absents");
  const r = await fetch(`${API}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ login: LOGIN, password: PASSWORD, authType: "api" }),
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`AUTH_FAILED : connexion VSP refusée (HTTP ${r.status})`);
  const b = await r.json().catch(() => ({}));
  if (!b.token) throw new Error("AUTH_FAILED : réponse /login sans jeton");
  vspToken = b.token; vspTokenAt = Date.now();
  return vspToken!;
}
type VspRes = { status: number; body: unknown; total: number | null; next: number | null };
async function vspGet(path: string, params: Record<string, unknown> = {}, retried = false): Promise<VspRes> {
  const t = await getToken();
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v != null && v !== "") q.set(k, String(v));
  const r = await fetch(`${API}${path}${q.toString() ? "?" + q : ""}`, {
    headers: { Authorization: `Bearer ${t}`, Accept: "application/json" },
    signal: AbortSignal.timeout(30000),
  });
  if (r.status === 401 && !retried) { await getToken(true); return vspGet(path, params, true); }
  const text = await r.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { _illisible: text.slice(0, 120) }; }
  const total = r.headers.get("X-Total-Count");
  const next = r.headers.get("X-Paginate-Next");
  return { status: r.status, body, total: total != null ? Number(total) : null, next: next ? Number(next) : null };
}

// ---------- Exploration : structure seulement ----------
// Champs dont les valeurs sont des codes de référentiel (non personnels) : on montre les valeurs distinctes.
const CODES = new Set(["workflowStatus", "status", "type", "typeCode", "contractTypeCode", "contractStatusCode", "contractStepCode",
  "trialPeriodStatutCode", "documentType", "documentState", "paymentStatus", "prestation", "billingMethod", "entityName", "entityLegalCurrent",
  "currencyCode", "payementMeanCode", "periodClosed", "locked", "archived", "refundable", "moment", "serviceName", "submissionDelay"]);
function forme(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "number") return Number.isInteger(v) ? "entier" : "décimal";
  if (typeof v === "boolean") return "booléen";
  if (typeof v === "string") {
    if (v === "") return "texte vide";
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return "date AAAA-MM-JJ";
    if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(v)) return "date-heure";
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(v)) return "date JJ/MM/AAAA";
    if (/^-?\d+([.,]\d+)?$/.test(v)) return "nombre en texte";
    if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) return "e-mail";
    return "texte";
  }
  if (Array.isArray(v)) return "tableau";
  return "objet";
}
type Champ = { formes: Record<string, number>; valeurs?: Set<string>; sous?: Map<string, Champ> };
function analyser(objs: unknown[], acc = new Map<string, Champ>()) {
  for (const o of objs) {
    if (!o || typeof o !== "object" || Array.isArray(o)) continue;
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      const c = acc.get(k) ?? { formes: {} };
      const f = forme(v);
      c.formes[f] = (c.formes[f] ?? 0) + 1;
      if (CODES.has(k) && (typeof v === "string" || typeof v === "number" || typeof v === "boolean")) {
        c.valeurs = c.valeurs ?? new Set();
        if (c.valeurs.size < 25) c.valeurs.add(String(v));
      }
      if (f === "objet") c.sous = analyser([v], c.sous ?? new Map());
      if (f === "tableau") c.sous = analyser((v as unknown[]).flat(3), c.sous ?? new Map());
      acc.set(k, c);
    }
  }
  return acc;
}
function rendre(acc: Map<string, Champ>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, c] of acc) {
    out[k] = {
      formes: c.formes,
      ...(c.valeurs ? { valeurs: [...c.valeurs] } : {}),
      ...(c.sous && c.sous.size ? { champs: rendre(c.sous) } : {}),
    };
  }
  return out;
}
const items = (b: unknown): unknown[] => (Array.isArray(b) ? b : b && typeof b === "object" ? [b] : []);
function moisPrecedent(): { y: number; m: number; debut: string; fin: string } {
  const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1);
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1;
  const fin = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { y, m, debut: `${y}-${String(m).padStart(2, "0")}-01`, fin };
}

async function explorer() {
  const mp = moisPrecedent();
  const today = new Date().toISOString().slice(0, 10);
  const rapport: Record<string, unknown> = {};
  const echantillon = 25;
  async function sonder(nom: string, path: string, params: Record<string, unknown> = {}) {
    try {
      const r = await vspGet(path, { limit: echantillon, offset: 1, ...params });
      const it = items(r.body);
      rapport[nom] = { route: path, http: r.status, total: r.total, lus: it.length, champs: r.status < 300 ? rendre(analyser(it)) : undefined,
        erreur: r.status >= 300 ? JSON.stringify(r.body).slice(0, 200) : undefined };
      return it as Record<string, unknown>[];
    } catch (e) {
      rapport[nom] = { route: path, erreur: String((e as Error).message ?? e).slice(0, 200) };
      return [];
    }
  }
  await getToken(); // échoue tout de suite si les accès sont faux
  const users = await sonder("utilisateurs", "/v1/users/list", { active: true });
  await sonder("salaries_infos", "/v1/hr/employees/information", { date: today });
  await sonder("contrats", "/v1/hr/employees/contract", { current: true });
  const aff = await sonder("affectations", "/v1/orders/assignments");
  await sonder("affaires", "/v1/orders");
  const code = (aff.find((a) => a.orderCode)?.orderCode as string) ?? null;
  if (code) {
    await sonder("affaire_fiche", `/v1/order/${encodeURIComponent(code)}`);
    const volets = await sonder("affaire_volets", `/v1/order/${encodeURIComponent(code)}/details`);
    const reg = volets.find((v) => String(v.type ?? "").toUpperCase() === "REGIE");
    if (reg) await sonder("volet_regie", `/v1/order/${encodeURIComponent(code)}/regie/${encodeURIComponent(String(reg.id))}`);
  }
  await sonder("cra_vue_ensemble", "/v1/activity/overview", { year: mp.y, month: mp.m });
  const uid = users.find((u) => u.userId)?.userId;
  if (uid != null) await sonder("cra_mensuel", "/v1/activity/timesheet/monthly", { year: mp.y, month: mp.m, userId: uid });
  await sonder("notes_frais", "/v1/expenses", { start: mp.debut, end: mp.fin });
  await sonder("notes_frais_entetes", "/v1/expense/headers", { year: mp.y, month: mp.m });
  await sonder("documents", "/v1/media");
  await sonder("paie_exports", "/v1/interface/payevent/export");
  await sonder("factures", "/v1/billing/invoices", { invoiceDateMin: mp.debut, invoiceDateMax: mp.fin });
  await sonder("entites", "/v1/entities");
  return { mois_reference: `${mp.y}-${String(mp.m).padStart(2, "0")}`, api: new URL(API).host, rapport };
}

// =====================================================================
// Synchronisation : VSP fait foi sur les champs qu'il fournit.
// Jamais repris : n° de sécurité sociale, IBAN, BIC, salaires. Jamais touché : statut du dossier,
// net versé, salaire chargé, frais pro, réserve, charges, frais de gestion de la mission (%).
// =====================================================================
type O = Record<string, unknown>;

// ---------- Suivi d'avancement (lu par l'administration toutes les 1,5 s) ----------
type Etape = { fait?: number; total?: number; texte?: string; fini?: boolean };
class Suivi {
  etapes: Record<string, Etape> = {};
  dernier = 0;
  id: string | null; par: string; action: string;
  constructor(id: string | null, par = "", action = "") { this.id = id; this.par = par; this.action = action; }
  async demarrer() {
    if (!this.id) return;
    await admin.from("vsp_sync_suivi").upsert({ id: this.id, par: this.par, action: this.action, etapes: {}, fini: false, maj: new Date().toISOString() });
  }
  maj(cle: string, e: Etape) {
    this.etapes[cle] = { ...(this.etapes[cle] ?? {}), ...e };
    const n = Date.now();
    if (n - this.dernier > 1000 || e.fini) { this.dernier = n; this.ecrire().catch(() => {}); }
  }
  async ecrire(fini = false) {
    if (!this.id) return;
    await admin.from("vsp_sync_suivi").update({ etapes: this.etapes, fini, maj: new Date().toISOString() }).eq("id", this.id);
  }
}
let SUIVI = new Suivi(null);
// Verrou : un seul passage qui écrit à la fois (un passage muet depuis 3 min est considéré comme abandonné)
async function passageEnCours(saufId: string | null) {
  const { data } = await admin.from("vsp_sync_suivi").select("id, par, action").eq("fini", false).neq("action", "apercu").gt("maj", new Date(Date.now() - 3 * 60000).toISOString()).limit(5);
  return (data ?? []).find((x) => x.id !== saufId) ?? null;
}
const s = (v: unknown) => (v == null ? "" : String(v).trim().replace(/\s+/g, " "));
const lower = (v: unknown) => s(v).toLowerCase();
const num = (v: unknown) => { const n = Number(s(v).replace(",", ".")); return s(v) !== "" && Number.isFinite(n) ? n : null; };
const cle = (v: unknown) => s(v).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim().split(" ").sort().join(" ");
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const auj = () => new Date().toISOString().slice(0, 10);
const arrondi = (n: number) => Math.round(n * 100) / 100;
const pays = (code: unknown) => {
  const c = s(code).toUpperCase();
  if (!c || c === "FR") return "France";
  try { return new Intl.DisplayNames(["fr"], { type: "region" }).of(c) ?? c; } catch { return c; }
};
function civilite(title: unknown, gender: unknown): string | null {
  const t = lower(title), g = lower(gender);
  if (/^(mme|madame|mlle|mademoiselle)/.test(t) || /^(f|femme|female|mme)/.test(g)) return "Mme";
  if (/^(m\.?|mr|monsieur)$/.test(t) || /^(m|h|homme|male|masculin)/.test(g)) return "M.";
  return null;
}

async function toutes(path: string, params: O = {}): Promise<O[]> {
  const out: O[] = [];
  for (let page = 1; page <= 50; page++) {
    const r = await vspGet(path, { ...params, limit: 1000, offset: page });
    if (r.status >= 300) throw new Error(`VSP ${path} : HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
    const it = items(r.body) as O[];
    out.push(...it);
    if (it.length < 1000 || (r.next != null && r.next <= page)) break;
  }
  return out;
}
const lireUn = async (path: string, params: O = {}) => {
  const r = await vspGet(path, params);
  if (r.status >= 300) throw new Error(`VSP ${path} : HTTP ${r.status}`);
  return r.body as O;
};

type ProfilVsp = { userId: string; emails: string[]; email: string; nom: string; prenom: string; champs: O; login: string; colName: string };
type MissionVsp = { orderCode: string; champs: O; tjm: number | null };

async function lireVsp(moisListe: string[]) {
  SUIVI.maj("base", { texte: "lecture de VSP…" });
  const [users, infos, contrats, affs] = await Promise.all([
    toutes("/v1/users/list", { active: true }),
    toutes("/v1/hr/employees/information", { date: auj() }),
    toutes("/v1/hr/employees/contract", { current: true }),
    toutes("/v1/orders/assignments"),
  ]);
  const infoPar = new Map<string, O>(); for (const i of infos) { if (lower(i.email)) infoPar.set(lower(i.email), i); if (lower(i.personalEmail)) infoPar.set(lower(i.personalEmail), i); }
  const contratPar = new Map<string, O>(); for (const c of contrats) contratPar.set(lower(c.login), c);
  const affPar = new Map<string, O[]>(); for (const a of affs) { if (a.archived === true) continue; const k = lower(a.colLogin); affPar.set(k, [...(affPar.get(k) ?? []), a]); }

  // Fiches d'affaires et volets de régie (TJM, n° de contrat), une fois par affaire
  const codes = [...new Set(affs.filter((a) => a.archived !== true).map((a) => s(a.orderCode)).filter(Boolean))];
  const affaires = new Map<string, { fiche: O; regies: O[] }>();
  SUIVI.maj("base", { fini: true, texte: `${users.length} salariés, ${affs.length} affectations` });
  let nAff = 0;
  for (const code of codes) {
    const fiche = await lireUn(`/v1/order/${encodeURIComponent(code)}`);
    const volets = items(await lireUn(`/v1/order/${encodeURIComponent(code)}/details`)) as O[];
    const regies: O[] = [];
    for (const v of volets.filter((x) => s(x.type).toUpperCase() === "REGIE")) regies.push(await lireUn(`/v1/order/${encodeURIComponent(code)}/regie/${encodeURIComponent(s(v.id))}`));
    affaires.set(code, { fiche, regies });
    SUIVI.maj("affaires", { fait: ++nAff, total: codes.length, texte: code });
  }

  const consultants: { p: ProfilVsp; missions: MissionVsp[] }[] = [];
  for (const u of users) {
    const login = lower(u.login), info = infoPar.get(lower(u.email)) ?? infoPar.get(login) ?? {};
    const contrat = contratPar.get(login), mesAffs = affPar.get(login) ?? [];
    if (!contrat && !mesAffs.length) continue; // pas consultant porté (équipe, compte technique…)
    const emails = [lower(info.personalEmail), lower(u.email), lower(info.email), login].filter((e, i, t) => EMAIL.test(e) && t.indexOf(e) === i);
    // Prénoms multiples « Anne-Caroline, Raymonde » : l'espace garde le premier (comme l'ancienne migration)
    const nom = s(info.lastname) || s(u.lastname), prenom = (s(info.firstname) || s(u.firstname)).split(",")[0].trim();
    const fin = s(info.endingDate);
    const lieu = s(info.birthPlace), paysN = s(info.birthCountry);
    const naiss = s(info.birthDate);
    const champs: O = {
      prenom: prenom.slice(0, 100) || null, nom: nom.slice(0, 100) || null,
      civilite: civilite(info.title, info.gender),
      telephone: (s(info.personalMobilePhoneNumber) || s(info.proMobilePhoneNumber) || s(info.personalPhoneNumber) || s(info.proPhoneNumber)).slice(0, 40) || null,
      adresse: [s(info.personalAddress), s(info.personalAddress2)].filter(Boolean).join(", ").slice(0, 300) || null,
      code_postal: s(info.personalZipcode).slice(0, 20) || null,
      ville: s(info.personalCity).slice(0, 100) || null,
      pays: pays(info.personalCountryCode2).slice(0, 100),
      date_naissance: /^\d{4}-\d{2}-\d{2}$/.test(naiss) && naiss >= "1930-01-01" && naiss <= auj() ? naiss : null,
      lieu_naissance: lieu ? (paysN && !/^france$/i.test(paysN) ? `${lieu} (${paysN})` : lieu).slice(0, 150) : null,
      nationalite: s(info.nationality).slice(0, 100) || null,
      competences: s(contrat?.jobTitle).slice(0, 500) || null,
      statut: fin && fin <= auj() ? "sorti" : "consultant",
      vsp_id: s(u.userId),
    };
    const colName = s(mesAffs[0]?.colName) || `${nom} ${prenom}`;
    const missions: MissionVsp[] = [];
    const parCode: Record<string, O[]> = {};
    for (const a of mesAffs) (parCode[s(a.orderCode)] ??= []).push(a);
    for (const [code, liste] of Object.entries(parCode)) {
      if (!code) continue;
      const af = affaires.get(code); if (!af) continue;
      const debut = liste.map((a) => s(a.startDate)).filter(Boolean).sort()[0] || null;
      const fins = liste.map((a) => s(a.endDate)).filter(Boolean).sort();
      const finM = fins[fins.length - 1] || null;
      // TJM et n° de contrat : ligne du volet régie à son nom, la plus récente
      let tjm: number | null = null, contratNo = "";
      for (const r of af.regies) {
        const lignes = (Array.isArray(r.detail) ? (r.detail as O[]).flat(3) : []) as O[];
        const miennes = lignes.filter((l) => cle(l.who) === cle(colName)).sort((a, b) => s(b.start_date).localeCompare(s(a.start_date)));
        const l = miennes[0] ?? (lignes.length === 1 ? lignes[0] : undefined);
        if (l) { const t = num(l.currency_ht_unit ?? l.currencyHtUnit); if (t != null) tjm = t; contratNo = s(r.contractNumber) || contratNo; }
      }
      if (tjm != null && (tjm < 100 || tjm > 5000)) tjm = null;
      // « Assistance technique _ Développeur .NET » → « Assistance technique – Développeur .NET » (format de l'espace)
      const intitule = (s(af.fiche.title) || s(liste[0].description) || "Assistance technique").replace(/\s*_\s*/g, " – ").replace(/[\s–-]+$/, "");
      missions.push({
        orderCode: code, tjm,
        champs: {
          intitule: (intitule.length >= 2 ? intitule : "Assistance technique").slice(0, 300),
          client: s(af.fiche.customer).slice(0, 200) || s(liste[0].tiersName).slice(0, 200) || null,
          client_final: s(af.fiche.customerFinal).slice(0, 200) || null,
          date_debut: debut, date_fin: finM && debut && finM < debut ? null : finM,
          tjm, numero_contrat: contratNo.slice(0, 50) || null, vsp_id: code.slice(0, 100),
          htp_interlocuteur_nom: s(af.fiche.commercial).slice(0, 200) || null,
        },
      });
    }
    consultants.push({ p: { userId: s(u.userId), emails, email: emails[0] ?? "", nom, prenom, champs, login, colName }, missions });
  }

  // Comptes d'activité et notes de frais des mois demandés
  const cra = new Map<string, Map<string, { jours: number; parAffaire: Record<string, number>; statut: string }>>();
  const frais = new Map<string, O[]>();
  SUIVI.maj("affaires", { fini: true, fait: codes.length, total: codes.length, texte: `${codes.length} affaires` });
  let nCra = 0, nFrais = 0;
  for (const mois of moisListe) {
    const [y, m] = mois.split("-").map(Number);
    const parUser = new Map<string, { jours: number; parAffaire: Record<string, number>; statut: string }>();
    for (const c of consultants) {
      SUIVI.maj("cra", { fait: ++nCra, total: moisListe.length * consultants.length, texte: `${mois} · ${c.p.prenom} ${c.p.nom}` });
      const r = await vspGet("/v1/activity/timesheet/monthly", { year: y, month: m, userId: c.p.userId });
      if (r.status >= 300 || !r.body) continue;
      const b = (Array.isArray(r.body) ? r.body[0] : r.body) as O;
      const parAffaire: Record<string, number> = {};
      for (const it of (Array.isArray(b?.breakdown) ? b.breakdown : []) as O[]) {
        const code = s(it.orderCode); if (!code) continue;
        parAffaire[code] = (parAffaire[code] ?? 0) + (num(it.totalDays) ?? 0);
      }
      const jours = Object.values(parAffaire).reduce((a, x) => a + x, 0);
      parUser.set(c.p.userId, { jours, parAffaire, statut: s(b?.workflowStatus) });
    }
    cra.set(mois, parUser);
    frais.set(mois, await toutes("/v1/expenses", { start: mois, end: mois }));
    SUIVI.maj("frais", { fait: ++nFrais, total: moisListe.length, texte: mois });
  }
  SUIVI.maj("cra", { fini: true });
  SUIVI.maj("frais", { fini: true });
  return { consultants, cra, frais };
}

type Plan = {
  mois: string[];
  comptes_crees: { email: string; nom: string }[];
  profils: { qui: string; champs: string[] }[];
  missions: { qui: string; affaire: string; nouvelle: boolean; champs: string[] }[];
  activite: { qui: string; mois: string; jours: number; ca_ht: number | null; cra: string }[];
  frais: { qui: string; mois: string; lignes: number; total_ttc: number }[];
  ignores: string[];
};
// Égalité « métier » : nombres comparés en valeur (470 = 470.00), noms de personnes sans ordre ni casse ni accents
const NOMS_PERSONNE = new Set(["htp_interlocuteur_nom", "prenom", "nom"]);
function pareil(a: unknown, b: unknown, champ = ""): boolean {
  const va = a == null || a === "" ? null : a, vb = b == null || b === "" ? null : b;
  if (va === null || vb === null) return va === vb;
  if (typeof vb === "number" || typeof va === "number") return Number(va) === Number(vb);
  if (NOMS_PERSONNE.has(champ)) return cle(va) === cle(vb);
  return String(va) === String(vb);
}

async function synchroniser(moisListe: string[], appliquer: boolean): Promise<Plan> {
  const vsp = await lireVsp(moisListe);
  const plan: Plan = { mois: moisListe, comptes_crees: [], profils: [], missions: [], activite: [], frais: [], ignores: [] };

  const { data: profils } = await admin.from("profils").select("id,email,prenom,nom,civilite,telephone,adresse,code_postal,ville,pays,date_naissance,lieu_naissance,nationalite,competences,statut,vsp_id");
  const { data: adminsL } = await admin.from("admins").select("user_id");
  const idsAdmins = new Set((adminsL ?? []).map((a) => a.user_id));
  const emailsAdmins = new Set((profils ?? []).filter((p) => idsAdmins.has(p.id)).map((p) => lower(p.email)));
  const parVsp = new Map((profils ?? []).filter((p) => p.vsp_id).map((p) => [String(p.vsp_id), p]));
  const parEmail = new Map((profils ?? []).map((p) => [lower(p.email), p]));

  let nEcr = 0;
  for (const c of vsp.consultants) {
    const qui = `${c.p.prenom} ${c.p.nom}`.trim() || c.p.email;
    SUIVI.maj("ecriture", { fait: ++nEcr, total: vsp.consultants.length, texte: (appliquer ? "enregistrement : " : "comparaison : ") + qui });
    if (c.p.emails.some((e) => emailsAdmins.has(e))) { plan.ignores.push(`${qui} : compte administrateur HT Portage`); continue; }
    let prof = parVsp.get(c.p.userId) ?? c.p.emails.map((e) => parEmail.get(e)).find(Boolean);
    if (!prof && !c.p.email) { plan.ignores.push(`${qui} : aucune adresse e-mail dans VSP`); continue; }
    if (prof && !parVsp.get(c.p.userId) && prof.vsp_id && String(prof.vsp_id) !== c.p.userId) { plan.ignores.push(`${qui} : l'espace a déjà un autre ID VSP (${prof.vsp_id})`); continue; }
    // Profil
    if (!prof) {
      plan.comptes_crees.push({ email: c.p.email, nom: qui });
      if (appliquer) {
        const { data, error } = await admin.auth.admin.createUser({ email: c.p.email, email_confirm: true, user_metadata: { prenom: c.p.prenom, nom: c.p.nom } });
        if (error || !data?.user) { plan.ignores.push(`${qui} : création du compte impossible (${error?.message ?? "erreur"})`); continue; }
        prof = { id: data.user.id, email: c.p.email } as typeof prof;
      }
    }
    const diff = Object.entries(c.p.champs).filter(([k, v]) => v != null && v !== "" && !pareil(prof?.[k as keyof typeof prof], v, k));
    // Le statut « sorti » vient de VSP ; un candidat devient consultant ; on ne rétrograde jamais un consultant en candidat
    if (diff.length) {
      plan.profils.push({ qui, champs: diff.map(([k]) => k) });
      if (appliquer && prof?.id) {
        const { error } = await admin.from("profils").update(Object.fromEntries(diff)).eq("id", prof.id);
        if (error) plan.ignores.push(`${qui} : profil non mis à jour (${error.message})`);
      }
    }
    const userId = prof?.id as string | undefined;

    // Missions
    const { data: existantes } = userId ? await admin.from("consultant_missions").select("id,intitule,client,client_final,date_debut,date_fin,tjm,numero_contrat,vsp_id,htp_interlocuteur_nom,statut,frais_gestion").eq("user_id", userId) : { data: [] as O[] };
    const tauxGestion: Record<string, number> = {};
    for (const m of c.missions) {
      const ex = (existantes ?? []).find((e) => s(e.vsp_id) === m.orderCode || (m.champs.numero_contrat && s(e.numero_contrat) === m.champs.numero_contrat));
      const statutVsp = m.champs.date_fin && String(m.champs.date_fin) < auj() ? "terminee" : "active";
      const champs: O = { ...m.champs };
      // Le circuit de contractualisation de l'espace garde la main tant que la mission n'est pas active
      if (!ex || ["active", "terminee", "validee"].includes(s(ex.statut))) champs.statut = statutVsp;
      const d = Object.entries(champs).filter(([k, v]) => v != null && v !== "" && !pareil(ex?.[k], v, k));
      tauxGestion[m.orderCode] = num(ex?.frais_gestion) ?? 5;
      // TJM absent de VSP (volet régie sans ligne à son nom) : le CA se calcule avec le TJM déjà connu de l'espace
      if (m.tjm == null && num(ex?.tjm) != null) m.tjm = num(ex?.tjm);
      if (!ex || d.length) {
        plan.missions.push({ qui, affaire: m.orderCode, nouvelle: !ex, champs: d.map(([k]) => k) });
        if (appliquer && userId) {
          const { error } = ex
            ? await admin.from("consultant_missions").update(Object.fromEntries(d)).eq("id", ex.id as string)
            : await admin.from("consultant_missions").insert({ ...Object.fromEntries(Object.entries(champs).filter(([, v]) => v != null)), user_id: userId });
          if (error) plan.ignores.push(`${qui} / ${m.orderCode} : mission non enregistrée (${error.message})`);
        }
      }
    }

    // Comptes d'activité : jours facturables × TJM de l'affaire ; frais de gestion au taux de la mission
    for (const mois of plan.mois) {
      const a = vsp.cra.get(mois)?.get(c.p.userId);
      if (!a || (!a.jours && !Object.keys(a.parAffaire).length)) continue;
      let ca = 0, caConnu = true, fg = 0;
      for (const [code, j] of Object.entries(a.parAffaire)) {
        const t = c.missions.find((m) => m.orderCode === code)?.tjm;
        if (t == null) { caConnu = false; continue; }
        ca += j * t; fg += j * t * (tauxGestion[code] ?? 5) / 100;
      }
      const ligne = { jours: arrondi(a.jours), ca_ht: caConnu ? arrondi(ca) : null, frais_gestion: caConnu ? arrondi(fg) : null, source: "vsp" };
      plan.activite.push({ qui, mois, jours: ligne.jours, ca_ht: ligne.ca_ht, cra: a.statut });
      if (appliquer && userId) {
        const moisD = `${mois}-01`;
        const { data: ex } = await admin.from("comptes_activite").select("id").eq("user_id", userId).eq("mois", moisD).maybeSingle();
        const { error } = ex
          ? await admin.from("comptes_activite").update(ligne).eq("id", ex.id)
          : await admin.from("comptes_activite").insert({ ...ligne, user_id: userId, mois: moisD, statut: "provisoire" });
        if (error) plan.ignores.push(`${qui} / ${mois} : compte d'activité non enregistré (${error.message})`);
      }
    }

    // Justificatif : VSP signale les pièces jointes d'une ligne par un champ dont le nom évoque un fichier
    // (attachments, medias, receipt, files…). true/false s'il existe, null si VSP ne fournit pas l'information.
    const justificatif = (f: O): boolean | null => {
      let vu = false;
      for (const [k, v] of Object.entries(f)) {
        if (!/attach|media|receipt|justif|file|proof|piece|pj|document/i.test(k) || /type|state|code/i.test(k)) continue;
        vu = true;
        if (Array.isArray(v) ? v.length > 0 : typeof v === "number" ? v > 0 : Boolean(v)) return true;
      }
      return vu ? false : null;
    };
    // Notes de frais. L'id d'une ligne VSP n'est unique que pour un même salarié : la clé combine
    // salarié, en-tête de note et ligne. Les lignes disparues de VSP pour ce mois sont retirées (VSP fait foi).
    for (const mois of plan.mois) {
      const lignes = (vsp.frais.get(mois) ?? []).filter((f) => s(f.userId) === c.p.userId);
      const cleFrais = (f: O) => `${c.p.userId}-${s(f.headerId)}-${s(f.id)}`.slice(0, 100);
      if (appliquer && userId) {
        const garder = lignes.map(cleFrais);
        const { data: avant } = await admin.from("notes_frais").select("id,vsp_id").eq("user_id", userId).eq("mois", `${mois}-01`);
        const aRetirer = (avant ?? []).filter((r) => !garder.includes(r.vsp_id)).map((r) => r.id);
        if (aRetirer.length) await admin.from("notes_frais").delete().in("id", aRetirer);
      }
      if (!lignes.length) continue;
      plan.frais.push({ qui, mois, lignes: lignes.length, total_ttc: arrondi(lignes.reduce((t, f) => t + (num(f.amountTi) ?? 0), 0)) });
      if (appliquer && userId) {
        const rows = lignes.map((f) => ({
          vsp_id: cleFrais(f), user_id: userId, mois: `${mois}-01`,
          date_frais: /^\d{4}-\d{2}-\d{2}/.test(s(f.date)) ? s(f.date).slice(0, 10) : null,
          type: (s(f.type) || s(f.typeCode)).slice(0, 150) || null,
          montant_ht: num(f.amountTf), montant_ttc: num(f.amountTi), devise: s(f.currencyCode).slice(0, 3) || "EUR",
          motif: s(f.reason).slice(0, 500) || null,
          justificatif: justificatif(f),
        }));
        const { error } = await admin.from("notes_frais").upsert(rows, { onConflict: "vsp_id" });
        if (error) plan.ignores.push(`${qui} / ${mois} : notes de frais non enregistrées (${error.message})`);
      }
    }
  }
  return plan;
}

const moisValide = (m: unknown) => /^\d{4}-(0[1-9]|1[0-2])$/.test(s(m));
function moisParDefaut(): string[] {
  const mp = moisPrecedent();
  const p = `${mp.y}-${String(mp.m).padStart(2, "0")}`;
  return [p, new Date().toISOString().slice(0, 7)];
}

// Déclenchement mensuel : le mois écoulé, une seule fois, dès que tous ses CRA sont validés
async function auto() {
  const mp = moisPrecedent();
  const mois = `${mp.y}-${String(mp.m).padStart(2, "0")}`;
  const { data: deja } = await admin.from("vsp_sync_runs").select("id").eq("action", "auto").in("statut", ["ok", "partiel"]).eq("mois", `${mois}-01`).limit(1);
  if (deja?.length) return { mois, fait: false, raison: "déjà synchronisé" };
  const vue = await toutes("/v1/activity/overview", { year: mp.y, month: mp.m });
  const nonValides = vue.filter((v) => s(v.workflowStatus) !== "VALIDATED").length;
  if (!vue.length || nonValides) return { mois, fait: false, raison: `${nonValides} CRA non validé(s) sur ${vue.length}`, attente: true };
  if (await passageEnCours(null)) return { mois, fait: false, raison: "une synchronisation est déjà en cours", attente: true };
  SUIVI = new Suivi(crypto.randomUUID(), "serveur", "auto");
  await SUIVI.demarrer();
  return { mois, fait: true, plan: await synchroniser([mois], true) };
}

// ---------- Accès ----------
async function autoriser(req: Request): Promise<{ ok: true; par: string; uid: string | null } | { ok: false; res: Response }> {
  const cron = req.headers.get("x-cron-secret");
  if (cron) {
    const { data } = await admin.rpc("vsp_sync_secret");
    if (typeof data === "string" && data.length >= 32 && data === cron) return { ok: true, par: "serveur", uid: null };
    return { ok: false, res: json({ erreur: "Secret serveur invalide." }, 403) };
  }
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: u } = await admin.auth.getUser(token);
  if (!u?.user) return { ok: false, res: json({ erreur: "Session invalide : reconnectez-vous." }, 401) };
  const { data: estAdmin } = await admin.from("admins").select("user_id").eq("user_id", u.user.id).maybeSingle();
  if (!estAdmin) return { ok: false, res: json({ erreur: "Réservé aux administrateurs HT Portage." }, 403) };
  let aal = "";
  try { aal = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).aal ?? ""; } catch { /* illisible */ }
  if (aal !== "aal2") return { ok: false, res: json({ erreur: "Validez d'abord votre code de double authentification." }, 403) };
  return { ok: true, par: u.user.email ?? u.user.id, uid: u.user.id };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ erreur: "Méthode non autorisée" }, 405);
  const acces = await autoriser(req);
  if (!acces.ok) return acces.res;
  const corps = await req.json().catch(() => ({}));
  const action = String(corps.action ?? "");
  const moisListe = Array.isArray(corps.mois) && corps.mois.every(moisValide) ? (corps.mois as string[]).slice(0, 12) : moisValide(corps.mois) ? [String(corps.mois)] : moisParDefaut();
  if (action === "auto" && acces.par !== "serveur") return json({ erreur: "Réservé au déclenchement serveur." }, 403);
  const idSuivi = /^[0-9a-f-]{36}$/i.test(String(corps.suivi ?? "")) ? String(corps.suivi) : null;
  if (action === "appliquer") {
    const autre = await passageEnCours(idSuivi);
    if (autre) return json({ statut: "erreur", resultat: { erreur: `Une synchronisation est déjà en cours (lancée par ${autre.par ?? "un autre administrateur"}).` } });
  }
  SUIVI = new Suivi(action === "auto" ? null : idSuivi, acces.par, action);
  await SUIVI.demarrer();
  const debut = Date.now();
  let resultat: unknown, statut = "ok", moisRun: string | null = null;
  try {
    if (action === "explorer") resultat = await explorer();
    else if (action === "apercu") resultat = await synchroniser(moisListe, false);
    else if (action === "appliquer") resultat = await synchroniser(moisListe, true);
    else if (action === "auto") {
      const r = await auto();
      resultat = r; moisRun = `${r.mois}-01`;
      if (!r.fait) return json({ statut: "attente", resultat: r }); // rien à journaliser : on réessaiera demain
    } else return json({ erreur: "Action inconnue." }, 400);
    const p = (resultat as { plan?: Plan } & Plan);
    const pl = p?.plan ?? p;
    if (pl && Array.isArray(pl.ignores) && pl.ignores.length && action !== "apercu") statut = "partiel";
  } catch (e) {
    statut = "erreur";
    resultat = { erreur: String((e as Error).message ?? e).slice(0, 300) };
  }
  await SUIVI.ecrire(true).catch(() => {});
  await admin.from("vsp_sync_runs").insert({ action, mois: moisRun, par: acces.par, statut, duree_ms: Date.now() - debut, resultat });
  return json({ statut, resultat });
});
