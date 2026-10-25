# Calcule la page de chaque article à partir des PDF rendus.
import json, subprocess, re
T = json.load(open('titres.json'))
files = {'cdi': 'out/HT-Portage_CDI-portage-salarial_modele.pdf', 'annexe': 'out/HT-Portage_Annexe-1_conditions-prestation_modele.pdf'}
res = {}
for doc, arts in T.items():
    pages = subprocess.run(['pdftotext', '-layout', files[doc], '-'], capture_output=True, text=True).stdout.split('\f')
    for a in arts:
        motif = ('A R T I C L E ' + ' '.join(str(a['num'])) + ' ' if a['num'] else '') + a['titre'].upper()
        res[a['id']] = next((i + 1 for i, pg in enumerate(pages) if motif in re.sub(r'\s+', ' ', pg)), None)
json.dump(res, open('pages.json', 'w'))
print(res); print('manquants', [k for k, v in res.items() if not v])
