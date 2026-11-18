# To do later

Jediné miesto pre otvorené a odložené témy. Keď sa niečo odloží, patrí sem. Keď sa to urobí,
riadok sa zmaže (história ostáva v gite). Dátum = kedy sa téma odložila.

## Pred vydaním do Google Play / App Store

Odložené 22. 10. 2026. Zdieľanie nastavenia elektrárne musí v appke z obchodu fungovať bezchybne.

- **Odkazy otvárajú appku** (App Links / Universal Links): overovacie súbory musia byť na koreni domény,
  na `rastislavsk.github.io/ray-mon/` to nejde → vlastná doména alebo repozitár `rastislavsk.github.io`.
  Bez toho sa odkaz s nastavením otvorí v prehliadači a nastavenie sa uloží tam, nie do appky.
- **Vlastná doména** (z auditu 12. 11. 2026, bod 5).
- **„Zdieľať appku“** má viesť na adresu, ktorá otvorí appku, inak stránku s odkazmi do obchodov.
- **Google Play TWA** potrebuje `assetlinks.json` na koreni domény (to isté obmedzenie).
- **Apple:** tenký web obal riskuje zamietnutie (4.2), dve appky ako spam (4.3) → jedna appka.
- **Zásady ochrany údajov** – v obchodoch povinné (audit 12. 11. 2026, bod 1).
- **Licencie dát** – overiť podmienky počasia (Open-Meteo, DWD ICON-EU), radaru (OPERA) a uvedenie
  zdroja pri komerčnej/obchodnej distribúcii. (Hviezdy: BSC5 cez NASA HEASARC, vyriešené.)
- **Pozadie pod stavovým riadkom na Androide** (29. 10. 2026): webová appka pod stavový riadok kresliť
  nesmie, PR #388 ho len zafarbí. V TWA overiť edge-to-edge. Kód je pripravený (`viewport-fit=cover`,
  odsadenie o `safe-area-inset-top`). Na iPhone už funguje.
- **Limit účtu Huawei:** appka a prehliadač vo WhatsAppe sa oň delia (iné úložisko); riešenie len cache
  vo Workeri, čo porušuje „Worker nič neukladá“.
- **Widget na plochu** (25. 10. 2026): zatiaľ nie, kvôli dvom verziám (web + natívny obal). PWA skutočný
  widget nemá. Možnosti: manifest `shortcuts` + odznak; Scriptable/KWGT nad `/widget` vo Workeri;
  TWA + Glance (Android); Capacitor/Swift + WidgetKit (iOS). Každá potrebuje `/widget` s výpočtom
  v `shared/`, nastavenie cez `#nastavenie=…` a narazí na limit Huawei.

## Funkcie na neskôr

- **Dážď a sneh v ikonách počasia** (18. 11. 2026): sada má len jasno / polojasno / zamračené.
  Predpoveď zrážky po hodinách už sťahuje. Treba nakresliť ikony a pravidlo, kedy je deň „daždivý“
  či „snežný“; naraz na karte 7 dní aj v páse dní na karte Teraz.
- **Mapa Radaru širšia** (7. 11. 2026): výrez blokov okolo polohy je dočasný, prerobiť na možnosť B
  alebo C z `docs/navrhy/radar.html`.
- **Satelit na Radare** (8. 11. 2026, nechané bez zmeny): EUMETView WMS `view.eumetsat.int/geoserver/wms`,
  bez poplatkov, CORS `*`, limit 20 dopytov v okne. MTG `mtg_fd:vis06_hrfi` (deň) a `mtg_fd:ir105_hrfi`
  (aj noc), raz za 10 min, oneskorenie ~20 min, výrez ~200 kB. Licenčné podmienky EUMETSAT neprečítané.
  Rozlíšenie dažďa sa dá zvýšiť z 2 km na 1 km (`zmensenie` v `RADAR`).
- **Graf dňa na Teraz pre ľudí, čo nečítajú grafy** (1. 11. 2026, bez výberu): `docs/navrhy/teraz-obraz-dna.html`
  (A stuha dňa, B plán na dráhe s kapsulami). Mockupy na vetve `claude/teraz-obraz-dna`.
- **Karta Dnes a ranné oznámenie nepoznajú núdzové časy** z karty Teraz – zladiť.
- **Mapa Radaru na širokej obrazovke prekrýva navigáciu** (zistené pri audite, neopravené).

## Overiť na telefóne alebo na skutočných dňoch

- Scéna toku energie (17.–18. 11.): dom na kopci, počasie za scénou, impulzy, svietiace okná.
- Bublina Dnes zo strechy (PR #495).
- Bojler na prebytky: zapnutie na slnku.
- Km autom v Štatistike (PR #469, #470).
- Karta Graf dňa – variant D (PR #458).
- Teraz ako týždeň; prah `TYZDEN.minPodiel` (25 %) na skutočných dňoch.
- Hlášky celého dňa: rezerva 2/3 (PR #374).
- Dážď v štyroch silách pri skutočnom daždi (PR #420).
- Východná obloha a skutočný Mesiac (PR #439).
- Ťuknutie na oznámenie pri zatvorenej appke (PR #440); Pripomeň.
- Appka pod CSP (Radar, oznámenia) a zdieľanie s meraním na druhom telefóne do 7 dní.
- Radar: prvé otvorenie bez cache na mobilných dátach, skutočný dážď a búrky, čas oblakov na S22.
