# Findog-Qualitätskontrolle

## Zweck und Prüfkorn

Prüfkorn ist eine gültige, authentifizierte Fred-Anfrage aus dem Web oder aus
Telegram. Ungültige HTTP-Aufrufe, fremde Telegram-Nachrichten, Bot-Befehle und
nicht unterstützte Medien gelten nicht als Rechtsanfragen.

`fred_request_ledger` ist der unabhängige Eingangsbeleg. Der Beleg wird vor
Upstream-Aufrufen und vor der Antwortgenerierung geschrieben. Kann der Beleg
nicht sicher gespeichert werden, wird die Anfrage nicht an Fred weitergegeben.

Jeder Beleg besitzt:

- eine eindeutige `request_id`;
- getrennte, eindeutige Event-IDs für User und Assistant;
- Quelle, Agent, Eingangszeit und Originalanfrage;
- den Status `received`, `user_persisted`, `generating`, `completed`, `failed`
  oder `cancelled`;
- exakte Verknüpfungen auf die gespeicherten User- und Assistant-Nachrichten;
- einen optionalen, unveränderlichen Qualitätsbatch.

## Harte Vollständigkeitsregeln

Für jeden nicht gelöschten Beleg gelten folgende Prüfungen:

1. `user_persisted`, `generating` und `completed` benötigen genau eine
   User-Nachricht mit derselben `user_event_id`.
2. `completed` benötigt genau eine Assistant-Nachricht mit derselben
   `assistant_event_id`.
3. `failed` und `cancelled` benötigen einen terminalen Zeitpunkt und einen
   begrenzten Fehler-/Phasencode.
4. Nichtterminale Belege, die länger als 15 Minuten unverändert bleiben, sind
   ein kritischer Vollständigkeitsfehler.
5. Webanfragen mit gespeicherter User-Nachricht benötigen genau einen
   `admin_request_history`-Eintrag mit derselben `request_id`.
6. Telegram-Belege werden zusätzlich gegen `telegram_updates` und sämtliche
   `telegram_deliveries` abgeglichen.

## Täglicher Ablauf

Die geplante Work-Aufgabe ruft zuerst atomar auf:

```sql
select public.prepare_fred_quality_review_batch(now(), 'Europe/Vienna');
```

Ein nach der Anlage unterbrochener, noch nicht bewerteter Batch wird idempotent
wiederverwendet. Ein bereits bewerteter Batch, der nur noch auf die
Löschbestätigung wartet, blockiert den nächsten Tagesbatch nicht. Neue Anfragen
nach dem Cutoff gelangen erst in den nächsten Batch. Jeder Batch enthält eine
Anzahl und einen SHA-256-Hash der sortierten Request-IDs.

Die zu bewertenden Zeilen werden ausschließlich über die stabile Prüffunktion
gelesen:

```sql
select *
from public.get_fred_quality_review_batch('<batch-id>'::uuid);
```

Die fachliche Prüfung verwendet zwingend den Skill `fred-steuerrecht`, beachtet
den Stichtag und trennt Norm, Rechtssatz und Entscheidungsdokument. Primärquelle
bleibt RIS/EVI.

Erst nachdem sämtliche Zeilen bewertet und Vollständigkeitsfehler berichtet
wurden, wird derselbe Hash als Abschluss der Prüfphase übergeben:

```sql
select public.mark_fred_quality_review_batch_reviewed(
  '<batch-id>'::uuid,
  '<candidate-set-sha256>'
);
```

Damit wechselt der Batch von `awaiting_review` zu `pending_confirmation`.
Mehrere bereits geprüfte, noch nicht zur Löschung bestätigte Tagesbatches
können parallel bestehen.

## Bestätigte Löschung

Vor der Löschung nennt die Work-Aufgabe Batch-ID, Anzahl und Kandidatenhash und
fragt ausdrücklich nach Bestätigung. Ohne Bestätigung erfolgt keine Löschung.

Nach Bestätigung wird nur diese Kombination ausgeführt:

```sql
select public.delete_confirmed_fred_quality_batch(
  '<batch-id>'::uuid,
  '<candidate-set-sha256>'
);
```

Die Funktion sperrt den Batch und bricht vollständig ab, wenn:

- Batch oder Hash nicht exakt übereinstimmen;
- die Kandidatenanzahl abweicht;
- ein Request noch nicht terminal ist;
- ein Teil der Transaktion fehlschlägt.

In einer Transaktion werden User-/Assistant-Nachrichten, Webhook-Rohdaten,
Admin-Audit-Inhalte, öffentliche Antwortkopien und Bildartefakte gelöscht sowie
Telegram-Auslieferungsinhalte geleert. Leere Unterhaltungen werden entfernt;
bei verbleibenden Nachrichten werden Titel und Zeitstempel neu aufgebaut.

Der Ledger behält danach nur inhaltslose Metadaten, Batchzuordnung,
Ergebnisstatus, Löschzeitpunkt und Löschgrund. Anfrage und Inhalts-Hash werden
gelöscht.

## Migration und Altbestand

Beim Rollout werden nur bereits gespeicherte Anfragen des aktuellen Wiener
Kalendertags nachgezogen. Ältere Verläufe liegen vor Beginn der
Vollständigkeitsgarantie und werden nicht ungefragt in den ersten Tagesbatch
aufgenommen. Bereits verwaiste Audit-Einträge des Rollout-Tags werden als
`legacy_orphan_audit` sichtbar gemacht und nicht als erfolgreiche Antwort
interpretiert.

## Provider-Grenze

Die lokale Löschtransaktion umfasst Supabase und die Telegram-Auslieferung.
WeKnora besitzt zusätzlich eigene Sitzungsnachrichten. Die offizielle WeKnora-
API unterstützt das Leeren einer vollständigen Sitzung, aber die derzeitige
Embed-Schnittstelle liefert Findog keine sicher löschbaren Einzelmessage-IDs.
Ein vollständiges Provider-Purge darf daher nur erfolgen, wenn die gesamte
Sitzung zum bestätigten Batch gehört; andernfalls muss die Löschung blockieren
statt ungeprüfte Nachrichten mitzulöschen.
