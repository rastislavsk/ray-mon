# Návrhy

Zmrazené snímky klikacích návrhov k témam, o ktorých sa rozhodovalo.

**Sú to samostatné súbory, nie časť appky.** Nič z nich neimportuje `shared/` ani `web/`;
majú vlastnú kópiu farieb a rozmerov, aby sa dali otvoriť samostatne a aby ich zmena nikdy
nepohla appkou. Keď sa niektorý návrh nakóduje, tieto súbory ostávajú tak, ako sú —
dokumentujú, ako sa rozhodovalo, nie ako appka vyzerá dnes.

Otvoriť sa dajú priamo dvojklikom, alebo cez `npm run serve` na
`http://localhost:8080/docs/navrhy/`.

## Čo je čo

| Súbor                          | Téma                                                                                                                  |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `nahlad-casu-umiestnenie.html` | Karta Spotrebiče — kam s bublinou náhľadu času: dnešný stav vs. tri umiestnenia                                       |
| `nahlad-casu-variant-b.html`   | Rozpracovanie zvoleného variantu B: prívesok, zárez, obežnica                                                         |
| `7dni-mobil.html`              | Karta 7 dní na mobile — dnešný stav vs. tri návrhy menej detailného prehľadu (A, B, C)                                |
| `7dni-bez-hintu.html`          | Karta 7 dní na mobile — čo s miestom po pätke „Ťuknite na deň“ (A: bublina, B: pätka)                                 |
| `7dni-farby-dni.html`          | Karta 7 dní — akou logikou zafarbiť výrobu po dňoch (A: z najlepšieho dňa, B: z jasnej oblohy, C: sýtosť)             |
| `7dni-priebeh-dna.html`        | Detail dňa (súčasná appka) – namiesto grafu: hodiny (A), časti dňa (B), oblúk slnka (C); `?den=premenlivy`            |
| `7dni-priebeh-dna-2.html`      | Detail dňa – oblačnosť a kedy zapnúť spotrebiče: panoráma oblohy (D), deň ako kalendár (E)                            |
| `7dni-priebeh-dna-3.html`      | Detail dňa – D2: panoráma so značkami ✓ ◐ ✕, „teraz“ a bublinou (zamietnuté ako príliš detské)                        |
| `7dni-priebeh-dna-4.html`      | Detail dňa – D3 (vybraný): okno na spotrebiče, časová os oblačnosť / výroba / pás spotrebičov                         |
| `nastavenie-sprievodca.html`   | Karta Nastavenie — sprievodca nastavením elektrárne v šiestich krokoch (16 obrazoviek, klikací telefón)               |
| `tarify-vlastne-pasma.html`    | Vlastné tarifné pásma — logika (cena × slnko), sprievodca Tarifa, ciferník A vs. B, texty a postup                    |
| `statistika-uspory.html`       | Nová karta Štatistika — výroba a jej hodnota: počítadlo (A), hodnota dňa (B), týždeň a návratnosť (C)                 |
| `karta-mozem.html`             | Nová karta Môžem? pre rodinu – odpovede (A), stories (B), plagát so suchým humorom (C, vybraný)                       |
| `mozem-co-mozem.html`          | Karta Môžem? – blok „Čo môžem“ o krok ďalej: riadok + obrazovka (A, vybraný), panel (B), tlačidlo (C)                 |
| `mozem-co-mozem-c.html`        | Obrazovka „Čo môžem“ (súčasná appka) – skupiny podľa času (A), dlaždice (B), pás dneška a dlaždice (C, vybraný)       |
| `mozem-skupiny.html`           | Karta Môžem? (nová appka) – „Čo môžem“ v štyroch skupinách: dlaždice (A), časová os (B)                               |
| `nahlad-casu-graf.html`        | Graf dňa (nová appka) – čo ukázať pri náhľade času: len čas v štítku (A), čas pri čiare (B, vybraný), v nadpise (C)   |
| `teraz-v-grafe.html`           | Graf dňa (nová appka) – „teraz“ bez zvislej čiary: len bod (A), bod a stlmená minulosť pásu (B, vybraný)              |
| `prve-otvorenie-poloha.html`   | Prvé otvorenie bez ukážky Londýna: najprv poloha, potom panely alebo „Teraz nie“ so sivými kartami                    |
| `meranie-cez-api.html`         | Živé meranie aj cez API výrobcu meniča – výber značky, prihlásenie, overenie hneď, zoznam značiek a bezpečnosť        |
| `meranie-pristup-neplati.html` | Keď výrobca prístup k meraniu prestane prijímať: hláška s dôvodom podľa značky, pripojiť znova, Deye pred vypršaním   |
| `meranie-mlci.html`            | Krok 2: meranie, ktoré mlčí – ciferník a Môžem? počítajú z krivky dňa, nie zo starého čísla                           |
| `jeden-zoznam-veci.html`       | Krok 3: jeden zoznam vecí s bojlerom – piata dlaždica cez celú šírku, bublinka na Terazky, Spotrebiče v Oblohe        |
| `poloha-bez-panelov.html`      | Krok 4: poloha bez panelov – súčasná appka odpovedá z typickej strechy, jantárový pás „Hádam podľa suseda“ (A)        |
| `statistika-ako-suhrn.html`    | Karta Štatistika v oboch appkách ako súhrn: plagát, Dnes/Mesiac/Rok/Spolu, riadky 01–05; zdieľanie do story sa ruší   |
| `odkaz-verzia.html`            | Verzia odkazu s nastavením – appka povie, prečo odkaz neprevezme (poškodený, z novšej verzie); pravidlo A             |
| `smer-b-obloha.html`           | Nový dizajn „Živá obloha“ (smer B, vybraný 2. 10. 2026): všetkých 5 kariet, detail týždňa, desktop, widget, pravidlá  |
| `jedno-jadro-dva-kabaty.html`  | Obe appky natrvalo (22. 10. 2026): pravidlo jadro × kabát, deväť rozdielov, tri zjednotenia (všetky A)                |
| `mozem-zoznam.html`            | Čo môžem (súčasná appka) ako zoznam s hláškami jadra namiesto dlaždíc: tmavé riadky (A), zelené riadky (B)            |
| `terazky-ako-obloha.html`      | Terazky podľa Teraz z Oblohy: len pás odporúčaní pod ciferníkom (B), celá karta s grafom dňa (A); farby súčasnej      |
| `terazky-casova-os.html`       | Terazky / Teraz s časovou osou: A, B, C; oblačnosť pruhom (C1) či heatmapou (C2); C2 s výplňou nad hranicou (vybraný) |

