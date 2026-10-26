// Recopie assets/js/calcul-portage.js dans la fonction notify-lead (e-mail de simulation),
// pour que le site et les e-mails utilisent exactement le même calcul.
// Usage : node scripts/sync-calcul.mjs
import { readFileSync, writeFileSync } from "node:fs";
const src = readFileSync("assets/js/calcul-portage.js", "utf8");
if (src.includes("`") || src.includes("${")) throw new Error("calcul-portage.js ne doit contenir ni accent grave ni ${");
const cible = "supabase/functions/notify-lead/index.ts";
const ts = readFileSync(cible, "utf8");
const debut = "// <calcul-portage> — généré par scripts/sync-calcul.mjs, ne pas modifier ici", fin = "// </calcul-portage>";
const i = ts.indexOf(debut), j = ts.indexOf(fin);
if (i < 0 || j < 0) throw new Error("Marqueurs <calcul-portage> introuvables dans " + cible);
writeFileSync(cible, ts.slice(0, i) + debut + "\n" + src.trim() + "\n" + ts.slice(j));
console.log("Moteur recopié dans", cible);
