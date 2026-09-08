# rondo v0.3 — platforma: lobby, konta, admin, blackjack

Z "jednego stołu ruletki" robimy mini-kasyno: konta z rolami, lobby z
kategoriami i kafelkami stołów, backoffice admina, druga gra (blackjack).

## Decyzje architektoniczne

- **Konta zamiast gości**: `users` (nickname unikalny, scrypt hash hasła,
  rola `player|admin`, balance). Token = bearer w localStorage (bez JWT —
  jeden serwer, jedna tabela; YAGNI).
- **Stoły w DB**: `tables` (name, game, minStake, maxStake, isOpen).
  Pierwszy zarejestrowany user zostaje adminem (bootstrap bez seeda);
  admin tworzy/edytuje/zamyka stoły i ustawia **default bankroll** w
  `app_settings` (używany przy rejestracji i resecie salda).
- **Engine per stół**: `TableManager` trzyma mapę tableId → instancja
  silnika (RouletteEngine | BlackjackEngine — zwykłe klasy, nie
  singletony DI). WS: `/ws?token=..&table=..`; broadcast/chat/presence
  scoping per stół.
- **Protokół**: wspólne eventy (chat, presence, error) + przestrzeń gry.
  Ruletka bez zmian; blackjack dostaje własne: `bj_snapshot`, `bj_phase`,
  `bj_deal`, `bj_card`, `bj_turn`, `bj_settled` i komendy `bj_bet`,
  `bj_clear`, `bj_hit`, `bj_stand`, `bj_double`. Karty rysowane
  programowo (rank+suit), zero assetów.

## Blackjack — zasady (spisane, żeby FE/BE się zgadzały)

- Shoe 6 talii, tasowanie crypto; reshuffle poniżej 60 kart.
- Fazy: `betting` (15s) → `dealing` → `acting` (kolejka miejsc, 12s na
  decyzję, timeout = stand) → `dealer` (dobiera do 17, **stoi na każdym
  17** — S17) → `result` (5s) → betting. Brak betów = od razu nowe betting.
- Max 5 miejsc/rundę (bet = zajęcie miejsca). Akcje: hit / stand / double
  (tylko na 2 kartach, dokłada drugi escrow, jedna karta).
- Wypłaty: blackjack 3:2, wygrana 1:1, push zwrot, przegrana 0.
  Rozliczenia i eval ręki (miękkie asy) w `packages/protocol` z testami.

## Klient

- **Routing hashowy** (bez react-routera): `#/` lobby, `#/table/<id>`,
  `#/admin`. Ekran logowania/rejestracji przed wszystkim.
- **Lobby**: lewy sidebar kategorii (All / Roulette / Blackjack [+ Admin
  dla roli admin]), grid kafelków: art gry rysowany CSS-em
  (conic-gradient koło / wachlarz kart), nazwa, widełki stawek, liczba
  graczy online, status. Klik = wejście do stołu.
- **Nazwa stołu w lewym górnym rogu** widoku gry + widełki stawek.
- **Profil**: saldo + „reset balance" (na default admina) + logout.
- **Admin `#/admin`**: lista stołów (create/edit/close) + default bankroll.
- **Blackjack UI**: łuk stołu, dealer u góry (hole card zakryta →
  flip), miejsca graczy łukiem na dole, karty wlatują z shoe z easingiem,
  DOM-owe przyciski HIT/STAND/DOUBLE z countdownem tury.
- **Fix żetonów**: żeton na polu przyjmuje kolor nominału jak w docku
  (tier koloru wg sumy na polu: 1 szary / 5 czerwony / 10 niebieski /
  25 zielony / 100 grafitowy), ghosty innych graczy zostają białe.

## Etapy (commity)

1. Doc (ten plik).
2. Server: schema v2 + auth (scrypt) + tables/settings + admin API +
   TableManager (ruletka per stół, limity min/max z konfigu stołu).
3. Protocol+server: blackjack engine z testami reguł.
4. Client: auth + router + lobby + admin + profil/reset.
5. Client: widok blackjacka.
6. Chip-tier colors, table name w HUD, README, sweep.
