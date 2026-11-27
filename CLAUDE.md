# Pokyny pre prácu v tomto repozitári

## Čo to je

Statická webová appka (GitHub Pages) pre domácnosť s fotovoltikou + Cloudflare Worker,
ktorý jej dodáva dáta. Podrobnosti v `README.md` a `docs/ARCHITECTURE.md`.

Appka je jedna: „Živá obloha“ v koreni (`index.html`, `app.js`, `css/`, `web/`). Pôvodná appka
skončila v novembri 2026, jej posledný stav je v git tagu `original-posledna`.

`obloha/` je len prechod a nič nové doň nepatrí: `index.html` presmeruje staré odkazy aj s hashom,
`sw.js` drží odbery oznámení z čias, keď appka bývala tam (`APPKY` vo
`web/oznamenia.js`). Odstrániť sa dá, až keď na žiadnom telefóne nebude starý odber.

Jadro (`shared/`) môže ešte niesť zvyšky pôvodnej appky, ktoré testy nazvú použitými, hoci appka ich nečíta
(takto boli zmazané `farba` vo vzhľade a `pas` v `shared/pristup.js`). Keď na ne natrafíš, zmaž ich.

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

Pri načítaní je najnovšia snímka hneď na mape, no kým neprídu všetky snímky, pohyb, model a dlaždice mapy (najviac
`RADAR.cakanieMs`), v strede obiehajú slnko a mesiac (`#rd-svitanie`) a Play, os aj rozsahy čakajú (`radarHotovo`):
prehrávanie potom nič nedoťahuje. Obnova sa spustí, keď už mala vyjsť ďalšia snímka (`obnovitRadar` v `shared/radar.js`:
krok + `zverejnenieMin` po najnovšej, pokus najviac raz za `obnovaPokusMs`) - pri prepnutí na kartu, návrate do appky
a každú minútu, kým je karta na obrazovke. Sťahuje bokom (`nove` v `web/radar-hrac.js`) a vymení všetko naraz, keď os
stojí a nik ju neťahá; zastavená os v rozsahu 2 h ostane na tej istej chvíli.
Hlavička nepíše „Teraz“, ale vek snímky od chvíle teraz, aj pri predpovedi (`popisChvile`, `docs/navrhy/radar-obnova.html`,
D1 + D3, 27. 11. 2026); najnovšia staršia ako `RADAR.meskaMin` má koralovú farbu (jantárová je predpoveď). Ťuknutie na čas
(`#rd-chvila`) obnoví hneď a kým sťahuje, točí sa krúžok (`radarObnovuje`). Os ostáva s „Teraz“.

Sneh (`docs/navrhy/radar-sneh.html`, D1 + V1 + legenda C, 26. 11. 2026): radar typ zrážok nevie (OPERA ani kompozity SHMÚ ho
nemajú), podiel snehu dáva model z toho istého dopytu (`snowfall`, `temperature_2m`, `podielSnehu` v `shared/radar-data.js`).
Shader vyberie riadok farieb dážď / dážď so snehom / sneh (`RADAR.farbySneh`, `farbyZmiesane`, `RADAR.sneh`), aj pre merané
snímky - podľa hodiny modelu. Legenda sú tri ikony s pásmi bez slov. Model kreslí sneh vzťahom Z = 2000·S², nie ako dážď.
Od 27. 11. 2026 je to V3 so statickými vločkami: sneh má znížené krytie a shader do neho kreslí biele vločky s tmavým lemom
(`RADAR.vlocky`), ukotvené na mape, veľkosť v CSS px. Hrubá mriežka modelu má body asi 115 km od seba, preto je okolo
polohy z Nastavenia detail `detailBody` × `detailBody` po `detailKrokKm` (`detailBody` v `shared/radar-data.js`) v tom istom
dopyte (288 bodov). Detail je jedna textúra RGB na hodinu (zrážky, oblaky, sneh), v strede platí naplno a kruhovo sa prelieva
do hrubej mriežky; pás na osi berie hodnoty z jeho stredu. Uložený model má kľúč aj s polohou.
Prvé Play po prvom načítaní ide od „teraz“ dopredu (`odTeraz` vo `web/radar-hrac.js`), ďalšie z konca či z „teraz“ od začiatku osi.

Predpoveď na 2 h je len posun poslednej snímky. Spätný test: druhá hodina je slabá a vznik búrky nevie. V appke
sa preto vždy píše „predpoveď“, nikdy nie „radar“.

## Karta Dnes: obloha a posuvník dňa

