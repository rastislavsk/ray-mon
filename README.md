# Račkofci Energy s.r.o.

Webová appka pre domácnosť s fotovoltikou v Dvoranoch nad Nitrou. Na jednej obrazovke
odpovedá na otázku „môžem teraz zapnúť práčku?“ a k tomu ukazuje živý výkon panelov,
predpoveď výroby na dnes a zajtra a prehľad na sedem dní. Robená je pre telefón, na
tablete a desktope má vlastné rozloženie.

Appka je statická stránka bez build kroku. Beží na GitHub Pages, dáta jej dodáva
Cloudflare Worker.

## Čo appka ukazuje

Spodná navigácia má len ikony bez textu – mená kariet nižšie slúžia len na orientáciu
v tomto popise.

|                Terazky                 |               7 dní               |               Info               |
| :------------------------------------: | :-------------------------------: | :------------------------------: |
| ![Karta Terazky](docs/img/terazky.png) | ![Karta 7 dní](docs/img/7dni.png) | ![Karta Info](docs/img/info.png) |

Snímky sú z testovacích dát a pevného času (13:00), nie zo živej elektrárne – čísla na nich
sú syntetické. Prekresliť ich vie `npm run screenshots`. Karta Nastavenie na obrázku nie je,
QR kód v nej kreslí knižnica z CDN.

- **Terazky** – aktuálny výkon na ciferníku a pod ním pás odporúčaní: jednovetné
  odporúčanie („Najlepší čas dňa — zapni všetko“), stav piatich spotrebičov, predpoveď dňa
  a prípadne čas, kedy bude lepšie. Listuje sa potiahnutím do strán alebo klikom na bodky;
  poradie má konce – na prvej správe sa dá ísť len ďalej, na poslednej len späť.
  Ciferník sa číta aj ako 24-hodinový: vonkajší prstenec je deň s farebnými tarifnými
  pásmami, biela bodka na ňom je „teraz“. Potiahnutím jazdca po prstenci alebo ťuknutím
  naň si pozrieš, ako to bude vyzerať v inom čase. Čo prstence a farby znamenajú, vysvetľuje
  karta Info.
- **7 dní** – prehľad dní: na telefóne rebríček, kde má každý deň pásik dlhý podľa výroby
  voči najsilnejšiemu dňu v týždni, a nad ním jediné veľké číslo za celý týždeň; na širokej
  obrazovke bubliny (Dnes, Zajtra, 7 dní spolu) a tabuľka so všetkými stĺpcami. Klik otvorí
  detail: na deň jeho priebeh výroby s oblačnosťou, čísla dňa (špička, využitie, oblačnosť),
  jeho riadok z mapy výroby a hlášku o tom dni; pri dnešku je v grafe aj skutočná nameraná
  krivka so značkou „teraz“ a koľko už z predpovede nabehlo. Klik na bublinu „Spolu za 7 dní“
  (na širokej obrazovke na bublinu „7 dní spolu“) otvorí detail celého týždňa: dennú výrobu,
  mapu výroby hodina × deň a hlášku o najsilnejšom dni. Na širokej obrazovke je vidno všetko
  naraz.
- **Nastavenie** – zoznam nastavení appky. Položka sa ťuknutím rozbalí na mieste.
  **Moja elektráreň**: lokalita kdekoľvek na svete (vyhľadávanie alebo ručné súradnice)
  a jedna až tri plochy panelov s počtom, orientáciou a sklonom, výkon panelu a menič,
  nepovinne odkaz na kiosk Huawei FusionSolar pre živé meranie.
  Nastavenie sa ukladá len v prehliadači. Kým si ho človek neuloží, appka ukazuje ukážku
  vymyslenej elektrárne v Londýne. **Zdieľať appku**: QR kód, odkaz na appku a tlačidlo na
  poslanie cez WhatsApp.
- **Info** – návod k ciferníku z karty Terazky: ilustračný ciferník a štyri vysvetlivky
  (vonkajší prstenec s tarifnými pásmami, biela bodka „teraz“, vnútorný oblúk výkonu,
  jazdec na prstenci). Obsah je statický, appka ho neprepočítava.

Medzi kartami sa dá na dotykovej obrazovke prechádzať aj potiahnutím prsta do strán, v
poradí spodnej navigácie – aj ponad grafy a prehľad dní. V detaile dňa listuje to isté
gesto dni v týždni, nie karty: doľava na ďalší deň, doprava na predchádzajúci – a nový deň
sa prisunie z tej strany, ktorou si ťahal, rovnako ako karta pri prepnutí. Nezacyklí sa
– za posledným dňom už ťah nevedie nikam a z prvého dňa (Dnes) sa ťahom doprava vrátiš do
prehľadu dní, teda tam, kam vedie aj šípka späť v hlavičke detailu. V detaile týždňa je to
to isté: doľava sa nedeje nič, doprava zavrie detail. Nad grafom
listuje rýchle švihnutie a tooltip sa pri ňom vôbec neukáže; pomalé ťahanie po krivke ostáva
prezeraním s tooltipom ako doteraz. Zvislý ťah je posúvanie stránky – aj keď prst začne na grafe – a
tooltip sa pri ňom neukáže tiež. Nová karta sa pritom prisunie z tej strany, ktorou si listoval –
rovnako pri ťahaní aj pri kliku na navigáciu. Kto má v systéme zapnutý útlm pohybu, dostane
prepnutie bez animácie. Ťahanie si pre seba
nechávajú len veci, ktoré sa samy posúvajú do strán: pás odporúčaní na karte Terazky – ten
si ho necháva aj na krajnej správe, takže ťah v ňom nikdy neopustí kartu. Bežec na páse dňa
sa ťahá ako predtým.

