# Pokyny pre prácu v tomto repozitári

## Čo to je

Statická webová appka (GitHub Pages) pre domácnosť s fotovoltikou + Cloudflare Worker,
ktorý jej dodáva dáta. Podrobnosti v `README.md` a `docs/ARCHITECTURE.md`.

Appka je jedna: „Živá obloha“ v koreni (`index.html`, `app.js`, `style.css`, `web/`). Pôvodná appka
skončila v novembri 2026, jej posledný stav je v git tagu `original-posledna`.

`obloha/` je len prechod a nič nové doň nepatrí: `index.html` presmeruje staré odkazy aj s hashom,
`sw.js` a `icon-192.png` držia odbery oznámení z čias, keď appka bývala tam (`APPKY` vo
`web/oznamenia.js`). Odstrániť sa dá, až keď na žiadnom telefóne nebude starý odber.

Jadro (`shared/`) ešte nesie zvyšky pôvodnej appky, ktoré testy nazvú použitými, hoci appka ich nečíta
(napr. `farba` vo vzhľade, `pas` v `shared/pristup.js`). Keď na ne natrafíš, zmaž ich.

## Karta Radar

Návrh, merania a rozhodnutia: `docs/navrhy/radar.html`. Podmienka je **žiadne náklady**, preto nie je
žiadny server ani plánovaná úloha: Worker (`worker/src/radar.js`) len prepošle požadované bloky súboru
OPERA a cache Cloudflare ich podrží, rozbalenie, čistenie a pohyb počíta prehliadač (`web/radar-vypocet.js`).
Jadro Workera aj prehliadača je v `shared/radar-data.js`. Bezplatný Worker má 10 ms procesora, do `worker/src/radar.js`
nepatrí nič výpočtové. Použiteľný je len súbor `.h5`, GeoTIFF toho istého produktu mal 7. 11. 2026 diery a mriežku.

Open-Meteo zrejme ráta každý bod mriežky ako samostatné volanie. Väčšia mriežka narazila na limit 429 a zastavila aj
predpoveď appky, preto je `modelBodyX` × `modelBodyY` malé a model sa pýta raz za 3 hodiny. Tieto čísla nezvyšuj bez merania.

Mapa je zámerne obmedzená na výrez blokov okolo polohy (`hraniceOblasti`), rozhodnuté 7. 11. 2026 ako dočasné.
Neskôr sa to má prerobiť na širší výrez alebo dáta idúce za mapou (možnosti B a C v návrhu).

Model má vlastný Web Worker a v prehliadači sa drží 3 hodiny (`radar-model-v1`): v jednom rade so snímkami čakali oblaky na S22 20–30 s.

Predpoveď na 2 h je len posun poslednej snímky. Spätný test: druhá hodina je slabá a vznik búrky nevie. V appke
sa preto vždy píše „predpoveď“, nikdy nie „radar“.

## Verzia odkazu s nastavením

Odkaz `#nastavenie=…` nesie verziu formátu (`v`, `SHARE_LINK_VERSION` v `shared/config.js`).
Appka z obchodu bude často staršia ako web, z ktorého niekto odkaz poslal, a nesmie z neho nič
zahodiť potichu. **Keď pribudne čokoľvek, čo staršia appka z odkazu nevie prečítať** (značka
meniča či spôsob pripojenia, úroveň ceny, mena, nové pole), **zvýš `SHARE_LINK_VERSION`** a spusti
`UPDATE_GOLDEN=1 npm test`. Staršia appka potom povie „Odkaz je z novšej verzie appky“. Stráži to
`test/golden/odkaz.json`: zmena formátu bez novej verzie zhodí test, aj pri prepise golden súboru.
Návrh: `docs/navrhy/odkaz-verzia.html`.

## Nemenné pravidlá

- **Žiadny build krok, framework ani bundler.** Stránka sa servíruje tak, ako leží v repozitári.
- **Žiadne runtime závislosti.** Externé knižnice sú len dve a obe z CDN s hashom v `integrity` – pri
  zmene verzie treba zmeniť aj ten (cdnjs ho uvádza pri súbore), inak ho prehliadač nespustí. QR kód
  je v `index.html`, načítaný s `defer` a nepovinný. MapLibre je výnimka len pre kartu Radar (schválená 7. 11. 2026): načítava sa až pri jej otvorení, adresa a hashe sú v `RADAR.maplibre` v `shared/config.js`. Písma sú v repozitári
  (`fonts/`, licencia OFL), nie z Google Fonts. Písmo appky je podmnožina len so znakmi
  appky – keď texty dostanú nový znak, vyrob ju znova podľa `scripts/font-subset.js` (ohlási to
  `test/font-subset.test.js`). Vývojové závislosti (lint, testy) sú v poriadku.