## Prečo je to v repozitári

Návrhy vznikli ako artifacty na claude.ai. Tie sa dajú prepísať a nie sú viazané na commit,
takže tu je ich kópia — verzionovaná spolu s kódom, ktorého sa týkajú.

## Náhľad času: dôležité čísla (namerané v mierke telefónu 375 × 518 px)

Dnešné dve bubliny stoja pás dňa **40 px** výšky: 24 px je nafúknutie koridoru, kým je banner
vidno (pravidlá `:has()` v `style.css`), zvyšok je trvalá rezerva v `margin-bottom` karty
`.verdict`. Pás dňa tak dostane 45 px namiesto 85 px. Všetky tri umiestnenia tých 40 px vracajú
v plnej výške — líšia sa len vzhľadom, nie úsporou miesta.
| `bez-pustil-som.html` | Karta Môžem? bez „Pustil/a som“ – čo zmizne v oboch appkách (beží do, súčet, riadok súhrnu, plagát) a čo s dátami |
| `7dni-listovanie-dni.html` | Bez listovania kariet ťahom; dni v detaile ako pager za prstom (obe appky), gumička na kraji, šípka späť ako prvý čip |
| `znacky-beta.html` | Sprievodca nastavením, krok Značka meniča – odznak Beta pri značkách neoverených na skutočnom meniči (A, vybraný) vs. slovo v popise (B) |
| `teraz-rozbalovaci-zoznam.html` | Teraz[ky] – legenda a nápis pod grafom dňa ako rozbaľovací zoznam: prvý riadok návod a „ako čítať graf“ (A), prvý riadok legendy a hodnoty v čase pod prstom (B, vybraný) |
| `oznamenia.html` | Oznámenia v telefóne: jeden ranný plán dňa (logika A) – jasno, len dopoludnia, zamračené, zlý týždeň, tlačidlo Pripomeň; Plán dňa na Môžem?, Nastavenie |