Návrhy a rozhodnutia: `docs/navrhy/dnes-obloha-posuvnik.html` (A) a `docs/navrhy/dnes-tlacidlo-teraz.html` (T4c), 23. 11. 2026.
Všetko, čo bolo nad pásom (odznak a veľké slovo, odpočet okna, Dnes zo strechy, večer zajtrajšok), sú prvé dlaždice pásu
(`dnesKarty` v `shared/dnes-faza.js`), oblúk slnka je preč. Hore je veľký výkon a pod ním posuvník dňa 0 – 24 h: deň od
východu po západ sýtejšia biela, pod čiarou len ich časy, bežec je plný kruh a keď odíde, na teraz po ňom ostane odtlačok
(ťuknutie ho vráti). Zvolený čas je `mzCas` v stave (nie krok navigácie, iná karta ho vráti na teraz); výkon, farby neba
aj kresba počasia `#wx` sú vtedy v tej chvíli (`shared/dnes-nebo.js`, `render/index.js`, `render/mozem.js`).

Hviezdy a Mesiac v noci (`docs/navrhy/dnes-hviezdy-vysek.html`, R1, 24. 11. 2026) sú na Dnes tak, ako ich vidno pri pohľade
na východ: vlastné pole `HVIEZDY.dnes` so stredom pohľadu na obzore - obzor je čiara posuvníka, kraje SV a JV, vrch obrazovky
zenit (`.wx[data-dnes]` v `css/dnes.css`). Pole ide s modelom počasia (`pocasieTeraz(…, HVIEZDY.dnes)`, `pole` v `Pocasie`);
karta Teraz má ďalej svoje pole nad scénou.

Nižšie dlaždice a zarovnanie s Teraz: `docs/navrhy/dnes-nizsie-dlazdice.html` (D + Z2), 23. 11. 2026. Graf dňa (Kheinshmetke)
je zrušený aj s panelom, `grafModel` a stavom `terazPreview`; krivku dňa kreslí ďalej detail dňa karty 7 dní. Každá dlaždica
pásu nesie dvojicu s tenkou čiarou medzi nimi (`docs/navrhy/dnes-vsetky-dvojice.html`, A + O2, 25. 11. 2026; `DVOJICE`
v `shared/dnes-faza.js`): Dnes | Veľké veci, večer Dnešok | Zajtra (bez zajtrajška Dnešok | Kedy lepšie), Zo strechy | Ako keby,
Predpoveď | Oblačnosť, Najviac slnka | Kedy lepšie. Sama ostane karta len bez dát. Karta Nabehlo nie je - cez deň je to pásik
a riadok pod číslom Zo strechy. Odznak triedy dňa je v nadpise len krúžok s i vo farbe triedy (slovo má čítačka a bublina)
a veľké slovo je krátke (`DEN_WORDS.iny` ráno, cez deň aj pri Zajtra, meno dňa povie nadpis) - v polovici dlaždice
sa pri 360 px nič dlhšie nezmestí. Texty kariet sú krátke, prirovnania sú ikony. Posuvník dňa stojí presne vo výške stredu poľa toku karty Teraz: obloha nad ním
je `--scena-h` (výška scény Teraz, `css/zaklad.css`) + 126 px, pás dlaždíc vyplní zvyšok (najmenej 124 px, potom sa
stránka posúva). Keď sa na Teraz zmení niečo nad poľom toku, zmeň aj tých 126 px v `css/dnes.css` - stráži to e2e
„posuvník dňa vo výške poľa toku karty Teraz“.

## Bojler na prebytky