- **Typy cez JSDoc a `tsc --checkJs`**, nie cez `.ts` súbory.
- **Doménová logika patrí do `shared/`** a nesmie sa dotýkať DOM, siete ani `Date.now()`.
  Čas a dáta do nej vstupujú ako parametre, aby sa dala testovať.
- **Jedno miesto pravdy.** Konštanta, ktorá je v `shared/config.js`, sa nikde inde nepíše
  natvrdo. To isté platí pre výpočet: ak ho potrebuje appka aj Worker, žije v `shared/`.
- **Jeden stav a jedno prekreslenie.** Stav appky je objekt vo `web/state.js` (úložisko `web/store.js`), mení sa
  výhradne cez `setState` a prekresľuje výhradne cez `render` vo `web/render/index.js`.
  Render funkcie sú čisté: čítajú stav, zapisujú do DOM, nič nevolajú späť.
- **Slovenčina** v komentároch, textoch pre používateľa aj v správach commitov.
- **KISS.** Keď sú dve riešenia rovnako dobré, vyhráva jednoduchšie.

## Content-Security-Policy

`index.html` má CSP v značke `<meta>` (GitHub Pages hlavičky nevie): skripty len vlastné a z cdnjs,
nič vložené v HTML, pripojenia len na vymenované adresy. Keď appka začne čítať z novej adresy alebo
načítavať novú knižnicu, patrí aj do CSP – inak to prejde testami (sieť podvrhujú) a zlyhá až
v prehliadači. Stráži to `test/csp.test.js`. Do HTML nepíš `<script>` s obsahom, `<style>` ani
`onclick=`; štýl v atribúte `style` povolený je (grafy). `obloha/index.html` CSP nemá, je to len presmerovanie.

## Pozor na kaskádu v CSS

**Invariant: nič nesmie prebiť utilitu `.hidden`.** Keď jej appka pridá triedu, prvok musí
zmiznúť – inak by ukazovala niečo, čo tvrdí, že skrýva.

`.hidden` preto ako **jediné miesto v `style.css` používa `!important`**. Nie je to
nedbalosť: skôr stála len na konci súboru a spoliehala sa na poradie, lenže poradie
rozhoduje iba pri rovnakej špecificite. Pätnásť pravidiel s `display` ju prebíjalo a dve
z nich sa naozaj prejavili. Vymenúvať, čo je zakázané (ID selektory, potomkovské
selektory, …), nefunguje – to sme už raz skúsili a chyba prišla dierou, ktorá v zozname
nebola. Inde `!important` nepíš. Jedinou ďalšou výnimkou je `prefers-reduced-motion`, ktoré
musí vypnúť animácie a prechody všade – z rovnakého dôvodu: nesmie ho nič prebiť.

Kontroluje to e2e test „`.hidden` skryje každý prvok v stránke“, ktorý prejde všetky
prvky vo všetkých kartách. Nový prvok netreba nikam dopisovať – test ho uvidí sám.

## Dotyk a kurzor

**Pravidlo: rozhoduj podľa typu vstupu, nie podľa druhu udalosti.**

Prehliadač po každom ťuknutí prstom dopošle aj kurzorové udalosti – `mouseover`, `mousemove`,
`click`, `mouseout`, `mouseleave`. Kód písaný pre myš tak beží aj pod prstom, hoci o ňom nevie.
Tooltip grafu ukázaný prstom nám takto zhasínal `mouseleave` do 15 ms: na displeji z neho ostalo
bliknutie a ťuknutie na graf prakticky nefungovalo. Kurzor a pero preto obsluhujú pointer udalosti
s kontrolou `pointerType !== 'touch'`, prst má vlastný kód nad touch udalosťami (`bindTouch`
vo `web/teraz-gestures.js` a `web/day-pager.js`).

Typ zariadenia nezisťuj – žiadne `maxTouchPoints`, `@media (hover: hover)` ani userAgent. Appka
reaguje na to, čím sa práve ovláda, nie na to, čo to je za prístroj; mobil s myšou aj notebook
s dotykovým displejom sú bežné. Z toho istého dôvodu nie je v `style.css` ani jedno pravidlo
`:hover` – na dotyku by ostávalo visieť po ťuknutí.

