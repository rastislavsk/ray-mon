# Worker `rackofci-energy-sro-fable`

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

Obmedzenie počtu požiadaviek zatiaľ nie je: každý otvorený telefón s kioskom znamená jednu
požiadavku na Huawei za minútu.

## Nasadenie

**Git integrácia**: Cloudflare dashboard → Workers & Pages → `rackofci-energy-sro-fable` →
Settings → Build → Connect to Git, root directory `worker/`. Po každom pushnutí do `main`
sa Worker nasadí sám.

Pozor, dva príkazy v tom istom nastavení sa správajú rozdielne:

| Príkaz                              | Odkiaľ beží                           | Ako ho nastaviť                                              |
| ----------------------------------- | ------------------------------------- | ------------------------------------------------------------ |
| **Deploy command** (vetva `main`)   | z Root directory, teda už z `worker/` | `npx wrangler deploy` — **bez** `--config`                   |
| **Version command** (pull requesty) | z koreňa repozitára                   | `npx wrangler versions upload --config worker/wrangler.toml` |

Pridať `--config worker/wrangler.toml` aj do Deploy command je častá chyba: cesta sa
zdvojí na `worker/worker/wrangler.toml` a nasadenie zlyhá na
`ENOENT: no such file or directory`. Prepínač patrí len do Version command.

## Overenie

```bash
npm --prefix worker test                                   # endpoint proti fixtures
cd worker && npx wrangler deploy --dry-run --outdir dist   # zbalí sa aj shared/
```

Podrobnejšie hlásenia sú v logoch Workera (dashboard → Observability), ktoré sú zapnuté
vo `wrangler.toml`.