Návrh a rozhodnutia: `docs/navrhy/bojler-prebytky.html`. Zásuvka Shelly s bojlerom má skript (`shared/bojler-skript.js`),
ktorý sa každú minútu pýta Workera (`/bojler`); rozhoduje `shared/bojler.js` podľa prebytku **bez bojlera** = dodávka
do siete z elektromera + príkon zásuvky (elektromer meria celý dom vrátane bojlera, kladný `active_power` je dodávka,
vo W – overené 15. 11. 2026). Všetky merania účtu Huawei Northbound idú cez Durable Object `UcetHuawei`
(`worker/src/ucet.js`): Huawei pri prihlásení zruší staršiu reláciu a meranie dovolí raz za 5 minút, telefón a zásuvka
by sa inak navzájom odhlasovali. Do objektu nepatrí heslo – prichádza vždy v pečati. Jazyk skriptov Shelly je starší
JavaScript (bez šípok a čiarok na konci) a HTTP.POST nesmie mať prázdne telo; stráži to `test/bojler-skript.test.js`.
Ručný režim (prepínač v paneli Bojler dnes, `/bojler-rezim`, kľúč `br:` v objekte): skript beží ďalej a hlási,
ale relé neprepne ani pri tichu; Worker mu vtedy vráti `zapni` rovné stavu relé, aby nič neprepol ani starší skript.
Beh v zázname dňa je jeden ohrev, nie jedno zapnutie relé: keď termostat po nahriatí zapne znova a relé je stále
zapnuté, starý beh skončí v čase nahriatia a začne nový (`dalsiOhrev` v `shared/bojler.js`, 25. 11. 2026).
Kým sa zásuvka ozýva (`BOJLER.riadenyHod`), karta Teraz bojler neradí: má dlaždicu so stavom a panel Bojler dnes
(`shared/teraz-bojler.js`), otvorený tým istým krokom `tzVec` ako detail spotrebiča.
Stav bojlera chodí s meraním Huawei len raz za 5 minút, preto sa appka medzi meraniami pýta každú minútu na
`/bojler-stav` (len stav z objektu, na Huawei nejde nič; `cerstvyBojler` vo `web/refresh.js`) a push o zmene
ohrevu (`OZNAMENIA.bojler`) pošle `sw.js` aj otvoreným oknám, ktoré si stav stiahnu hneď.
Teplomer vo vode (`docs/navrhy/bojler-teplota.html`, B2 + T1 + P1 + N2, 23. 11. 2026): DS18B20 na Shelly 1 Gen3 s Add-onom
v domácej sieti (snímač `temperature:100`, heslo zapnuté). Teplotu číta skript zásuvky (`HTTP.GET` s `admin:heslo@` v adrese)
a posiela ju ako `t` s hlásením; bez teplomera je skript bajtovo ten istý ako predtým. Worker drží poslednú (`voda` v `b:`)
a bod každých 5 minút za 7 dní (`bt:`, `shared/bojler-voda.js`), appke dá dnešné body (`teploty`). Heslo teplomera appka
neukladá, len adresu (`teplomer-v1`). Hranica teploty (`docs/navrhy/bojler-hranica.html`, možnosť 2 + H2 + D1): nastavuje sa
v Nastavení („Hriať do“, kým nie je, hreje sa po termostat), drží ju Worker (`bh:`, `/bojler-hranica`) a posiela zásuvke
(`maxC`, `minC` = hranica - `BOJLER.vodaHystC`). Pravidlo `strazVodu` (`shared/bojler-voda.js`) má Worker aj skript zásuvky,
ktorý ho stráži aj bez internetu; bez teploty hranica nič nebráni. V ručnom režime ju nestráži nikto. Termostat na bojleri
je nastavený vyššie ako poistka.
Panel Bojler dnes (`docs/navrhy/bojler-panel.html`, A + D2, 24. 11. 2026): stav a plán v riadku pod nadpisom, teplota vody
a pás behov na jednej osi 0 – 24 h, energia slnko / sieť / sieť vo VT (VT len pri tarife s drahým pásmom), behy zbalené
a dole prepínač **Čo riadi bojler?** so Shelly (ručný režim, `rucne`) a Ray-mon. Sieť je modrá, červená len VT. Beh si vo Workeri
drží energiu a odber zo siete po štvrťhodinách (`q`, `BOJLER.qMin` = krok tarify), z nich appka vie VT presne; beh bez `q`
(starší Worker) ráta VT odhadom - odber rozloží rovnomerne na čas behu.
Bojler riadi jedno zariadenie (`docs/navrhy/bojler-jedno-zariadenie.html`, C + D, 24. 11. 2026): skript posiela
`Shelly.getDeviceInfo().id`, Worker pripne prvú zásuvku s meraním príkonu (`bd:`, `zariadenieBojlera` v `shared/bojler.js`)
a ostatným vráti 409; hlásenie bez `w` (Shelly 1 Gen3 s teplomerom) neprejde nikdy. Skript patrí len do zásuvky.

## Klimatizácia Daikin

Návrh a rozhodnutia: `docs/navrhy/klima-daikin.html` (cesta A, dlaždica B, pásik ako pri spotrebičoch, Z1, 26. 11. 2026).
Klimatizácia (Sensira s adaptérom BRP069B4X) má v domácej sieti lokálne HTTP API bez hesla. Worker na domácu sieť nevidí,
preto ju číta skript na Shelly s teplomerom (`shared/klima-skript.js`, nie zásuvka bojlera): každú minútu stav a teploty,
každých `KLIMA.hodinyMin` energiu, každých `KLIMA.rokMin` rok a Wi-Fi, a surové odpovede pošle na `/klima` s pečaťou
z `/bojler-pecat`. Čítať ich vie `shared/klima.js` (`zHlasenia`); objekt `UcetHuawei` drží stav (`kl:`) a body (`kt:`)
a appka si cez `/klima-stav` berie stav s dnešnými bodmi a zdrojmi hodín (`slnkoKlimy` z `hd:` - klimatizácia ide pred
bojlerom). Dlaždica (`shared/teraz-klima.js`) je v pravom stĺpci pod autom: príkon, „vonku / nastavená“ len hodnotami
a dnešné kWh; panel Klíma má graf dňa, energiu, 14 dní, rok a podrobnosti. Klimatizáciu appka len sleduje, riadenie
a odčítanie z odhadu nabíjania auta sú v `docs/to do later.md`. Aktualizácia firmvéru adaptéra (appka Onecta) môže lokálne
API zrušiť - potom ostáva cloud Onecta (200 volaní za deň) alebo ESP32 Faikin.

## Spotrebič beží