Systémové tlačidlo Späť na telefóne a tablete (a šípka v prehliadači) vracia o krok späť
v appke: najprv zavrie detail dňa, potom sa vracia po kartách v opačnom poradí, než si
nimi prešiel. Dopredu vedie tá istá cesta naspäť. Výber vnútri karty – vybraný deň
alebo stránka pásu odporúčaní – krok navigácie nie je, na ten sa Späť nevracia.
Keď sa kroky minú, ďalšie Späť z appky odíde; v nainštalovanej appke (PWA) to znamená jej
zatvorenie. Zatvorenie sa nikde nevynucuje dvojitým stlačením – to je zvyk natívnych
androidových appiek, nie webu, a stránka sa sama zavrieť ani nevie. Adresa sa pritom
nemení, takže odkaz na appku ostáva jeden.

## Ako to funguje

```
Open-Meteo (žiarenie) ──────────────────────────────→ appka počíta predpoveď
Huawei FusionSolar kiosk ─→ Cloudflare Worker ─────→ appka (živé meranie)
```

Appka si pre lokalitu z karty Nastavenie stiahne z Open-Meteo hodinové žiarenie, teplotu
a oblačnosť a sama z nich dopočíta predpoveď výroby: polohu slnka, žiarenie na roviny
panelov, teplotný odber a limit meniča. Tá istá funkcia počíta aj strop pri úplne jasnej
oblohe, z ktorého vychádza údaj „využitie“. Počasie sa sťahuje najviac raz za hodinu.

Živé meranie je nepovinné. Kto si v Nastavení vloží odkaz na verejný kiosk svojej
elektrárne z Huawei FusionSolar, tomu ho appka každú minútu stiahne cez Worker (prehliadač
sa na kiosk priamo nedostane). Odkaz ostáva uložený len v prehliadači a Worker si ho nikam
neukladá. Bez odkazu appka ukazuje odhad z predpovede.

Pre elektráreň v Dvoranoch zatiaľ beží aj pôvodná cesta: Worker každých päť minút stiahne
jej kiosk do Cloudflare KV a appka ho použije pri lokalite pri Dvoranoch, ak kiosk odkaz
v Nastavení nie je. Pri jej výpadku skúsi záložný zdroj pôvodnej appky (`LEGACY_SOURCES`).
Keď nie je dostupné nič, appka ukáže „dáta nedostupné“ a nespadne.

## Štruktúra

| Priečinok                           | Čo obsahuje                                                                                                                                             |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shared/`                           | Doménová logika bez vstupov a výstupov: konštanty, fyzika slnka, parser kiosku, tarify, texty, modely grafov. Beží v prehliadači, v Node aj vo Workeri. |
| `web/`                              | Stav appky, načítanie dát, vykresľovanie po kartách, poslucháče udalostí, skladanie SVG.                                                                |
| `worker/`                           | Cloudflare Worker: cron, KV, jeden endpoint.                                                                                                            |
| `test/`                             | Jednotkové testy, kontrakt dát a end-to-end testy v prehliadači.                                                                                        |
| `index.html`, `style.css`, `app.js` | Samotná stránka. Žiadny bundler, žiadny framework.                                                                                                      |

Doménová logika je oddelená zámerne: to isté číslo sa nikdy nepočíta na dvoch miestach a
každá funkcia v `shared/` sa dá otestovať bez prehliadača.

## Vývoj

```bash
npm install
npm run serve     # http://127.0.0.1:8080
npm run check     # lint + formát + typy + testy
npm run test:e2e  # testy v prehliadači (Playwright)
```

Typy sa kontrolujú cez JSDoc a `tsc --checkJs`, takže v repozitári nie je ani jeden
TypeScript súbor a stránka sa nikam nekompiluje.

Testovacie dáta v `test/fixtures/` sú syntetické a deterministické, vygeneruje ich
`npm run fixtures`. Výstup predpovede je zamknutý súborom `test/golden/forecast.json`;
keď zmeníš výpočet zámerne, spusti `UPDATE_GOLDEN=1 npm test` a zmenu popíš v pull requeste.

## Nasadenie

Oboje je nasadené a beží.

- **Stránka**: GitHub Pages, _Deploy from a branch_, vetva `main`, priečinok `/ (root)`.
  Adresa: <https://rastislavsk.github.io/rackofci-energy-sro-fable/>
- **Worker** `rackofci-energy-sro-fable`: nasadzuje sa sám pri pushnutí do `main` cez
  Git integráciu Cloudflare. Postup, nastavenia buildu a potrebné tajomstvá sú
  v [`worker/README.md`](worker/README.md).

Zdravie systému sa dá skontrolovať jedným pohľadom na
`https://rackofci-energy-sro-fable.rastislav-racek.workers.dev/status` — `"ok": true`
znamená, že cron beží a obe časti dát sú čerstvé.
