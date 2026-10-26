# Pokyny pre prácu v tomto repozitári

## Čo to je

Statická webová appka (GitHub Pages) pre domácnosť s fotovoltikou + Cloudflare Worker,
ktorý jej dodáva dáta. Podrobnosti v `README.md` a `docs/ARCHITECTURE.md`.

Appky sú dve a ostávajú natrvalo: súčasná (koreň, `web/`, `style.css`) a „Živá obloha“
v `obloha/` (návrh `docs/navrhy/smer-b-obloha.html`). **Všetky pravidlá nižšie
platia pre obe.** Zdieľajú `shared/`, Worker, uložené nastavenie a neutrálne moduly vo `web/`
(`store.js`, `storage.js`, `data.js`, `refresh.js`, `day-pager.js`, `nav-history.js`,
`setup-wiring.js`, `settings-store.js`, `svg.js`, `qr.js`, `day-chart.js`,
`teraz-gestures.js`, `oznamenia.js`), takže
**zmena v nich sa prejaví v oboch appkách** – overuj obe. Nová appka nesmie importovať nič, čo
siaha na DOM alebo stav súčasnej (`web/state.js`, `web/dom.js`, `web/render/`, …); čistú časť
vytiahni do `shared/` alebo do neutrálneho modulu. Stráži to `no-restricted-imports`
v `eslint.config.js` (zoznam `NEUTRAL_WEB` – nový neutrálny modul treba dopísať tam aj sem).

## Jedno jadro, dva kabáty

Návrh a prečo: `docs/navrhy/jedno-jadro-dva-kabaty.html`.

- **Jadro** (`shared/`, neutrálne moduly vo `web/`, Worker, úložisko) dáva obom appkám tie isté
  odpovede: či, kedy, koľko a prečo. **Kabát** (HTML, CSS, render, poslucháče, navigácia) smie mať
  vlastné obrazovky, ovládanie, voľby vzhľadu aj funkcie, ktoré druhá appka nemá.
- V jadre nie je nič, čo by vedelo, pre ktorú appku počíta: žiadny prepínač správania pre jednu
  appku, žiadne dva zoznamy tej istej veci. Skúška: keby sa človek opýtal oboch appiek to isté
  a dostal inú odpoveď, rozdiel patrí do jadra a zjednotí sa. Parameter, ktorý mení len podobu
  (tón hlášok), je v poriadku.
- Modely obrazoviek jednej appky (`shared/mozem-sky.js`, …) smú byť
  v `shared/` kvôli testom, ale nesmú nič rozhodnúť samy – len skladajú spoločné výpočty.
- Nová viditeľná funkcia nemusí byť v oboch appkách. Urob ju tam, kde ju úloha chce, a druhú
  appku nemeň, kým to nie je úlohou. Jej výpočet patrí do jadra, aby ju druhá appka mohla
  prevziať bez ďalšej práce.

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
- **Žiadne runtime závislosti.** Jediná externá knižnica je QR kód z CDN, načítaný s `defer`
  a nepovinný. Má v `index.html` hash v `integrity` – pri zmene verzie treba zmeniť aj ten
  (cdnjs ho uvádza pri súbore), inak ho prehliadač nespustí. Písma sú v repozitári
  (`fonts/`, licencia OFL), nie z Google Fonts. Písmo novej appky je podmnožina len so znakmi
  appky – keď texty dostanú nový znak, vyrob ju znova podľa `scripts/font-subset.js` (ohlási to
  `test/font-subset.test.js`). Vývojové závislosti (lint, testy) sú v poriadku.
- **Typy cez JSDoc a `tsc --checkJs`**, nie cez `.ts` súbory.
- **Doménová logika patrí do `shared/`** a nesmie sa dotýkať DOM, siete ani `Date.now()`.
  Čas a dáta do nej vstupujú ako parametre, aby sa dala testovať.
- **Jedno miesto pravdy.** Konštanta, ktorá je v `shared/config.js`, sa nikde inde nepíše
  natvrdo. To isté platí pre výpočet: ak ho potrebuje appka aj Worker, žije v `shared/`.
- **Jeden stav a jedno prekreslenie.** Stav appky je objekt vo `web/state.js`, mení sa
  výhradne cez `setState` a prekresľuje výhradne cez `render` vo `web/render/index.js`.
  Render funkcie sú čisté: čítajú stav, zapisujú do DOM, nič nevolajú späť.
- **Slovenčina** v komentároch, textoch pre používateľa aj v správach commitov.
- **KISS.** Keď sú dve riešenia rovnako dobré, vyhráva jednoduchšie.

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
vo `web/interactions.js`).

Typ zariadenia nezisťuj – žiadne `maxTouchPoints`, `@media (hover: hover)` ani userAgent. Appka
reaguje na to, čím sa práve ovláda, nie na to, čo to je za prístroj; mobil s myšou aj notebook
s dotykovým displejom sú bežné. Z toho istého dôvodu nie je v `style.css` ani jedno pravidlo
`:hover` – na dotyku by ostávalo visieť po ťuknutí.