Návrh a rozhodnutie: `docs/navrhy/teraz-bezi-spotrebic.html` (A + 1, 18. 11. 2026), koniec programu a opakovanie
`docs/navrhy/spotrebic-koniec-opakovanie.html` (19. 11. 2026). „Už beží“ v detaile spotrebiča na karte Teraz zapíše beh
práčky, sušičky či umývačky (`BEZI.veci`) do telefónu (`bezi-v1`, `shared/bezi.js`; beh má začiatok `m` aj koniec `k`), len
na ten deň. Práčke a sušičke človek nastaví zvyšok programu z displeja kolieskami hodín a minút (`BEZI.zvysok`), umývačke
čas zapnutia výberom času telefónu (`docs/navrhy/spotrebic-cas-nastavenie.html`, A + D + P1, 22. 11. 2026). „Už beží“ nič
neuloží, len ukáže nastavenie s návrhom (`vecNavrh` v stave); uloží až „Nastaviť“, ktoré zavrie panel a ukáže bublinu
`#vec-bublina` s „Vrátiť“ - aj po „Nebeží“. Kolieska posúva prehliadač (scroll-snap), appka si hodnotu prečíta, keď zastanú;
koliesko, ktoré sa práve točí (`data-toci`), prekreslenie nevráti.
Za deň môže spotrebič bežať viackrát: kým beží, plán ho nerozvrhuje (`behy` v `shared/plan-dna.js`) a jeho odber si berie
z rozpočtu; čo dobehlo, plán ponúkne znova a sušička suší pranie, ktoré ešte nesušila (`mokre`). Bežiaci spotrebič má vlastnú
dlaždicu (`bezi`), dobehnutý dlaždicu s ďalším časom a odrážkou „dnes už 1×“. Overiť to appka nevie – je to na slovo.
Pri Huawei Northbound si behy telefóny domácnosti zdieľajú (`docs/navrhy/bezi-spolocne.html`, A + 1a + 2a, 22. 11. 2026):
zmena ide hneď na `POST /bezi` do objektu `UcetHuawei` (kľúč `bz:`), dnešné behy všetkých telefónov si appka berie pri každej
obnove dát (`web/bezi-spolocne.js`). Zmena, ktorú Worker nepotvrdil, čaká v `bezi-caka-v1` a odpoveď ju neprepíše.
Tichý push Chrome nedovolí (každý push ukáže oznámenie), preto žiadny push. Ostatné zdroje: `docs/to do later.md`.
Oznámenie o konci (`web/koniec.js`, `POST /koniec`) posiela Durable Object `Budik` alarmom presne v čase konca; text skladá appka
(`koniecNotice`) a Worker ho šifruje pre telefón (RFC 8291, `zasifruj` vo `worker/src/webpush.js`). Bojler oznamuje každú zmenu
ohrevu (`zmenaOhrevu` v `shared/bojler.js`) telefónom, ktoré si to zaplí v paneli Bojler dnes (`POST /bojler-oznamenia`).
Worker s novou migráciou Durable Objectu treba nasadiť ručne pred pull requestom (`worker/README.md`).

## Spotrebič na zásuvke Shelly

Návrh a rozhodnutie: `docs/navrhy/pracka-zasuvka.html` (A + U1 + K2 + S2, 26. 11. 2026). Práčka, sušička či umývačka môže mať
vlastnú zásuvku Shelly so skriptom z Nastavenia (`shared/zasuvka-skript.js`, spotrebič je v skripte): každú minútu pošle
`POST /spotrebic` s príkonom a počítadlom energie, relé **nikdy neprepína**. Beh rozoznáva Durable Object `UcetHuawei`
(`krokZasuvky` v `shared/zasuvka.js`, stav `zs:`, prahy `ZASUVKA`): začne po dvoch hláseniach nad prahom, skončí po krátkej
pauze, len keď trval aspoň 0,7 typickej dĺžky (medián posledných behov zásuvky), po dlhej pauze vždy (K2). Beh ide do
spoločných behov `bz:` ako „Už beží“ - kým beží, s koncom podľa typickej dĺžky. Kým sa zásuvka ozýva (`ZASUVKA.ozyvaMin`,
stav chodí s odpoveďou `/bezi`), detail spotrebiča nemá „Už beží“ ani nastavenie času, len zmeraný príkon a vypínač
oznámenia o konci (`zo:`, `web/zasuvka-oznam.js`) - U1. Príkon zásuviek sa odpočíta zo spotreby domu v histórii aj
pri odhade nabíjania auta (`domBezBojlera`). Spotrebič meria jedna zásuvka, iná dostane 409, kým sa prvá ozýva.

## Tok iného dňa na karte Teraz

