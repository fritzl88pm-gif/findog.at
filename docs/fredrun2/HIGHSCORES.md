# Fredrun 2.0 – Globale Bestenlisten

Alle Highscores sind **weltweit** („jeder gegen jeden“): Wer in Findog angemeldet ist, tritt in jedem Board gegen alle anderen an.
Je Board zählt pro Spieler der **beste Lauf** (Gleichstand: früher erreicht gewinnt). Gesperrte Fredrun-Spieler erscheinen nicht.

| Board | Schlüssel | Inhalt |
|-------|-----------|--------|
| Welt-Lauf | `world:<welt>` | Endlos in einer der acht Welten |
| Weltreise | `tour` | alle Welten hintereinander |
| Tageslauf | `daily:<JJJJ-MM-TT>` | jeden Tag derselbe Kurs für alle |

```
supabase/migrations/20260930120000_fredrun2_global_scores.sql   Tabelle fredrun2_scores + Funktionen submit_fredrun2_score / get_fredrun2_leaderboard
src/app/api/fredrun2/highscores/route.ts                        GET ?board=…  (Liste + eigener Platz) · POST (Lauf einreichen)
src/lib/fredrun2-highscores.ts                                  Board-/Namens-/Antwort-Validierung (Server und Client)
src/components/fredrun2/globalBoard.ts                          Client: useGlobalBoard, useRunSubmission, useAccessToken
```

* **Anmeldung**: Die API verlangt eine Findog-Sitzung (Bearer-Token). In der App bekommt `FredRun2` das Token als Prop; auf der eigenständigen Seite
  `/fredrun2` wird die Supabase-Sitzung des Browsers genutzt. Ohne Anmeldung zeigt das Spiel nur die lokale Liste dieses Geräts.
* **Einreichung**: Nach jedem Lauf mit Score > 0 sendet der Client `{board, runId, name, score, meters, character}`. Die `runId` (UUID) macht
  Wiederholungen idempotent; ein Fehlversuch wird einmal wiederholt. Rate-Limit: 30 Einreichungen je 5 Minuten und Spieler.
* **Name**: gemeinsam mit dem Original-Fredrun (`fredrun_player_profiles`), höchstens 16 Zeichen. Ohne Namen bleibt der vorhandene erhalten.
* **Sicherheit**: Nur `service_role` darf die Tabelle und die Funktionen nutzen (RLS an, alle Rechte für `anon`/`authenticated` entzogen). Scores stammen –
  wie beim Original – vom Client; Plausibilitätsgrenzen: Score ≤ 100 Mio., Meter ≤ 10 Mio.; Tages-Boards nur für heute ± 1 Tag.

## Zurücksetzen

* **Global**: Die Migration legt eine neue, leere Tabelle an – alle weltweiten Highscores beginnen bei null. Die Tabellen des Original-Fredrun bleiben unverändert.
* **Lokal**: `Profile.scoreEpoch` (`SCORE_EPOCH` in `profile.ts`) – Profile ohne die aktuelle Generation verlieren beim Laden ihre alten lokalen `best`-/`top`-Listen;
  Münzen, Helden, Einstellungen und Lebenszeit-Statistik bleiben. Für einen weiteren Reset genügt es, `SCORE_EPOCH` zu erhöhen (und die Tabelle zu leeren:
  `truncate public.fredrun2_scores;`).

## Einspielen

Die Migration muss wie jede andere über die Supabase-Migrationen ausgeliefert werden (`supabase db push` bzw. die übliche Pipeline), **vor** der neuen
Anwendungsversion. Ohne Migration antwortet die API mit 503 („Bestenliste nicht erreichbar“); das Spiel selbst läuft weiter.
