# Skat — plan (trzecia gra platformy rondo)

Cel: pełnoprawny skat wg Międzynarodowych Przepisów (ISkO / PZSkat, kongres 1998),
grywalny solo od razu — puste miejsca przy stole zajmują boty. Zero assetów,
karty rysowane programowo jak w blackjacku.

## Zasady zaimplementowane (źródła: pagat.com, de/en Wikipedia, pzskat.pl)

- 32 karty (A 10 K Q J 9 8 7), oczka: A=11, 10=10, K=4, Q=3, J=2; razem 120.
- Rozdanie 3–skat(2)–4–3; pozycje: przodek/Vorhand (po lewej od geber),
  środek/Mittelhand, zadek/Hinterhand. Geber rotuje co rozdanie.
- **Licytacja**: M mówi do V (wartości 18,20,22,23,24,27,30,33,35,36,40,44,45,
  46,48,50,54,55,59,60,63,66,70,72,…), słuchający „ja" lub pas; potem H
  licytuje ocalałego. Starszy trzyma równą wartością. Gdy M i H pasują bez
  licytacji — V może wziąć 18 albo pas ⇒ **eingepasst** (wiersz „—" na liście,
  bez Ramscha, zgodnie z ISkO).
- **Gry**: kolor (♦9 ♥10 ♠11 ♣12), grand (24; atuty tylko walety), null
  (23 / hand 35 / ouvert 46 / ouvert hand 59; kolejność 7 8 9 10 J Q K A).
- **Spitzen** (mit/ohne): sekwencja od J♣ w dół; walety + atuty; **karty skata
  liczą się do sekwencji** (także przy grze z ręki).
- Wartość gry = podstawa × (spitzen + 1 spiel + hand + schneider + schneider
  zapowiedziany + schwarz + schwarz zapowiedziany + ouvert). Zapowiedzi tylko
  przy grze z ręki; ouvert kolor/grand = zapowiedziany schwarz; null ouvert
  także bez ręki.
- **Wygrana**: ≥61 oczek (skat liczy się soliście — również odłożony);
  schneider ≥90, schwarz = wszystkie lewy; null = zero lew (koniec gry przy
  pierwszej wziętej). Schneider/schwarz liczą też PRZECIW soliście (≤30 / 0 lew).
- **Przelicytowanie**: wartość końcowa < licytacji ⇒ przegrana; podstawa
  podnoszona do najmniejszej wielokrotności ≥ licytacja. Null z licytacją >
  wartości jest blokowany już przy zapowiedzi (deterministyczna przegrana).
- **Punktacja turniejowa (Seeger-Fabian, stół 3-os.)**: wygrana = wartość+50;
  przegrana = −(2×wartość+50); po przegranej solisty każdy z obrońców +40
  (doliczane w stopce listy, jak na prawdziwych listach). Seria = **36 gier**
  (standard DSkV dla stołu 3-osobowego).
- Lista wzorowana na Spielliste DSkV: kolumna skumulowanych punktów na wierszu
  gry solisty + kreski gew./verl., stopka: liczby wygranych/przegranych,
  40×przegrane pozostałych, wynik końcowy.

## Architektura

- `packages/protocol/src/skat.ts` — czyste reguły + testy: talia, porządki
  kart per typ gry, legalPlays/trickWinner, spitzen, wartość gry, licytacyjne
  wartości, rozliczenie (won/overbid/Seeger) — współdzielone klient+serwer
  (klient sam liczy legalne karty i podgląd wartości).
- `events.ts` — jeden spersonalizowany snapshot `skat_state` po każdej zmianie
  (odporne na reconnect; klient animuje różnice), komendy: `skat_bid`
  (bid/hold/pass), `skat_skat` (take/hand), `skat_discard`, `skat_declare`,
  `skat_play`, `skat_next`.
- `apps/server/src/engine/skatEngine.ts` — maszyna faz: waiting → dealing →
  bidding → skatDecision → discarding → declaring → playing (10 lew) →
  settled → …36× → seriesEnd. Pierwszy człowiek siada, boty dopełniają skład;
  rozłączony człowiek przechodzi na autopilota (bot dogrywa), wraca po
  reconnect. Kolejni ludzie = widzowie (czat + pełny widok publiczny).
- `skatBot.ts` — heurystyki: ocena ręki → max licytacja per wariant gry;
  zawsze bierze skata; odkłada blotki/dziesiątki z krótkich bocznych; solista
  ściąga atuty i gra asy; obrońcy smarują partnera i biją tanio; null: solista
  schodzi pod lewę. Boty grają fair — widzą tylko swoją rękę + karty zagrane.
- Klient: `pixi/SkatStage.tsx` (wachlarz 10–12 kart na dole, rewersy
  przeciwników po bokach, karty LECĄ na środek od strony gracza który rzucił
  i lądują przesunięte w jego kierunku; zebranie lewy do zwycięzcy; skat na
  środku), DOM: panel licytacji (dymki przy graczach), panel deklaracji,
  overlay wyniku z rozbiciem wartości, szuflada z listą punktów.

## Świadome cięcia (ponytail)

- Ramsch/Kontra/Re/Bock — poza ISkO, pomijam.
- Licytacja tylko „następna wartość" (skoki są rzadkie; do dodania jednym
  selectem).
- Stół 4-osobowy (geber pauzuje) — później; stół jest 3-osobowy.
- Lista serii w pamięci silnika (restart serwera = nowa lista).
- Boty klubowe, nie mistrzowskie — heurystyki bez symulacji Monte Carlo.