Iný deň v páse nemá nad dlaždicami meno, dátum ani hlášku, ale pole toku ako dnešok (`docs/navrhy/teraz-pole-ine-dni.html`, B, 26. 11. 2026): slnko → dom → sieť za celý deň v celých kWh so stojacími šípkami (`tokDnaModel` v `shared/teraz-scena.js`,
`tokDna` v `shared/teraz.js`, kreslí to isté `tokPoleHtml` do `#tz-tok`, vtedy s `data-den` a vypnuté). Slnko je predpoveď dňa,
dom naučený profil (bez učenia `HOUSE_BASE_KW`) + bojler podľa `potrebaBojlera` + typický program každého ďalšieho spotrebiča
Plánu dňa (auto nie), sieť je rozdiel zaokrúhlených čísel - netto za deň. Hláška triedy dňa (`DEN_WORDS.iny`) ostala len
na karte Dnes; pravidlá s „novou vecou“ z PR #525 boli zrušené už predtým.

## Dlaždice bez farby stavu

Rozhodnuté 21. 11. 2026: dlaždice spotrebičov na karte Teraz sú všetky na skle s bielym textom - farba nehovorí,
či slnko stačí, z akej siete ide prúd, ani že spotrebič beží (aj krémová bežiaceho zmizla). Riadok nad dlaždicami
(bodka + „Teraz zo slnka“) aj jeho panel s vysvetlením sú preč. `data-tone` na dlaždici ostáva ako údaj, štýl ho
nefarbí; výnimkou je jantárový rám zásuvky bez spojenia (`chyba`). Úsek na osi v detaile a pás dní sú graf, tie farby majú.

Druhá výnimka (26. 11. 2026, `docs/navrhy/teraz-zapnuty-farba.html`, F1 so žiarou): zapnutý spotrebič - beží („Už beží“), bojleru
zásuvka zapla relé alebo sa auto asi nabíja - má len kruh s ikonou plný biely (`--zapnuty`)
s tmavou ikonou a bielou žiarou (`data-zapnuty`) a dlaždica má biely obrys ako zvolený deň v páse dní (`--obrys-zvoleny`, 26. 11. 2026). Zelená a oranžová,
farba celej dlaždice, svietiace sklo ani modrý prstenec neprešli. Kto bojler zapína, dlaždica neukazuje (značka ruka / slnko
pri ikone zrušená 26. 11. 2026), povie to panel Bojler dnes; bodka stavu bojlera pri ikone je preč. Sklo dlaždíc
počíta render s oblohou (`skySklo` v `shared/sky.js`, `--dl-sklo`, `docs/navrhy/teraz-dlazdice-sklo.html`, 1, 26. 11. 2026):
tmavé, kým stačí, aby sa dlaždica od oblohy líšila aspoň `SKY.sklo.kontrast`, v tmavej noci svetlé. Pevné svetlé sklo
po západe slnka (2B) na sivej oblohe súmraku splynulo.

Druh riadku plánu `sun` znamená naozaj „na slnku“. Vec, ktorá ide natvrdo po inej (sušička po práčke) a slnko jej
nedá ani `PLAN_DNA.zoSiete`, má druh `siet` (`zoSieteNatvrdo` v `shared/plan-dna.js`) - predtým bola `sun` a appka
v tme hlásila „Teraz zo slnka“ a na karte Dnes ÁNO.

## Plán dňa zo živých dát a učenie z histórie

Návrhy a rozhodnutia: `docs/navrhy/plan-dna-zive-data.html` (balík B, bojler má prednosť pred práčkou, sušičkou
a umývačkou) a `docs/navrhy/plan-dna-ucenie.html` (Worker zbiera, telefón sa učí, tabuľky s váhou podľa veku), 19. 11. 2026.
Zber (`shared/historia.js`, `HISTORIA`): Durable Object `UcetHuawei` skladá z každého nového merania
hodinové súhrny výroby a spotreby domu bez bojlera (`hh:` bežiaca hodina, `hd:` dni) a pri prvom dopyte zásuvky
v novom dni pripíše deň bojlera. V telefóne sa ukladá snímka predpovede dňa (`predpoved-hist-v1`) a história behov
z „Už beží“ (`behy-hist-v1`), lebo `bezi-v1` drží len dnešok. Odložené časti učenia majú termíny v `docs/to do later.md`.

Model pri Huawei Northbound počíta Worker (`docs/navrhy/ucenie-vo-workeri.html`, B + S1 + B1 + O1 + P1, 24. 11. 2026),
aby mali telefóny domácnosti ten istý: `POST /ucenie` (`ucenie` vo `worker/src/ucet.js`) počíta `naucene` najviac
raz za deň a drží ho pod `um:` - nad 60 dňami trvá niekoľko ms a bezplatný Worker má 10 ms. Zápis, ktorý mení
vstup staršieho dňa (uzavretá hodina včerajška, deň bojlera, beh staršieho dňa v `/bezi`), `um:` zmaže. Snímky
predpovede posiela prvý telefón, ktorý ich má (`hs:`, platí prvá, `zlucSnimky`), behy sú spoločné `bz:` za
`HISTORIA.dni` dní (`/bezi` telefónu vracia len dnešok), „Začať odznova“ je spoločné (`uo:`). Telefón sa pýta
raz za deň, s novou dnešnou snímkou a pri „Začať odznova“ (`web/ucenie.js`, `ucenie-worker-v1` s menom elektrárne);
prvýkrát pošle aj všetky svoje snímky, behy a `ucenie-od-v1`. Kým model od Workera nemá, a pri inom zdroji merania,
počíta ho telefón sám. `/historia` ostáva len pre staršiu appku v cache, `historia-v1` sa už len číta.

