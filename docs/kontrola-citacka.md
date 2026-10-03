# Ručná kontrola novej appky s čítačkou obrazovky

Návod na vyskúšanie novej appky „Živá obloha“ tak, ako ju používa človek, ktorý nevidí na
displej. Telefón vtedy číta nahlas, čo je pod prstom, a appka sa ovláda gestami. Celé to
zaberie asi 20 minút na jednom telefóne.

Adresa appky: **https://rastislavsk.github.io/ray-mon/obloha/**

Najlepšie je otvoriť appku najprv bez čítačky, počkať, kým naskočí odpoveď, a čítačku zapnúť
až potom.

## iPhone: VoiceOver

**Zapnutie:** Nastavenia › Prístupnosť › VoiceOver › zapnúť. Rýchlejšie je povedať Siri „Zapni
VoiceOver“. Na rýchle zapínanie a vypínanie si v Nastavenia › Prístupnosť › Skratka
prístupnosti zvoľ VoiceOver – potom ho prepína trojité stlačenie bočného tlačidla.

**Gestá:**

- **ťuk jedným prstom** – prečíta, čo je pod prstom (nič nestlačí),
- **dvojťuk kdekoľvek** – stlačí to, čo bolo naposledy prečítané,
- **švih doprava / doľava** – ďalší / predchádzajúci prvok,
- **švih dvoma prstami nadol** – prečíta všetko od miesta, kde si,
- **otočenie dvoma prstami (ako kľúčom)** – „rotor“; zvoľ v ňom **Nadpisy**, potom švih nadol
  skáče po nadpisoch,
- **„Z“ dvoma prstami** (rýchle cik-cak) – späť, zavrie otvorené okno,
- **švih tromi prstami hore / dole** – posúva stránku.

## Android: TalkBack

**Zapnutie:** Nastavenia › Prístupnosť › TalkBack › zapnúť. Ak je zapnutá skratka, stačí
podržať obe tlačidlá hlasitosti na 3 sekundy (to isté ho aj vypne).

**Gestá:**

- **ťuk jedným prstom** – prečíta, čo je pod prstom,
- **dvojťuk kdekoľvek** – stlačí to, čo bolo naposledy prečítané,
- **švih doprava / doľava** – ďalší / predchádzajúci prvok,
- **švih hore alebo dole** – mení, po čom sa skáče; zvoľ **Nadpisy**, potom švih doprava
  skáče po nadpisoch,
- **švih doľava a hneď doprava** (alebo tlačidlo Späť) – späť, zavrie otvorené okno,
- **dvoma prstami hore / dole** – posúva stránku.

## Čo má čítačka povedať

Presné slová sa menia s časom a počasím, nižšie je príklad zo slnečného poludnia. Dôležité je,
či sa dá ku všetkému dostať, či to dáva zmysel a či nič nepovie dvakrát alebo vôbec.

**Spodná navigácia (na každej karte).** Švihom sa dá dostať na päť tlačidiel: Môžem?, Teraz,
7 dní, Štatistika, Nastavenie. Pri tom, na ktorom práve si, povie navyše „aktuálna stránka“
(alebo „vybraté“). Dvojťuk na iné tlačidlo prepne kartu.

**Môžem?** Nadpis karty je „Môžem?“ (na displeji ho nevidno, čítačka áno). Potom prečíta
štítky „Áno“ a „Lacná sieť“, veľké slovo „ZAPNI TOOO“ a vetu „Slnko to teraz platí za nás…“,
potom „Strecha za hodinu nabije … mobilov“. Nasleduje nadpis „Čo môžem · 6 zo 6 ide hneď“ a
šesť tlačidiel, napríklad „Práčka, do 15:30“. Dvojťuk na Práčku otvorí panel – čítačka ohlási
okno „Práčka: do 15:30“ a dá sa v ňom čítať „Čo robiť“ a „Prečo“; gesto Späť ho zavrie a
čítačka sa vráti na riadok Práčka. Oblúk slnka hore čítačka vynechá, to je len obrázok.

