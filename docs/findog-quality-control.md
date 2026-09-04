# Fred-Anfrageprotokoll nach Entfernung der täglichen Qualitätskontrolle

Die tägliche Codex-Qualitätsprüfung ist eingestellt. Fred speichert keine
zusätzlichen Anfrage- oder Antworttexte für diesen Prüfprozess. Der sichtbare
Chatverlauf bleibt die Quelle für Nutzernachrichten und Antworten.

## Betriebsprotokoll und Provenienz

`fred_request_ledger` bleibt als unabhängiger Eingangsbeleg erhalten. Er wird
vor Upstream-Aufrufen geschrieben und enthält Request-ID, eindeutige User- und
Assistant-Event-IDs, Quelle, Agent, Zeitpunkte, Status, Fehlercodes sowie exakte
Verweise auf die gespeicherten Nachrichten. Conversation und Web-/Pro-Modus
bleiben unveränderlicher Wiederaufnahme-Kontext.

`request_content` ist immer NULL. `request_content_sha256` enthält bei neuen
Anfragen den SHA-256 des getrimmten Originaltexts, damit dieselbe Request-ID
nicht mit anderem Inhalt wiederverwendet werden kann. Bereits früher durch
QA-Bereinigung entfernte Hashes werden nicht künstlich rekonstruiert.

`user_persisted`, `generating` und `completed` benötigen die passende
User-Nachricht; `completed` benötigt zusätzlich die passende Assistant-Nachricht.
`failed` und `cancelled` sind terminal und besitzen einen Abschlusszeitpunkt.
Ein fehlgeschlagener Eingangsbeleg verhindert weiterhin einen Upstream-Aufruf.

## Telegram-Wiederaufnahme und Zustellung

Deterministische Request-/Event-IDs verhindern neue Requests bei Queue-Retries.
Der Worker setzt eine bereits gespeicherte Frage in derselben Conversation fort
oder stellt eine vorhandene Antwort idempotent zu. Die Antwort wird aus
`fred_messages` gelesen. Modi stammen aus dem beim Eingang eingefrorenen Beleg.

Jeder Queue-Übergang und jeder Auslieferungs-Chunk bleibt an die aktuelle Lease
gebunden. Lease-Verlust, `/stop` und unklare externe Zustellung dürfen keine
zweite Antwortgenerierung oder blinde Wiederzustellung auslösen.

Aktive Telegram-Zustellungen dürfen ihren betrieblich benötigten Text behalten.
Beim Übergang der Queue nach `completed`, `failed` oder `cancelled` leert der
bestehende Trigger die Zustellungstexte. Die einmalige QA-Bereinigung erfasst
nur Resttexte bereits terminaler Queue-Einträge.

## Adminansicht

Die Benutzerverwaltung liest Nutzernachrichten direkt aus `fred_messages`,
gefiltert nach `client_id` und `role = 'user'`, sortiert nach Erstellungszeit und
Nachrichten-ID absteigend. Sie enthält damit vorhandene Web- und Telegram-Fragen.
Es gibt keinen separaten Textbestand und keinen separaten Löschknopf mehr.

Das bestehende GET-Antwortformat bleibt erhalten; Eintrags-IDs sind jetzt
Nachrichten-IDs. Der frühere DELETE-Endpunkt für Anfragekopien prüft weiterhin
die Adminberechtigung und antwortet mit HTTP 410 ohne Datenänderung.
`admin_request_history` behält nur historische Metadaten; `content` ist NULL.

## Migration und QA-Altbestand

Die kompatible Migration stellt die Ledger-Constraints und Laufzeitfunktionen
um. Alle vier bisherigen QA-Batch-RPCs brechen mit SQLSTATE `55000` und
`Fred quality review has been retired` ab. Offene Batches werden als `cancelled`
markiert; Kandidaten-Hashes und tatsächliche Review-Zeitpunkte bleiben erhalten.

Danach wird die Anwendung ohne Admin-Kopierpfad veröffentlicht. Nach dem Wechsel
und Auslaufen alter Prozesse bereinigt die zweite Migration Ledger- und
Admin-Texte sowie terminale Telegram-Resttexte. Ledger-Hashes bleiben erhalten.
Zeitpunkt und Mengen werden einmalig ohne Inhaltskopien in
`fred_quality_retirement_audit` protokolliert. Wiederholung ist idempotent.
Trigger und CHECK-Constraints verhindern neue QA-Inhaltskopien, auch wenn ein
alter Anwendungsschreiber noch einmal eine Inhaltskopie übergibt.

`quality_retired` und der historische Grund `quality_batch` beschreiben
QA-Bereinigung. Sie sperren keine Wiederaufnahme. Nur
`user_conversation_delete` kennzeichnet eine tatsächliche Nutzerlöschung.

## Nutzerlöschung und Provider-Grenze

Die QA-Entfernung ändert keine Nutzernachrichten, Anhänge, Bildartefakte oder
Provider-Sitzungen. Unterhaltung und Konto können weiterhin vom User gelöscht
werden. Diese Löschung entfernt auch Ledger-Hashes und überschreibt einen
früheren QA-Grund mit `user_conversation_delete`.

Die gemeinsame Lock-Reihenfolge bleibt Account, Provider-Session, Conversation
und abhängige Arbeitszeilen. Tombstones behalten nur einen inhaltsfreien
Session-Hash. Späte Webhook-/Bridge-Aufrufe können gelöschte Verläufe nicht
wiederherstellen. Die Account-Löschung verwendet dieselbe Tombstone-Funktion.

## Prüfung

`supabase/tests/fred_quality_retirement.sql` läuft ausschließlich gegen eine
wegwerfbare PostgreSQL-Datenbank mit den bisherigen Projektmigrationen. Es prüft
beide neuen Migrationen, doppelte Bereinigung, unveränderte User-Nachrichten,
aktive Zustellungen, Wiederaufnahme, Inhalts-Hash-Konflikte, stillgelegte RPCs,
Nutzerlöschung und verspätete Webhooks. Ergänzend laufen die Web-/Admin-/Worker-
Tests, beide Typechecks und beide Builds.