Plán dňa ráta so živými dátami (`PLAN_ZIVE`): predpoveď za posledným meraním opravuje pomer meranie / predpoveď
za poslednú hodinu (`opravaPredpovede` v `shared/chart-model.js`, jediné miesto - `dayKwAt` aj graf dňa), štvrťhodina
teraz je z výkonu teraz a spotreba domu z elektromera bez bežiacich spotrebičov a bojlera (`ziveMeranie`, `freeKw`
v `shared/mozem-jadro.js`). Živé meranie platí len pre kontext teraz - kópie kontextu od polnoci (iné dni, trieda
dňa) ho nevidia. Bojler, ktorý riadi zásuvka, ide v pláne pred všetkými: `simulujBojler` (`shared/bojler.js`) púšťa
to isté `rozhodni` ako Worker nad rozpočtom plánu, práčka a sušička potom idú natvrdo a bojler sa odsimuluje znova
(`bojlerPrvy` v `shared/plan-dna.js`).

Učenie (`shared/ucenie.js`, `UCENIE`) nemá vlastný stav: `web/ucenie.js` po každej obnove dát prepočíta model z histórie
Workera (stiahnutej raz za deň, `historia-v1`), snímok predpovede a behov. Naučená oprava predpovede sa pridáva na jednom
mieste - `sNaucenim` vo `web/render/index.js` pred kreslením; v stave ostáva predpoveď tak, ako prišla, lebo z nej sa
učí. Spotreba domu po hodinách (`ctx.dom`) a potreba bojlera (`potrebaBojlera`) idú do Plánu dňa cez `input.ucenie`.
Hodina, v ktorej je medián domu nad `PLAN_ZIVE.domMax` (nabíjanie auta, niečo veľké), sa do profilu domu nezaráta
(`hodinaDomu` v `shared/ucenie.js`, to isté pravidlo má `domDnes` večerného prepisu auta), 24. 11. 2026.
„Začať odznova“ v Nastavení len posunie deň, od ktorého sa učí (`ucenie-od-v1`). Ranné oznámenie (service worker)
ráta s tým istým: appka mu do zrkadla odloží aj `ucenie` a posledný stav bojlera a vstup skladá `swInput`
(`shared/oznamenia.js`, `docs/navrhy/plan-dna-oznamenie-vt.html`, O2, 24. 11. 2026) - živé meranie nemá.

Pásik dlaždice má tri farby (P1): slnko (`podiel`), lacná či bežná sieť a drahé pásmo (`draha`, `podielDrahy`
v `shared/plan-dna.js`; bojler `bojlerDrahaDnes`). Pásik bežiaceho spotrebiča (`behy`) ráta so slnkom, ktoré
ostane po bojleri riadenom zásuvkou (do teraz z jeho záznamu dňa, potom simulácia, `bojlerOdberDna`) a po skôr
zapnutých spotrebičoch - inak by súbeh s bojlerom ukázal slnko, ktoré si vzal bojler (24. 11. 2026). Bojler bez zásuvky (`cheapGrid`) ide len do lacného
pásma, z ktorého ostáva aspoň `PLAN_DNA.lacnaMinMin` (A1) - koniec NT o 7:30 nie je „zapni teraz“.

## Auto mimo Plánu dňa

Návrh a rozhodnutie: `docs/navrhy/auto-mimo-planu.html` (A1 + K2 + B1 + Z1, 24. 11. 2026). Auto v Pláne dňa nie je
(`PLAN_DNA.order`) - nabíjanie riadi človek sám, takže ho nemá ani trieda dňa, karta Dnes ani ranné oznámenie. Dlaždica auta
na karte Teraz (pod bojlerom, bez detailu) povie, koľko kWh a km by dalo slnko, keby auto viselo na nabíjačke celý deň
a práčka, sušička ani umývačka nebežali (`shared/auto-slnko.js`): prebytok nad naučenou spotrebou domu a nad bojlerom riadeným
zásuvkou (simulácia ako v Pláne dňa, `bojlerDna`), len minúty nad minimom nabíjačky (`AUTO_SLNKO.minKw`), najviac jej príkon.
Telefón číslo ráno zamrazí (`auto-den-v1`, `web/auto-den.js`) a po západe slnka ho raz prepíše skutočnosťou: výroba z krivky dneška,
dom z hodín `/historia` (hodina s behom „Už beží“ alebo nad `PLAN_ZIVE.domMax` sa nahradí naučeným profilom, `domDnes`) a bojler
zo záznamu zásuvky. Iný deň v páse dní ukáže odhad z jeho predpovede (`autoDna`).