V CSS to isté hovorí `touch-action`. `none` znamená, že prehliadač nad prvkom nesmie nič, ani
posunúť stránku – patrí len úchytkám na ťahanie (kruh rozvrhu tarify v sprievodcovi). Plochy,
cez ktoré človek scrolluje popri ceste, majú `pan-y` (`.chart-wrap`, graf dňa `.day-scrub` na karte Terazky / Teraz, pás dňa
`.day-track` v detaile dňa karty 7 dní): zvislé posúvanie si necháva
prehliadač, vodorovné gesto JS. Kde `touch-action` nie je, rozhoduje prehliadač o oboch smeroch –
to je pre bežný obsah správne, dopisovať ho netreba.

**Karty sa ťahom prsta nelistujú**, len ťuknutím v navigácii – v oboch appkách. Ťah do strán má
jediné miesto: dni v detaile dňa karty 7 dní (`web/day-pager.js`, rozhodnutia v `shared/day-pager.js`).
Obsah dňa ide za prstom a vedľa neho stojí susedný deň, ktorý nakreslil ten istý render (appka ho na
chvíľu zavolá so susedným dňom a výsledok skopíruje) – iný kód na kreslenie dňa preto nepíš. Kópie
sú bez `id` (inak by boli v stránke dvakrát), takže štýly obsahu dňa stoja na triedach, nie na `id`. Posun
počas ťahu nie je v stave; do stavu ide až deň, na ktorom pás zastal. Na kraji sa pás len poddá,
z detailu von vedie šípka späť (prvý čip v riadku dní). Myš ťahať nemusí – čipy a šípky na klávesnici.
Nová appka v prehľade so stĺpcami listuje dni ťahom v stĺpci 7 dní, pás je v ňom.
Návrh: `docs/navrhy/7dni-listovanie-dni.html`.

Kontrolujú to e2e testy v skupinách „ťah prstom: karty sa nelistujú, dni v detaile áno“ (súčasná
appka) a „ťah prstom a tlačidlo Späť“ (nová): ťuknutie bez jediného pohybu prsta musí tooltip
ukázať a nechať svietiť, zvislý ťah cez graf musí posunúť stránku a tooltip neukázať.

## Ako overovať

```bash
npm run check     # lint, formát, typy, jednotkové testy s pokrytím
npm run test:e2e  # Playwright: všetky karty, interakcie, prístupnosť
cd worker && npx wrangler deploy --dry-run --outdir dist
```

Pokrytie `shared/` musí ostať aspoň 90 % riadkov, inak `npm test` zlyhá. Očakávané texty
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

- To isté platí pre `obloha/boot.js`, ktorý chráni novú appku (hlášku píše do `#hdr-status`),
  a jeho e2e testy v `test/e2e/obloha.spec.js`.
- Nová appka sťahuje karty 7 dní, Štatistika a Nastavenie až po štarte (`obloha/web/parts.js`) –
  tie `boot.js` nechráni. Keď ich `import()` zlyhá, appka namiesto karty ukáže hlášku s tlačidlom,
  ktoré stiahne súbory znova a obnoví stránku (najviac raz). Kontroluje to e2e skupina „nasadenie
  a cache: karty načítané neskôr“. Nový modul pre tieto karty patrí do ich časti, nie do jadra.
- `boot.js` **nesmie nič importovať staticky** – musí sa spustiť, aj keď je zvyšok grafu
  rozbitý. Z toho istého dôvodu `index.html` nenačítava žiadny iný modul appky.
- `boot.js` je v cache tiež, takže jeho nová verzia musí fungovať so starým `index.html`
  a naopak. Stačí nemeniť meno `app.js` ani `#pv-updated`, kam píše hlášku.
- Service worker ranného oznámenia (`sw.js` v koreni, pre obe appky) **súbory appky
  necachuje** – nesmie, inak by obišiel `boot.js`. Registruje sa s `updateViaCache: 'none'`,
  aby prehliadač bral jeho statické importy zo `shared/` vždy čerstvé (dynamický `import()`
  service worker nesmie). Každý push musí niečo ukázať, preto pri chybe ukáže výzvu pozrieť
  appku. Meno `sw.js` nemeň – zaregistrované telefóny by ostali na starom.

Kontrolujú to e2e testy v skupine „nasadenie a cache“: starý modul musí skončiť jedným
obnovením a naštartovanou appkou, chyba, ktorú obnovenie nevyrieši, hláškou bez slučky. Testy
starý modul podstrčia cez `page.route` (lokálny server cache nemá). So skutočnou HTTP cache
prehliadača – server s `max-age=600`, bez `page.route` – to bolo overené ručne, pre export aj
pre `byId`.

## Proces

Vetvy `claude/<téma>`, jeden pull request na tému, commit správy v štýle `feat: …`,
`fix: …`. Pred zlúčením musí byť CI zelené.
