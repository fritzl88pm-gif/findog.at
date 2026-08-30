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
- den beim Eingang geltenden Conversation-Bezug sowie Web-/Pro-Modus als
  unveränderlichen Wiederaufnahme-Kontext;
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

## Telegram-Wiederaufnahme

Telegram verwendet für jeden Update-Datensatz deterministische Request- und
Event-IDs. Ein Queue-Retry eröffnet daher keinen neuen Request: Der Worker
gleicht den Beleg zuerst mit den exakt zugehörigen User-/Assistant-Events ab.
Ein bereits gespeicherter User-Turn wird in derselben Conversation fortgesetzt;
eine bereits gespeicherte Assistant-Antwort wird nur noch idempotent zugestellt.
Conversation sowie Web-/Pro-Modus stammen dabei ausschließlich aus dem beim
Ingress eingefrorenen Beleg und nicht aus später geänderten Chat-Einstellungen.
Transient gescheiterte Versuche bleiben bis zur letzten Queue-Chance
nichtterminal. Terminale Belege werden nie wieder geöffnet.

Alle lease-gebundenen Queue-Übergänge akzeptieren nur ihren jeweils exakt
definierten Erfolgsausgang; `false`, `lease_lost` oder ein unbekannter Ausgang
bedeutet Lease-Verlust. Danach darf der alte Worker keinen zweiten
Statusübergang versuchen. Auch Beleg-Anlage und terminale Beleg-Abgleiche sind
an `telegram_updates.id` plus aktuelle Lease gebunden. `/stop`, Retry und der
Claim eines Auslieferungs-Chunks entscheiden unter demselben Queue-Zeilenlock,
damit weder ein storniertes Update erneut claimbar bleibt noch nach zugesagter
Stornierung ein neuer Send beginnt. Jeder Telegram-Auslieferungs-Chunk wird vor
dem externen Send an genau diesen Lease gebunden. Ein von einem anderen Lease
übernommener `pending`-Chunk sowie jeder `pending`-Chunk einer terminalen Queue
gilt als `uncertain` und wird nicht blind erneut gesendet.

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

## Bestätigte QA-Bereinigung

Vor der QA-Bereinigung nennt die Work-Aufgabe Batch-ID, Anzahl und
Kandidatenhash und fragt ausdrücklich nach Bestätigung. Ohne Bestätigung
erfolgt keine Bereinigung.

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

In einer Transaktion werden ausschließlich die temporären QA-Inhalte entfernt:
die inhaltliche Ledger-Kopie und der Admin-Audit-Inhalt werden gelöscht,
Telegram-Auslieferungskopien werden geleert. User-/Assistant-Nachrichten,
Unterhaltungen, Anhänge, Bildartefakte und die Provider-Sitzung bleiben
unverändert erhalten. Sie werden nur durch eine eigene Löschung des Users
entfernt.

Der Ledger behält danach nur inhaltslose Metadaten, Batchzuordnung,
Ergebnisstatus, Bereinigungszeitpunkt und Bereinigungsgrund. Die QA-Kopie der
Anfrage und ihr Inhalts-Hash werden gelöscht.

## Migration und Altbestand

Beim Rollout werden nur bereits gespeicherte Anfragen des aktuellen Wiener
Kalendertags nachgezogen. Ältere Verläufe liegen vor Beginn der
Vollständigkeitsgarantie und werden nicht ungefragt in den ersten Tagesbatch
aufgenommen. Bereits verwaiste Audit-Einträge des Rollout-Tags werden als
`legacy_orphan_audit` sichtbar gemacht und nicht als erfolgreiche Antwort
interpretiert.

## Provider-Grenze

Die tägliche QA-Bereinigung löscht keine WeKnora-Sitzungsnachrichten, weil sie
zum vom User aufbewahrten Verlauf gehören. Ein Provider-Purge ist ausschließlich
Teil einer ausdrücklich vom User ausgelösten Unterhaltungs- oder Kontolöschung.

Eine Unterhaltungs-Löschung und die Event-Persistenz verwenden dieselbe globale
Reihenfolge: Account-Zeile, Provider-Session, Conversation und abhängige
Arbeitszeilen. Die Löschung schreibt anschließend einen dauerhaften,
inhaltsfreien SHA-256-Tombstone, storniert aktive Requests und Generationen,
redigiert Telegram-/Ledger-Kopien und löscht erst danach die Conversation.
Verspätete Webhooks für diese Session werden unter demselben Lock verworfen,
ohne `content` oder `raw_event` zu speichern. Der Tombstone enthält weder
Channel-/Session-ID noch Titel oder Nachrichteninhalt.
Dieselbe Tombstone- und Bereinigungsfunktion läuft vor einer Löschung des
zugehörigen `auth.users`-Datensatzes, damit der Account-Cascade die Sperre nicht
umgehen kann.