V CSS to isté hovorí `touch-action`. `none` znamená, že prehliadač nad prvkom nesmie nič, ani
posunúť stránku – patrí len úchytkám na ťahanie (kruh rozvrhu tarify v sprievodcovi). Plochy,
cez ktoré človek scrolluje popri ceste, majú `pan-y` (graf dňa `.day-scrub` v paneli karty Dnes, pás dňa
`.day-track` v detaile dňa karty 7 dní): zvislé posúvanie si necháva
prehliadač, vodorovné gesto JS. Kde `touch-action` nie je, rozhoduje prehliadač o oboch smeroch –
to je pre bežný obsah správne, dopisovať ho netreba.

Mapa a časová os karty Radar majú `touch-action: none`: karta zaberá celú obrazovku, stránka sa na nej neposúva.

**Karty sa ťahom prsta nelistujú**, len ťuknutím v navigácii. Ťah do strán má
dve miesta: dni v detaile dňa karty 7 dní (`web/day-pager.js`, rozhodnutia v `shared/day-pager.js`)
a pás kariet pod číslami na karte Dnes. Pás posúva prehliadač sám (CSS scroll-snap, `web/mozem-karty.js`
len zladí bodky), žiadny vlastný kód nad touch udalosťami; zvislý ťah cez neho posúva stránku a myš
ho posúva ťuknutím na bodky. Ďalšie miesto pridávaj len s rovnakým rozmyslom
(návrh: `docs/navrhy/dnes-upravy.html`). Pri dňoch v detaile karty 7 dní platí:
Obsah dňa ide za prstom a vedľa neho stojí susedný deň, ktorý nakreslil ten istý render (appka ho na
chvíľu zavolá so susedným dňom a výsledok skopíruje) – iný kód na kreslenie dňa preto nepíš. Kópie
sú bez `id` (inak by boli v stránke dvakrát), takže štýly obsahu dňa stoja na triedach, nie na `id`. Posun
počas ťahu nie je v stave; do stavu ide až deň, na ktorom pás zastal. Na kraji sa pás len poddá,
z detailu von vedie šípka späť (prvý čip v riadku dní). Myš ťahať nemusí – čipy a šípky na klávesnici.
V prehľade so stĺpcami sa dni listujú ťahom v stĺpci 7 dní, pás je v ňom.
Návrh: `docs/navrhy/7dni-listovanie-dni.html`.

Kontrolujú to e2e testy v skupinách „ťah prstom a tlačidlo Späť“ a „graf dňa prstom“: ťuknutie bez jediného pohybu
prsta musí náhľad ukázať a nechať svietiť, zvislý ťah cez graf ho nesmie ukázať.

## Ako overovať

```bash
npm run check     # lint, formát, typy, jednotkové testy s pokrytím
npm run test:e2e  # Playwright: všetky karty, interakcie, prístupnosť
cd worker && npx wrangler deploy --dry-run --outdir dist
```

Pokrytie `shared/` musí ostať aspoň 90 % riadkov, inak `npm test` zlyhá. Okrem súhrnu platí prah aj pre
každý súbor zvlášť (85 % riadkov, 75 % vetiev, `FILE_MIN` v `test/run.js`), aby nový modul bez testov
nezapadol v priemere. Test, ktorý načíta ten istý modul viackrát (`import('…?značka')`), patrí do
`test/bez-pokrytia/` – v jednom behu s ostatnými by Node 22 pokrytie toho modulu spočítal zle.
Export, ktorý nikto nepoužíva (ani testy), zhodí `test/nepouzite.test.js` – keď zmena prestane
niečo používať, zmaž aj definíciu. Očakávané texty
v e2e testoch sa počítajú tou istou funkciou ako v appke, takže test odhalí rozdiel medzi
modelom a tým, čo je naozaj v DOM.

Predpoveď je zamknutá súborom `test/golden/forecast.json`. Zmenu výpočtu potvrď cez
`UPDATE_GOLDEN=1 npm test` a popíš ju v pull requeste – inak ide o neúmyselnú regresiu.

Keď meníš vzhľad, pusti `npm run screenshots` a pribalené obrázky daj do toho istého pull
requestu – inak sa README rozíde s appkou. V CI to zámerne nebeží: generátor berie prehliadač
z Playwrightu, takže by každá aktualizácia Chromia sčervenala PR, ktorý sa vzhľadu ani netýka.
(Písma sú v repozitári, `fonts/`, takže od verzie na CDN už snímky nezávisia.) Na jednom stroji sú obrázky bajtovo rovnaké,
takže rozdiel v `git status` znamená naozajstnú zmenu vzhľadu.

## Nasadenie a cache: `boot.js` zladí staré a nové súbory

