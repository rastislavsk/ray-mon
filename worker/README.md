# Worker `ray-mon`

Živé meranie pre appku. Prehliadač sa na kiosk Huawei FusionSolar priamo nedostane, preto
ho za neho stiahne tento Worker. Nič neukladá: nemá úložisko, tajomstvá ani plánované behy.
Predpoveď si appka počíta sama v prehliadači.

## Endpoint `POST /pv`

Telo je text: odkaz na verejný kiosk FusionSolar, ktorý si používateľ zadal v Nastavení
(stránka kiosku alebo priamo adresa dát). Worker z neho vezme len server
(`*.fusionsolar.huawei.com`, https) a kľúč `kk`, adresu dát si zloží sám
(`kioskApiUrl` v `shared/kiosk.js`) a vráti:

```json
{ "pv": { "realTimePowerKw": 6.41, "...": "..." }, "servedAt": "2026-09-05T11:00:00.000Z" }
```

- Cudzí odkaz dostane **400** bez jediného sťahovania. Z Workera sa tak nedá spraviť proxy
  na čokoľvek iné než kiosk FusionSolar.
- Nedostupný alebo nezmyselný kiosk dostane **502**. Odpoveď neobsahuje odkaz ani podrobnosti.
- Odkaz je v tele, nie v adrese, aby neskončil v logoch. Worker si ho nikam neukladá.
- Telo je `text/plain`, takže prehliadač nerobí predbežnú CORS požiadavku.
- Iné cesty vracajú 404, iné metódy 405, `OPTIONS` dostane 204. Odpovede sa necachujú.

## Denný limit a obmedzenie počtu požiadaviek

Bezplatný plán Workers má **100 000 požiadaviek denne** (resetuje sa o polnoci UTC). Po jeho
vyčerpaní Cloudflare vracia chybu **1027** a živé meranie do konca dňa nefunguje nikomu –
appka potom ukazuje len odhad z predpovede. Každý otvorený a viditeľný telefón s kioskom
znamená jednu požiadavku za minútu, takže limit by vyčerpalo zhruba 70 kariet otvorených
celý deň, alebo niekto úmyselne.

Obmedzenie počtu požiadaviek vo Workeri (väzba `ratelimit`) zámerne nie je. Na kvótu by
nepomohlo: aby Worker požiadavku odmietol, musí sa spustiť, a každé spustenie sa do limitu
počíta. Chránilo by len kiosky FusionSolar pred zahltením cez tento Worker – pri pár
používateľoch zbytočné.

Keby sa limit začal míňať, možnosti sú dve:

- **Workers Paid** (5 $ mesačne) – denný limit nemá.
- **Vlastná doména** namiesto `workers.dev` a na nej pravidlo Rate limiting v Cloudflare
  WAF. To zastaví nadmerné požiadavky ešte pred Workerom, takže sa do kvóty nepočítajú.
  Treba potom zmeniť aj `WORKER_URL` v `shared/config.js`.

Koľko požiadaviek denne Worker dostáva, ukazuje dashboard → Workers & Pages →
`ray-mon` → Metrics.

## Nasadenie

**Git integrácia**: Cloudflare dashboard → Workers & Pages → `ray-mon` →
Settings → Build → Connect to Git, root directory `worker/`. Po každom pushnutí do `main`
sa Worker nasadí sám.

Oba príkazy bežia z Root directory, teda už z `worker/`, a `wrangler.toml` si nájdu samy:

| Príkaz                              | Ako ho nastaviť                |
| ----------------------------------- | ------------------------------ |
| **Deploy command** (vetva `main`)   | `npx wrangler deploy`          |
| **Version command** (pull requesty) | `npx wrangler versions upload` |

Prepínač `--config worker/wrangler.toml` nepatrí ani do jedného: cesta sa zdvojí na
`worker/worker/wrangler.toml` a build zlyhá na `ENOENT: no such file or directory`.
Stalo sa to pri prvom builde Workera `ray-mon` – tento súbor dovtedy tvrdil, že Version
command beží z koreňa repozitára.

## Overenie

```bash
npm --prefix worker test                                   # endpoint proti fixtures
cd worker && npx wrangler deploy --dry-run --outdir dist   # zbalí sa aj shared/
```

Podrobnejšie hlásenia sú v logoch Workera (dashboard → Observability), ktoré sú zapnuté
vo `wrangler.toml`.