Či sa auto nabíja (`docs/navrhy/auto-nabija.html`, D2 + R2 + T2 + N3 + P2, 24. 11. 2026), auto appke nepovie - odhaduje to
Durable Object `UcetHuawei` z každého nového merania (`krokAuta` v `shared/auto-nabija.js`, kľúč `an:`): dom bez bojlera
aspoň `AUTO_SLNKO.minKw` dve merania za sebou = začalo, pod `AUTO_NABIJA.skonciKw` dve merania = skončilo, medzera nad
`medzeraMin` počíta odznova. Pri zmene pošle push tým, čo si to zapli v paneli Auto (`/auto-oznamenia`, `ao:`, začiatok
a koniec zvlášť), v noci potichu (`autoTiche`, `silent` v `sw.js`). Appka si stav berie cez `/auto` pri každej obnove
(`web/auto-nabija.js`). Počas nabíjania je dlaždica o behu zapnutá ako spotrebič (`data-zapnuty="nabija"`, biely kruh),
oranžovú ikonu má len panel Auto (`--nabija`). Dlaždica otvorí panel Auto (`tzVec` 'auto'), kým appka stav od
Workera má. Dobité a odpojené vyzerá rovnako, preto texty vždy „asi“. Meria sa len, keď sa Workera niekto pýta (zásuvka
bojlera každú minútu, inak otvorená appka).

## Scéna toku energie na karte Teraz

Návrh a rozhodnutia: `docs/navrhy/teraz-tok-energie.html` (návrh 1). Namiesto veľkého čísla kW je hore scéna: dom
je čiarová kresba `img/dom.png` (biele čiary na priehľadnom pozadí) s výplňou `img/dom-vypln.png` pod ňou
(vyrába ju `scripts/dom-vypln.js` z kresby; pri zmene kresby ju vyrob znova). Ten istý skript vyrába
`img/dom-okna.png`: tabuľky dvoch okien na štíte pod panelmi, ktoré v tme svietia, akoby bol niekto doma, okrem
`TERAZ_OKNA_SPANOK` (0:00–5:00 miestneho času; rozhoduje `oknaSvietia` v `shared/teraz-scena.js`). Dom stojí na kopci a zem, dom aj
elektráreň sú plné, aby za nimi nebolo vidno dážď, sneh ani oblaky (`docs/navrhy/teraz-scena-zem.html`, počasie B);
farbu zeme berie z oblohy (`--s2`). Dážď a sneh preto padajú až za kopec - výška zrážok `--wx-prec-h` sa ráta
z `--scena-h` (`css/zaklad.css`, `docs/navrhy/pocasie-sneh-slnko-zem.html`, 26. 11. 2026); keď sa zmení výška hlavičky
alebo scény, zmeň aj ju. Sneh sú náhodné vločky vo veľkých dlaždiciach a lúče slnka nepravidelný kužeľ, oboje so
semienkom vo `web/pocasie.js`. Elektráreň a vedenie kreslí
`web/render/teraz-scena.js`, čo kresliť (čísla, lúče, body), počíta `shared/teraz-scena.js`. Panely na kresbe
hľadia doľava, preto slnko živej oblohy svieti z ľavého horného rohu (`--wx-sx` v `css/zaklad.css`) a krajina je
zrkadlová. Scéna čísla nemá: sú v poli toku `#tz-tok` pod pásom dní (`tokPoleHtml`, 22. 11. 2026,
`docs/navrhy/teraz-pole-noc-bezi.html`, 1A) - slnko → dom → sieť, bez slov, biele ako všetok text na holej oblohe,
medzi nimi vedenie s impulzom smerom toku. Iný deň má v tom istom poli tok celého dňa (pozri vyššie), takže dlaždice
stoja v každom dni na tej istej výške. Ťuknutie na pole aj na scénu otvorí panel Elektrina teraz (s elektromerom).
Číslo, ktoré appka pozná, je tam vždy, aj nulové („0,0“; `cisla` v modeli scény). Impulzy na vedení scény (výboj s chvostom) sú SMIL, nie CSS -
pri obmedzenom pohybe ich preto skrýva CSS a ukáže šípku smeru; v poli toku je impulz CSS a pri obmedzenom pohybe
tiež ustúpi šípke. Bodka stavu merania je v hlavičke za miestom (na stred riadku),
ťuknutie ukáže len bublinu, ktorej nadpis začína tou istou bodkou; `#tz-stav` je do prvého prekreslenia skrytý a `boot.js` ho pri chybe odkryje.

## Tlačidlo Späť