GitHub Pages posiela každý súbor s `cache-control: max-age=600` a bez revalidácie. Appka nemá
build krok, takže `index.html` a každý modul vo `web/` a `shared/` je samostatný súbor
s vlastnou platnosťou cache – prehliadač ich po nasadení vie desať minút miešať. CDN pred
GitHub Pages (Fastly) sa pri nasadení čistí (hneď po ňom odpovedá `X-Cache: MISS`, `Age: 0`),
starú verziu drží len prehliadač. Zmiešanie zabije appku ešte pred prvým `render()` a v stránke
ostane statické HTML: `00:00`, „načítavam…" a prázdna karta. Vedú k tomu dve cesty:

- **Export medzi modulmi.** Nasadenie pridá export do modulu A a zároveň ho začne importovať B.
  Prehliadač so starým A v cache a novým B hodí pri linkovaní `SyntaxError` („does not provide
  an export named …“) a nespustí nič z grafu modulov. To isté pri presune alebo premenovaní
  exportu (#232, #233, #235). Úplne nový súbor nevadí, ten v cache ešte nie je.
- **Prvok v HTML a `byId`.** `byId` vo `web/dom.js` na chýbajúci prvok zámerne hodí výnimku.
  Stalo sa to naozaj, keď jedno nasadenie odstránilo `#week-curve-now-badge` z HTML aj
  z `dom.js` naraz.

**Ochrana: `index.html` nespúšťa `app.js` priamo, ale cez `boot.js`.** Ten appku načíta
dynamickým `import()` a keď sa to nepodarí (linkovanie aj výnimka pri štarte), stiahne všetky
vlastné `.js` súbory stránky znova cez `fetch(…, { cache: 'reload' })` – tým prepíše cache –
a raz obnoví stránku. Samotné obnovenie by nestačilo: prehliadač pri ňom overí len stránku,
moduly vezme z cache. Druhé zlyhanie v tej istej karte už stránku neobnoví (príznak
v `sessionStorage`), ale ukáže hlášku – chyba vtedy nie je v cache a slučka by nič nevyriešila.

Zmeny preto netreba rozkladať na viac nasadení: export aj prvok v HTML môžu pribudnúť, zmiznúť
či sa presunúť v tom istom nasadení, ktoré ich začne alebo prestane používať. Kto trafí zmiešanú
cache, uvidí jedno obnovenie stránky navyše.

Čo treba držať:

- Appka sťahuje karty 7 dní, Radar, Štatistika a Nastavenie až po štarte (`web/parts.js`) –
  tie `boot.js` nechráni. Keď ich `import()` zlyhá, appka namiesto karty ukáže hlášku s tlačidlom,
  ktoré stiahne súbory znova a obnoví stránku (najviac raz). Kontroluje to e2e skupina „nasadenie
  a cache: karty načítané neskôr“. Nový modul pre tieto karty patrí do ich časti, nie do jadra.
- `boot.js` **nesmie nič importovať staticky** – musí sa spustiť, aj keď je zvyšok grafu
  rozbitý. Z toho istého dôvodu `index.html` nenačítava žiadny iný modul appky.
- `boot.js` je v cache tiež, takže jeho nová verzia musí fungovať so starým `index.html`
  a naopak. Stačí nemeniť meno `app.js` ani `#hdr-status`, kam píše hlášku.
- Service worker ranného oznámenia (`sw.js` v koreni) **súbory appky
  necachuje** – nesmie, inak by obišiel `boot.js`. Registruje sa s `updateViaCache: 'none'`,
  aby prehliadač bral jeho statické importy zo `shared/` vždy čerstvé (dynamický `import()`
  service worker nesmie). Každý push musí niečo ukázať, preto pri chybe ukáže výzvu pozrieť
  appku. Meno `sw.js` nemeň – zaregistrované telefóny by ostali na starom. Staré odbery
  drží `obloha/sw.js`, ktorý len importuje koreňový, preto sa adresy v `sw.js` rátajú od
  `import.meta.url`, nie od rozsahu. Android oznámenie pripíše nainštalovanej appke (jej logo) len
  vtedy, keď rozsah service workera leží v jej rozsahu.

Kontrolujú to e2e testy v skupine „nasadenie a cache“: starý modul musí skončiť jedným
obnovením a naštartovanou appkou, chyba, ktorú obnovenie nevyrieši, hláškou bez slučky. Testy
starý modul podstrčia cez `page.route` (lokálny server cache nemá). So skutočnou HTTP cache
prehliadača – server s `max-age=600`, bez `page.route` – to bolo overené ručne, pre export aj
pre `byId`.

## Proces

Vetvy `claude/<téma>`, jeden pull request na tému, commit správy v štýle `feat: …`,
`fix: …`. Pred zlúčením musí byť CI zelené.
