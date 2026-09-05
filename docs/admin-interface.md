# Administrationsoberfläche

Die Administration startet mit einer Übersicht ohne eigene Datenabfragen.
Die sieben Bereiche sind unter Benutzer & Feedback, Inhalte und System gruppiert.
Ab 1000 px verfügbarer Administrationsbreite erscheint eine interne Seitenleiste;
bei weniger Platz steht darüber eine aufklappbare Bereichsauswahl. Die globale
Findog-Navigation bleibt erreichbar. Bereichswechsel fokussieren die Überschrift.

## Arbeitsabläufe

- **Benutzer:** E-Mail-Suche, Kontoauswahl, Profil und bestehender Anfrageverlauf.
  Neue Konten werden in einem Dialog angelegt. Das eigene Administratorkonto
  kann weiterhin nicht über die Benutzerverwaltung gelöscht werden.
- **Rückmeldungen:** ausschließlich negative Fred-Rückmeldungen, mit Suche und
  Benutzerfilter. Eine Auswahlliste öffnet den vollständigen Kontext daneben
  beziehungsweise darunter.
- **Downloads:** Kategorien und Dateiliste, Suche nach Titel oder Dateiname,
  Metadatenbearbeitung und separater Uploaddialog.
- **Startseiten-News:** gefilterte Meldungsliste und Editor mit Entwurf,
  Veröffentlichung und Archivierung. RIS/EVI-Quelle, Dokumenttyp,
  Dokumentdatum und rechtlicher Stichtag bleiben erhalten.
- **BFG Newsletter:** datierte Ausgaben mit Editor und vorhandener Soft-Löschung.
- **Dokumentverarbeitung:** getrennte Abschnitte für Fred-Anhänge, OCR und
  Belegauswertung. Der Beleg-Prompt ist standardmäßig eingeklappt.
- **Nutzung & Systemstatus:** vorhandene OmniRoute-Zeiträume, Metriken,
  Kostenschätzungen, Routen und Providerzustände in einem einheitlichen Layout.

Benutzer und Dokumenteinstellungen laden erst beim Öffnen ihres Bereichs.
Lesevorgänge werden bei Bereichswechsel abgebrochen; verspätete Antworten
ändern den neuen Bereich nicht. Fehlgeschlagene Einstellungen können erneut
angefordert werden und sind bis zum erfolgreichen Laden nicht bearbeitbar.

Ein gemeinsamer Guard schützt ungespeicherte Formulare beim Wechsel von
Bereichen, Datensätzen und beim Schließen von Dialogen. Browser-Neuladen und
Tab-Schließen verwenden die native Warnung des Browsers. Laufende Schreibvorgänge
sperren weitere Schreibaktionen und Bereichswechsel. Speicherfehler erhalten
die Eingaben. Native Dialoge unterstützen Escape und geben den Fokus nach dem
Schließen zurück. Bestehende Löschbestätigungen bleiben bestehen.

Es gibt keine API-, Rechte- oder Schemaänderung und keine Migration. Der
Anfrageverlauf stammt weiterhin aus vorhandenen Nachrichten; Audit und
Provenienz werden unverändert über die bestehenden Endpunkte geführt.

## Lokale Prüfung, 5. September 2026

- TypeScript und Produktionsbuild erfolgreich; ESLint ohne Fehler
  (vier bestehende Warnungen außerhalb der Änderung).
- Sieben neue Interaktionstests in `src/components/admin-workspace.test.ts`:
  Bereichsauswahl und Fokus, Entwurfsschutz, Schreibsperren, Dialogschluss,
  Fehlererhalt, Feedbackauswahl und Quellenerhalt beim Speichern.
  Alle Requests laufen gegen isolierte Testantworten; keine Produktivschreibzugriffe.
- Gesamtlauf: 2131 Tests bestanden, sechs bestehende Fehler außerhalb des
  Adminumbaus: zwei CRLF-abhängige Fred-UI-Prüfungen, drei Prüfungen fehlender
  externer Fredrun-Bilder und eine veraltete Erwartung zur Position des
  Rentenrechners im bereits zuvor gruppierten Hauptmenü.
- Offen: visuelle Prüfung bei 390, 768, 1280 und 1920 px sowie natives
  Dialog-Fokusverhalten im echten Browser. In dieser Sitzung war kein Browser
  verbunden. DOM-Tests prüfen kein CSS-Layout; die Dialog-API ist dort simuliert.

Der Umbau ist lokal umgesetzt; es wurde dafür kein Deployment ausgelöst.