Späť vráti posledných 5 krokov navigácie (`SPAT.krokov`), ďalšie ide rovno na Teraz, na Teraz ukáže bublinu
„Ďalším stlačením sa appka zatvorí“ a až ďalšie appku zavrie – rozhodnuté 19. 11. 2026. Každý krok (`navStep`
vo `web/state.js`) je položka histórie s poradím `i` (`web/nav-history.js`); 0 je štart (bublina), 1 Teraz.
**Položka histórie smie pribudnúť len pri ťuknutí** – Chrome položku pridanú bez neho pri ďalšom Späť preskočí.
Riešenie so strážnou položkou vracanou pri Späť (#501) preto na S22 zatváralo appku priskoro. Zatváranie krížikom
ide cez `stepBack` (`web/nav-back.js`), nie cez nový krok, inak by Späť zatvorené znovu otvorilo.

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

`.hidden` preto ako **jediné miesto v štýloch (`css/`) používa `!important`**. Nie je to
nedbalosť: skôr stála len na konci súboru a spoliehala sa na poradie, lenže poradie
rozhoduje iba pri rovnakej špecificite. Pätnásť pravidiel s `display` ju prebíjalo a dve
z nich sa naozaj prejavili. Vymenúvať, čo je zakázané (ID selektory, potomkovské
selektory, …), nefunguje – to sme už raz skúsili a chyba prišla dierou, ktorá v zozname
nebola. Inde `!important` nepíš. Jedinou ďalšou výnimkou je `prefers-reduced-motion`, ktoré
musí vypnúť animácie a prechody všade – z rovnakého dôvodu: nesmie ho nič prebiť.

Štýly sú rozdelené podľa kariet v `css/` a `index.html` ich načítava v pevnom poradí – to poradie je poradie
kaskády. Pred všetkými ide `pocasie.css` (vrstvy počasia v pozadí), potom `zaklad.css` (premenné, písmo, hlavička, sklá), `rozlozenie.css` posledný (navigácia, rozloženie
na šírku, `.hidden`, útlm pohybu). Nový súbor patrí medzi ne; štýl karty do súboru tej karty.

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
s dotykovým displejom sú bežné. Z toho istého dôvodu nie je v `css/` ani jedno pravidlo
`:hover` – na dotyku by ostávalo visieť po ťuknutí.

V CSS to isté hovorí `touch-action`. `none` znamená, že prehliadač nad prvkom nesmie nič, ani
posunúť stránku – patrí len úchytkám na ťahanie (kruh rozvrhu tarify v sprievodcovi). Plochy,
cez ktoré človek scrolluje popri ceste, majú `pan-y` (posuvník dňa `.mz-os` na karte Dnes, pás dňa
`.day-track` v detaile dňa karty 7 dní): zvislé posúvanie si necháva
prehliadač, vodorovné gesto JS. Kde `touch-action` nie je, rozhoduje prehliadač o oboch smeroch –
to je pre bežný obsah správne, dopisovať ho netreba.

Mapa a časová os karty Radar majú `touch-action: none`: karta zaberá celú obrazovku, stránka sa na nej neposúva.

**Karty sa ťahom prsta nelistujú**, len ťuknutím v navigácii. Ťah do strán má
dve miesta: dni v detaile dňa karty 7 dní (`web/day-pager.js`, rozhodnutia v `shared/day-pager.js`)
a pás kariet pod číslami na karte Dnes. Pás posúva prehliadač sám (CSS scroll-snap, `web/mozem-karty.js`
len zladí bodky a šípky), žiadny vlastný kód nad touch udalosťami; zvislý ťah cez neho posúva stránku a myš
ho posúva šípkami ‹ › po stranách bodiek (bodky sú len ukazovateľ - pri ôsmich kartách by sa ako tlačidlá na prst nezmestili). Ďalšie miesto pridávaj len s rovnakým rozmyslom
(návrh: `docs/navrhy/dnes-upravy.html`). Pri dňoch v detaile karty 7 dní platí:
Obsah dňa ide za prstom a vedľa neho stojí susedný deň, ktorý nakreslil ten istý render (appka ho na
chvíľu zavolá so susedným dňom a výsledok skopíruje) – iný kód na kreslenie dňa preto nepíš. Kópie
sú bez `id` (inak by boli v stránke dvakrát), takže štýly obsahu dňa stoja na triedach, nie na `id`. Posun
počas ťahu nie je v stave; do stavu ide až deň, na ktorom pás zastal. Na kraji sa pás len poddá,
z detailu von vedie šípka späť (prvý čip v riadku dní). Myš ťahať nemusí – čipy a šípky na klávesnici.
V prehľade so stĺpcami sa dni listujú ťahom v stĺpci 7 dní, pás je v ňom.
Návrh: `docs/navrhy/7dni-listovanie-dni.html`.

Kontrolujú to e2e testy v skupinách „ťah prstom a tlačidlo Späť“ a „posuvník dňa prstom“: ťuknutie bez jediného pohybu
prsta musí bežec presunúť a nechať ho tam, zvislý ťah cez posuvník čas nesmie zmeniť.

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
Kruhový import a import appky z `shared/` zhodí `test/cykly.test.js` – keď dva moduly potrebujú jeden druhého,
spoločné výpočty patria do tretieho (takto vzniklo `shared/mozem-jadro.js`).
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