**Teraz.** Nadpis „Teraz“, veľké číslo v kW a odkiaľ je (meranie alebo odhad). Potom „Graf
dňa, šípkami si pozrieš iný čas“ – posúvač: švih hore alebo dole na ňom by mal posunúť čas
o štvrťhodinu a čítačka povedať nový čas a výkon (ak sa nič nestane, zapíš to – posúvače
vlastnej výroby sú na telefóne s čítačkou najčastejší problém). Pod grafom je pás „Odporúčania,
posúvaj do strán“ so štyrmi kartičkami (Teraz, Spotrebiče, Dnešok, Kedy lepšie) – švihom
doprava sa prejde cez všetky.

**7 dní.** Nadpis „7 dní“, otázka s najlepším dňom (napr. „Veľké pranie? Štvrtok.“) a
tlačidlo so súčtom týždňa. Potom sedem tlačidiel dní, každé povie celý riadok, napríklad
„Dnes, jasno, 61 kWh, okno 09:00 až 17:30“. Dvojťuk na deň otvorí detail: prvé je tlačidlo
„Späť na 7 dní“, potom nadpis dňa, tri čísla a graf, ktorý povie celý priebeh dňa slovami.
Tlačidlo so súčtom otvorí detail týždňa s dvoma grafmi, oba majú popis slovami.

**Štatistika.** Nadpis „Štatistika“, štyri tlačidlá obdobia (Dnes, Mesiac, Rok, Spolu) –
zvolené povie „vybraté“ alebo „stlačené“. Potom veľké číslo v kWh, porovnanie s počtom
nabití mobilu a kilometrami autom, riadky s číslami a najlepší deň. Úplne dole tlačidlá plagátu; dvojťuk
otvorí okno s plagátom a tlačidlami Zdieľať a Zavrieť.

**Nastavenie.** Nadpis „Nastavenie“, potom „Moja strecha“ a pod nadpisom „Elektráreň“ riadky
(poloha, panely, menič, meranie, tarifa) – každý je tlačidlo, ktoré otvorí krok sprievodcu.
Pod nadpisom „Vzhľad“ je prepínač „Živá obloha“ (povie zapnuté / vypnuté) a dvojice tlačidiel
Tón hlášok a Úvodná karta. Pod „Appka“ sú „Zdieľať appku“ a „Nastaviť celé znova“ – obe
otvoria okno, ktoré čítačka ohlási, a gesto Späť ho zavrie.

**Zmena odpovede.** Ak necháš appku otvorenú na Môžem? vo chvíli, keď sa odpoveď mení (napr.
podvečer zo „ZAPNI TOOO“ na „Dnes už nie“), čítačka to raz sama povie. Každú minútu nič
hovoriť nemá – ani keď sa zmení len čas v hlavičke.

## Čo zapísať

Pri každom probléme stačí jedna veta: na ktorej karte, čo si urobil, čo čítačka povedala a čo
si čakal. Napríklad: „7 dní, dvojťuk na Zajtra – detail sa otvoril, ale čítačka nepovedala
nič a ostala na zozname.“ Aj „toto mi bolo nejasné“ je dobrý nález.

## Rýchlosť na vlastnom telefóne

Google meria rýchlosť stránky na stránke **https://pagespeed.web.dev/**. Vlož do nej adresu
`https://rastislavsk.github.io/ray-mon/obloha/` a stlač Analyzovať. Po chvíli ukáže dve
záložky – Mobil a Počítač; dôležitá je Mobil. Hore je číslo Výkon (0 až 100) a pod ním
„Largest Contentful Paint“ (za koľko sekúnd je hlavný obsah na displeji, dobré je pod 2,5 s)
a „Cumulative Layout Shift“ (koľko obsah poskakuje pri načítaní, dobré je pod 0,1). Časť
„Zistite, čo zažívajú vaši skutoční používatelia“ bude pri testovacej verzii prázdna – na to
treba viac návštev. Výsledok sa pri každom meraní trochu líši; ak niečo vyzerá zle, zmeraj
dvakrát.
