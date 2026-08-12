// Static question pool for Findog Quiz
// Each category has at least 20 distinct questions.
// Questions cover current Austrian law within their category scope.
import { UserVisibleError } from "../errors";
import { CATEGORIES } from "./types";
import type { QuizQuestion } from "./types";

// --- Bundesabgabenordnung (Verfahrensrecht) ---

const BAO_QUESTIONS: QuizQuestion[] = [
  {
    question: "Welche Frist gilt grundsätzlich für die Einbringung einer Bescheidbeschwerde nach der BAO?",
    options: ["Zwei Wochen", "Ein Monat", "Sechs Wochen", "Drei Monate"],
    correctIndex: 1,
    explanation: "Gemäß § 245 BAO beträgt die Beschwerdefrist grundsätzlich einen Monat ab Zustellung des Bescheids.",
  },
  {
    question: "Welches Rechtsmittel steht gegen eine Beschwerdevorentscheidung zur Verfügung?",
    options: ["Berufung", "Vorlageantrag", "Revision", "Wiederaufnahmeantrag"],
    correctIndex: 1,
    explanation: "Gegen eine Beschwerdevorentscheidung kann gemäß § 264 BAO ein Vorlageantrag an das Bundesfinanzgericht gestellt werden.",
  },
  {
    question: "Welche Offenlegungs- und Mitwirkungspflicht trifft Abgabepflichtige nach der BAO?",
    options: ["Keine, die Behörde muss sämtliche Tatsachen allein ermitteln", "Sie müssen die für Bestand und Umfang der Abgabepflicht bedeutsamen Umstände vollständig und wahrheitsgemäß offenlegen", "Nur ausländische Einkünfte müssen offengelegt werden", "Eine Mitwirkungspflicht besteht erst vor dem Bundesfinanzgericht"],
    correctIndex: 1,
    explanation: "Nach §§ 119 ff BAO müssen Abgabepflichtige die für Bestand und Umfang der Abgabepflicht bedeutsamen Umstände vollständig und wahrheitsgemäß offenlegen und an der Ermittlung mitwirken.",
  },
  {
    question: "Was ist eine Beschwerdevorentscheidung nach der BAO?",
    options: ["Eine Entscheidung des Verwaltungsgerichtshofes", "Eine Entscheidung der Abgabenbehörde über eine Bescheidbeschwerde vor einer allfälligen Vorlage an das Bundesfinanzgericht", "Ein Antrag auf Wiederaufnahme", "Eine bloße unverbindliche Mitteilung"],
    correctIndex: 1,
    explanation: "Mit der Beschwerdevorentscheidung entscheidet die Abgabenbehörde grundsätzlich selbst über die Bescheidbeschwerde. Gegen sie kann ein Vorlageantrag eingebracht werden.",
  },
  {
    question: "Was versteht man unter einer 'Wiedereinsetzung in den vorigen Stand' nach der BAO?",
    options: ["Die automatische Verlängerung aller Fristen", "Die nachträgliche Genehmigung einer versäumten Frist bei unverschuldetem Hindernis", "Die Wiederaufnahme eines rechtskräftig abgeschlossenen Verfahrens", "Die Berichtigung von Schreibfehlern im Bescheid"],
    correctIndex: 1,
    explanation: "Die Wiedereinsetzung in den vorigen Stand (§ 308 BAO) ermöglicht bei unverschuldet versäumter Frist die nachträgliche Vornahme der versäumten Handlung.",
  },
  {
    question: "Welche Voraussetzung muss für eine Wiederaufnahme des Verfahrens nach § 303 BAO vorliegen?",
    options: ["Ein beliebiger Formalfehler", "Neu hervorgekommene Tatsachen oder Beweismittel, deren Kenntnis einen im Spruch anders lautenden Bescheid herbeigeführt hätte", "Ein Antrag des Bundesfinanzgerichts", "Die Zustimmung aller Verfahrensparteien"],
    correctIndex: 1,
    explanation: "§ 303 BAO verlangt bei diesem Wiederaufnahmegrund neu hervorgekommene Tatsachen oder Beweismittel und eine mögliche Auswirkung auf den Spruch. Ein fehlendes Verschulden der Partei ist keine Tatbestandsvoraussetzung.",
  },
  {
    question: "Wann ist eine Hinterlegung nach § 17 ZustellG bei Zustellungen im BAO-Verfahren wirksam?",
    options: ["Wenn der Zusteller Grund zur Annahme hat, dass sich der Empfänger regelmäßig an der Abgabestelle aufhält, und eine Verständigung über die Hinterlegung erfolgt", "Immer schon dann, wenn der Empfänger beim ersten Zustellversuch nicht angetroffen wird", "Nur wenn der Empfänger der Hinterlegung vorher zugestimmt hat", "Nur durch öffentliche Bekanntmachung im Amtsblatt"],
    correctIndex: 0,
    explanation: "Eine Hinterlegung setzt insbesondere voraus, dass der Empfänger sich regelmäßig an der Abgabestelle aufhält. Bei relevanter Abwesenheit tritt die Zustellwirkung erst nach Maßgabe des § 17 Abs 3 ZustellG ein.",
  },
  {
    question: "Welche Wirkung hat ein rechtzeitig eingebrachter Vorlageantrag?",
    options: ["Er verlängert automatisch alle Fristen", "Die Bescheidbeschwerde gilt wieder als unerledigt und ist dem Bundesfinanzgericht vorzulegen; die Beschwerdevorentscheidung bleibt wirksam", "Das Verfahren wird eingestellt", "Der angefochtene Bescheid wird sofort aufgehoben"],
    correctIndex: 1,
    explanation: "Nach § 264 Abs 3 BAO gilt die Bescheidbeschwerde durch den rechtzeitigen Vorlageantrag wieder als unerledigt. Die Wirksamkeit der Beschwerdevorentscheidung wird dadurch nicht berührt.",
  },
  {
    question: "Kann die Abgabenbehörde einen rechtskräftigen Bescheid von Amts wegen aufheben?",
    options: ["Nein, rechtskräftige Bescheide sind ausnahmslos unveränderlich", "Ja, etwa nach § 299 BAO bei inhaltlicher Rechtswidrigkeit, jedoch nur innerhalb der gesetzlichen Grenzen, insbesondere § 302 BAO", "Ja, jederzeit und ohne Begründung", "Nur mit Zustimmung des Bundesfinanzgerichts"],
    correctIndex: 1,
    explanation: "§ 299 BAO ermöglicht die Aufhebung eines rechtswidrigen Bescheids. Solche Maßnahmen sind nicht schrankenlos, sondern unterliegen insbesondere den zeitlichen Grenzen des § 302 BAO.",
  },
  {
    question: "Was ist ein Mängelbehebungsauftrag nach der BAO?",
    options: ["Ein Strafbescheid wegen Fristversäumnis", "Die Aufforderung zur Verbesserung formell mangelhafter Eingaben binnen bestimmter Frist", "Die Anordnung zur Nachzahlung von Abgaben", "Ein Auftrag zur Vorlage von Beweismitteln ohne Fristsetzung"],
    correctIndex: 1,
    explanation: "Gemäß § 85 BAO erteilt die Behörde bei formellen Mängeln einen Mängelbehebungsauftrag mit angemessener Frist zur Verbesserung.",
  },
  {
    question: "Welche Folgen hat die Versäumung der Frist eines Mängelbehebungsauftrags?",
    options: ["Die Eingabe gilt als zurückgenommen", "Es entsteht automatisch ein Säumniszuschlag", "Das Verfahren wird ausgesetzt", "Die Eingabe wird trotzdem inhaltlich behandelt"],
    correctIndex: 0,
    explanation: "Gemäß § 85 Abs 2 BAO gilt die Eingabe als zurückgenommen, wenn der Mängelbehebungsauftrag nicht fristgerecht erfüllt wird.",
  },
  {
    question: "Innerhalb welcher Frist ist der Vorlageantrag nach Zustellung der Beschwerdevorentscheidung einzubringen?",
    options: ["Zwei Wochen", "Ein Monat", "Sechs Wochen", "Drei Monate"],
    correctIndex: 1,
    explanation: "Der Vorlageantrag ist gemäß § 264 BAO innerhalb eines Monats nach Zustellung der Beschwerdevorentscheidung einzubringen.",
  },
  {
    question: "Was versteht man unter der 'freien Beweiswürdigung' im Abgabenverfahren?",
    options: ["Dass keine Beweise erforderlich sind", "Dass die Behörde nach ihrer inneren Überzeugung und unter Berücksichtigung der Ergebnisse des Verfahrens über den Beweiswert entscheidet", "Dass der Abgabepflichtige frei wählen kann, welche Beweise er vorlegt", "Dass die Behörde an keine Verfahrensvorschriften gebunden ist"],
    correctIndex: 1,
    explanation: "Gemäß § 167 BAO hat die Behörde unter sorgfältiger Berücksichtigung der Ergebnisse des Verfahrens nach freier Überzeugung zu beurteilen, ob eine Tatsache erwiesen ist.",
  },
  {
    question: "Was versteht man unter einem 'rückwirkenden Ereignis' im Sinne der BAO?",
    options: ["Jedes Ereignis, das in der Vergangenheit liegt", "Ein Ereignis, das nachträglich steuerliche Wirkung für die Vergangenheit entfaltet und eine Bescheidänderung rechtfertigt", "Ein Ereignis, das die Verjährung hemmt", "Ein Ereignis, das nur für zukünftige Veranlagungszeiträume wirkt"],
    correctIndex: 1,
    explanation: "Ein rückwirkendes Ereignis (§ 295a BAO) entfaltet steuerliche Wirkung für einen bereits abgeschlossenen Zeitraum und kann zur Bescheidänderung berechtigen.",
  },
  {
    question: "Was ist der Unterschied zwischen Zurückweisung und Abweisung einer Beschwerde?",
    options: ["Es gibt keinen Unterschied", "Zurückweisung erfolgt aus formellen Gründen (Unzulässigkeit), Abweisung aus materiellen Gründen (Unbegründetheit)", "Zurückweisung ist immer endgültig, Abweisung nicht", "Abweisung betrifft nur Fristfragen"],
    correctIndex: 1,
    explanation: "Eine Zurückweisung erfolgt bei formellen Mängeln (z.B. Verspätung), eine Abweisung bedeutet, dass die Beschwerde inhaltlich unbegründet ist.",
  },
  {
    question: "Kann die Abgabenbehörde offenbare Schreib- und Rechenfehler in einem Bescheid berichtigen?",
    options: ["Nein, der Bescheid muss immer neu erlassen werden", "Ja, nach § 293 BAO auf Antrag oder von Amts wegen innerhalb der gesetzlichen Grenzen", "Nur auf Antrag des Abgabepflichtigen", "Nur innerhalb eines Monats nach Bescheiderlassung"],
    correctIndex: 1,
    explanation: "§ 293 BAO erlaubt die Berichtigung offenbarer Schreib- und Rechenfehler sowie ähnlicher Unrichtigkeiten auf Antrag oder von Amts wegen; dabei sind insbesondere die zeitlichen Grenzen des § 302 BAO zu beachten.",
  },
  {
    question: "Wann beginnt die Beschwerdefrist zu laufen, wenn ein Bescheid im Wege der Hinterlegung zugestellt wird?",
    options: ["Mit dem Tag der Hinterlegung", "Mit dem ersten Tag, an dem der Bescheid tatsächlich behoben wird", "Erst nach Ablauf der Hinterlegungsfrist", "Mit der schriftlichen Bestätigung der Behörde"],
    correctIndex: 0,
    explanation: "Grundsätzlich gilt die hinterlegte Sendung mit dem ersten Tag der Abholfrist als zugestellt. War der Empfänger wegen Abwesenheit nicht rechtzeitig von der Zustellung informiert, greift die Ausnahme des § 17 Abs 3 ZustellG.",
  },
  {
    question: "Was bewirkt eine Verlängerungshandlung nach § 209 Abs 1 BAO grundsätzlich?",
    options: ["Sie hebt die Verjährung endgültig auf", "Sie verlängert die Verjährungsfrist um ein Jahr", "Sie verkürzt die Verjährungsfrist", "Sie macht den Abgabenbescheid nichtig"],
    correctIndex: 1,
    explanation: "Nach außen erkennbare Amtshandlungen zur Geltendmachung des Abgabenanspruchs oder zur Feststellung des Abgabepflichtigen verlängern die Verjährungsfrist grundsätzlich um ein Jahr.",
  },
  {
    question: "Welche Mitwirkungspflichten hat der Abgabepflichtige im Ermittlungsverfahren?",
    options: ["Keine, die Beweislast liegt allein bei der Behörde", "Er muss alle von der Behörde verlangten Auskünfte wahrheitsgemäß erteilen und Beweismittel vorlegen (Offenlegungspflicht)", "Er muss nur auf ausdrückliche Anforderung reagieren", "Er muss nur seine Einkünfte erklären, nicht seine Ausgaben"],
    correctIndex: 1,
    explanation: "Gemäß §§ 119 ff BAO besteht eine umfassende Offenlegungs- und Wahrheitspflicht; der Abgabepflichtige muss alle für den Bestand und Umfang der Abgabepflicht bedeutsamen Umstände offenlegen.",
  },
  {
    question: "Wozu dient ein Auskunftsbescheid nach § 118 BAO?",
    options: ["Als unverbindlicher allgemeiner Steuertipp", "Zur verbindlichen abgabenrechtlichen Beurteilung eines noch nicht verwirklichten Sachverhalts in den gesetzlich erfassten Bereichen", "Zur Festsetzung zukünftiger Abgaben ohne Verfahren", "Als interne Weisung der Finanzverwaltung"],
    correctIndex: 1,
    explanation: "§ 118 BAO ermöglicht ein Advance Ruling für noch nicht verwirklichte Sachverhalte, aber nur in den gesetzlich genannten Bereichen. Es ist keine allgemeine verbindliche Auskunft zu beliebigen Steuerfragen.",
  },
  {
    question: "Welche Wirkung hat ein Beschwerdeverzicht?",
    options: ["Der Bescheid kann trotzdem mit Beschwerde angefochten werden", "Der Bescheid wird sofort rechtskräftig", "Der Bescheid wird automatisch aufgehoben", "Das Verfahren wird an das Bundesfinanzgericht abgegeben"],
    correctIndex: 1,
    explanation: "Ein wirksamer Beschwerdeverzicht nach § 255 BAO schließt die Bescheidbeschwerde aus; eine dennoch eingebrachte Beschwerde ist unzulässig.",
  },
  {
    question: "Wie lange beträgt die Frist für einen Antrag auf Wiederaufnahme des Verfahrens?",
    options: ["Ein Monat", "Drei Monate ab Kenntnis des Wiederaufnahmegrundes", "Sechs Monate", "Ein Jahr"],
    correctIndex: 1,
    explanation: "Der Wiederaufnahmeantrag ist gemäß § 303 Abs 2 BAO binnen drei Monaten ab Kenntnis des Wiederaufnahmegrundes zu stellen.",
  },
  {
    question: "Welcher Rechtsschutz steht grundsätzlich offen, wenn eine Abgabenbehörde ihre Entscheidungspflicht nicht innerhalb von sechs Monaten erfüllt?",
    options: ["Die Beschwerde gilt automatisch als abgewiesen", "Eine Säumnisbeschwerde an das Verwaltungsgericht nach § 284 BAO", "Der Bescheid wird automatisch nichtig", "Ein Vorlageantrag nach § 264 BAO"],
    correctIndex: 1,
    explanation: "§ 284 BAO eröffnet bei Verletzung der behördlichen Entscheidungspflicht grundsätzlich die Säumnisbeschwerde an das Verwaltungsgericht. Sie ist kein Vorlageantrag nach § 264 BAO.",
  },
  {
    question: "Kann eine Beschwerde zurückgenommen werden?",
    options: ["Nein, eine einmal eingebrachte Beschwerde ist bindend", "Ja, bis zur Bekanntgabe der Entscheidung über die Beschwerde", "Nur mit Zustimmung der Behörde", "Nur wenn der Bescheid noch nicht rechtskräftig ist"],
    correctIndex: 1,
    explanation: "Gemäß § 256 BAO kann eine Beschwerde bis zur Bekanntgabe der Entscheidung zurückgenommen werden.",
  },
];
// --- Arbeitnehmerveranlagung ---

const ANV_QUESTIONS: QuizQuestion[] = [
  {
    question: "Was versteht man unter Werbungskosten im Sinne der Arbeitnehmerveranlagung?",
    options: ["Private Ausgaben, die das steuerpflichtige Einkommen erhöhen", "Aufwendungen zur Erwerbung, Sicherung und Erhaltung der Einnahmen", "Alle Ausgaben, die ein Arbeitnehmer tätigt", "Nur vom Arbeitgeber nicht erstattete Fahrtkosten"],
    correctIndex: 1,
    explanation: "Werbungskosten sind gemäß § 16 EStG Aufwendungen, die der Erwerbung, Sicherung und Erhaltung der Einnahmen dienen.",
  },
  {
    question: "Ab welcher Entfernung zwischen Wohnung und Arbeitsstätte steht die kleine Pendlerpauschale zu?",
    options: ["Ab 2 km", "Ab 10 km", "Ab 20 km", "Ab 40 km"],
    correctIndex: 2,
    explanation: "Die kleine Pendlerpauschale steht ab 20 km einfacher Entfernung zwischen Wohnung und Arbeitsstätte zu, wenn die Benützung eines öffentlichen Verkehrsmittels zumutbar ist.",
  },
  {
    question: "Welche Voraussetzung muss für die große Pendlerpauschale erfüllt sein?",
    options: ["Die einfache Entfernung beträgt mindestens 20 km", "Die Benützung öffentlicher Verkehrsmittel ist unzumutbar", "Es muss ein eigenes Kfz vorhanden sein", "Der Arbeitnehmer muss im Schichtdienst arbeiten"],
    correctIndex: 1,
    explanation: "Die große Pendlerpauschale setzt voraus, dass die Benützung öffentlicher Verkehrsmittel entweder überhaupt nicht möglich oder unzumutbar ist.",
  },
  {
    question: "Welche Aussage zu einem häuslichen Arbeitszimmer bei Telearbeit ist steuerlich richtig?",
    options: ["Ein Arbeitszimmer ist bei jedem Telearbeitstag automatisch absetzbar", "Die Raumkosten sind grundsätzlich nur absetzbar, wenn das Arbeitszimmer den Mittelpunkt der gesamten betrieblichen oder beruflichen Tätigkeit bildet", "Jedes Zimmer mit Schreibtisch gilt als Arbeitszimmer", "Raumkosten sind immer vollständig privat"],
    correctIndex: 1,
    explanation: "Die steuerliche Anerkennung eines häuslichen Arbeitszimmers setzt grundsätzlich voraus, dass es den Mittelpunkt der gesamten betrieblichen oder beruflichen Tätigkeit bildet. Das ist von Telearbeitspauschale und ergonomischem Mobiliar zu unterscheiden.",
  },
  {
    question: "Was ist der Alleinverdienerabsetzbetrag?",
    options: ["Ein Freibetrag für Alleinstehende", "Ein Absetzbetrag für Steuerpflichtige mit mindestens einem Kind, die mit einem Partner mit geringem Einkommen zusammenleben", "Ein Zuschlag für alle Steuerpflichtigen", "Ein Abzug von der Lohnsteuer für pendelnde Arbeitnehmer"],
    correctIndex: 1,
    explanation: "Der Alleinverdienerabsetzbetrag steht Steuerpflichtigen zu, die mit einem Partner (Ehegatten oder eingetragenen Partner) und mindestens einem Kind im gemeinsamen Haushalt leben, wobei der Partner ein bestimmtes Einkommen nicht überschreiten darf.",
  },
  {
    question: "Was sind außergewöhnliche Belastungen im Steuerrecht?",
    options: ["Alle Ausgaben, die das Budget überschreiten", "Zwangsweise, außergewöhnliche Aufwendungen, die die wirtschaftliche Leistungsfähigkeit wesentlich beeinträchtigen", "Nur Krankheitskosten", "Ausgaben für Luxusgüter"],
    correctIndex: 1,
    explanation: "Außergewöhnliche Belastungen (§ 34 EStG) sind Aufwendungen, die zwangsläufig erwachsen, außergewöhnlich sind und die wirtschaftliche Leistungsfähigkeit wesentlich beeinträchtigen.",
  },
  {
    question: "Was versteht man unter dem Selbstbehalt bei außergewöhnlichen Belastungen?",
    options: ["Ein fixer Betrag von 1.000 Euro", "Ein nach Einkommen und Familienstand gestaffelter Betrag, den der Steuerpflichtige selbst zu tragen hat", "Ein Freibetrag, der von der Steuer abgezogen wird", "Die Kosten, die vom Arbeitgeber übernommen werden"],
    correctIndex: 1,
    explanation: "Der Selbstbehalt mindert die abzugsfähigen außergewöhnlichen Belastungen und ist nach Einkommenshöhe und Familienstand gestaffelt.",
  },
  {
    question: "Sind Krankheitskosten als außergewöhnliche Belastung absetzbar?",
    options: ["Nein, Krankheitskosten sind Privatsache", "Ja, soweit sie die zumutbare Mehrbelastung (Selbstbehalt) übersteigen", "Nur stationäre Krankenhauskosten", "Ja, ohne jede Einschränkung"],
    correctIndex: 1,
    explanation: "Krankheitskosten sind als außergewöhnliche Belastung absetzbar, soweit sie den nach Einkommen gestaffelten Selbstbehalt übersteigen.",
  },
  {
    question: "Was ist der Verkehrsabsetzbetrag?",
    options: ["Ein Abzug für die Kfz-Steuer", "Ein allgemeiner Absetzbetrag, der allen Arbeitnehmern unabhängig von tatsächlichen Fahrtkosten zusteht", "Ein Absetzbetrag nur für Öffi-Nutzer", "Eine Steuergutschrift für den Kauf eines Elektroautos"],
    correctIndex: 1,
    explanation: "Der Verkehrsabsetzbetrag steht allen Arbeitnehmern unabhängig vom tatsächlichen Verkehrsmittel zu und wird automatisch bei der Lohnverrechnung berücksichtigt.",
  },
  {
    question: "Können Kosten für eine berufliche Fortbildung als Werbungskosten abgesetzt werden?",
    options: ["Nur wenn der Arbeitgeber die Kosten nicht trägt", "Ja, Fortbildungskosten sind Werbungskosten, wenn sie der beruflichen Sphäre zuzuordnen sind", "Nur innerhalb des ersten Berufsjahres", "Nein, Fortbildung ist Privatsache"],
    correctIndex: 1,
    explanation: "Kosten für berufliche Fortbildung sind Werbungskosten, soweit sie im Zusammenhang mit der ausgeübten oder einer verwandten beruflichen Tätigkeit stehen.",
  },
  {
    question: "Was ist der Familienbonus Plus?",
    options: ["Eine einmalige Familienbeihilfe", "Ein Absetzbetrag, der die Steuerlast für Familien mit Kindern direkt reduziert", "Ein Zuschuss zum Familienurlaub", "Ein Freibetrag für Familien mit mehr als drei Kindern"],
    correctIndex: 1,
    explanation: "Der Familienbonus Plus ist ein Absetzbetrag, der die Steuerlast direkt reduziert (bis zur Nullgrenze) und pro Kind bis zum 18. Lebensjahr (bzw. länger bei Anspruch auf Familienbeihilfe) zusteht.",
  },
  {
    question: "Was versteht man unter dem Pendler-Euro?",
    options: ["Eine pauschale Fahrtkostenvergütung vom Arbeitgeber", "Ein monatlicher Zuschuss vom Finanzamt", "Ein Zuschlag zur Pendlerpauschale, der als Absetzbetrag ausgestaltet ist", "Ein Gutschein für öffentliche Verkehrsmittel"],
    correctIndex: 2,
    explanation: "Der Pendlereuro ist ein Absetzbetrag, der zusätzlich zum Pendlerpauschale zusteht und direkt die Steuerschuld reduziert. Seine konkrete Höhe richtet sich nach der jeweils geltenden gesetzlichen Regelung und der einfachen Entfernung.",
  },
  {
    question: "Können Spenden steuerlich abgesetzt werden?",
    options: ["Nein, Spenden sind nicht absetzbar", "Ja, als Sonderausgaben oder Betriebsausgaben an bestimmte begünstigte Einrichtungen", "Nur an politische Parteien", "Ja, ohne betragliche Begrenzung"],
    correctIndex: 1,
    explanation: "Spenden an bestimmte begünstigte Einrichtungen (z.B. mildtätige Organisationen, Forschungseinrichtungen) sind als Sonderausgaben absetzbar.",
  },
  {
    question: "Was versteht man unter Absetzbeträgen im Unterschied zu Freibeträgen?",
    options: ["Es gibt keinen Unterschied", "Freibeträge mindern die Bemessungsgrundlage, Absetzbeträge mindern direkt die Steuerschuld", "Absetzbeträge sind immer rückzahlbar", "Freibeträge werden nur bei Selbstständigen gewährt"],
    correctIndex: 1,
    explanation: "Absetzbeträge reduzieren die errechnete Steuerschuld direkt (wenn auch maximal bis null), während Freibeträge das zu versteuernde Einkommen verringern.",
  },
  {
    question: "Welche Kosten für Arbeitsmittel sind als Werbungskosten absetzbar?",
    options: ["Nur Arbeitskleidung", "Fachliteratur, Computer, Büromaterial und andere beruflich notwendige Arbeitsmittel", "Nur vom Arbeitgeber genehmigte Anschaffungen", "Ausschließlich Büromöbel"],
    correctIndex: 1,
    explanation: "Typische Werbungskosten umfassen beruflich genutzte Arbeitsmittel wie Fachliteratur, Computer, Schreibtisch, Büromaterial und Arbeitskleidung mit Berufscharakter.",
  },
  {
    question: "Können Kosten einer auswärtigen Berufsausbildung eines Kindes steuerlich berücksichtigt werden?",
    options: ["Nein, niemals", "Ja, unter den gesetzlichen Voraussetzungen als außergewöhnliche Belastung durch einen monatlichen Pauschbetrag", "Nur wenn das Kind kein eigenes Einkommen hat", "Immer in Höhe der tatsächlichen Gesamtkosten"],
    correctIndex: 1,
    explanation: "Besteht im Einzugsbereich des Wohnortes keine entsprechende Ausbildungsmöglichkeit, kann für die auswärtige Berufsausbildung eines Kindes unter den gesetzlichen Voraussetzungen ein monatlicher Pauschbetrag als außergewöhnliche Belastung berücksichtigt werden.",
  },
  {
    question: "Was ist das Werbungskostenpauschale und wofür ist es gedacht?",
    options: ["Eine Obergrenze für Werbungskosten", "Ein Pauschalbetrag (derzeit 132 Euro jährlich), der ohne Nachweis für Werbungskosten angesetzt wird", "Eine Steuerrückzahlung", "Eine Pauschale nur für Gewerkschaftsbeiträge"],
    correctIndex: 1,
    explanation: "Das Werbungskostenpauschale wird automatisch berücksichtigt, wenn keine höheren Werbungskosten nachgewiesen werden. Höhere tatsächliche Kosten können das Pauschale ersetzen.",
  },
  {
    question: "Sind gewöhnliche Kinderbetreuungskosten nach aktueller Rechtslage allgemein als außergewöhnliche Belastung absetzbar?",
    options: ["Ja, immer bis zu einem jährlichen Höchstbetrag", "Nein; der frühere allgemeine Abzug wurde abgeschafft, besondere zwangsläufige Ausnahmefälle können aber nach den allgemeinen Regeln zu prüfen sein", "Nur für Kinder unter drei Jahren", "Nur bei Alleinerziehenden"],
    correctIndex: 1,
    explanation: "Der frühere allgemeine Abzug von Kinderbetreuungskosten als außergewöhnliche Belastung wurde mit Einführung des Familienbonus Plus abgeschafft. Unberührt bleiben besondere Fälle, die unabhängig davon die allgemeinen Voraussetzungen einer außergewöhnlichen Belastung erfüllen.",
  },
  {
    question: "Wofür steht die Negativsteuer im österreichischen Steuerrecht?",
    options: ["Eine Strafe bei Steuerhinterziehung", "Die Erstattung von Sozialversicherungsbeiträgen bei niedrigem Einkommen (SV-Rückerstattung)", "Ein negativer Steuersatz für Geringverdiener", "Die Rückzahlung aller gezahlten Steuern"],
    correctIndex: 1,
    explanation: "Die Negativsteuer ist die SV-Rückerstattung für Arbeitnehmer mit niedrigem Einkommen, die aufgrund geringer Steuerleistung bestimmte Absetzbeträge nicht ausschöpfen können.",
  },
  {
    question: "Können Kosten für eine doppelte Haushaltsführung als Werbungskosten abgesetzt werden?",
    options: ["Nein, das ist reine Privatsache", "Ja, wenn die Verlegung des Familienwohnsitzes aus beruflichen Gründen unzumutbar ist", "Nur bei Auslandsentsendungen", "Ja, pauschal für jeden Arbeitnehmer möglich"],
    correctIndex: 1,
    explanation: "Kosten der doppelten Haushaltsführung sind Werbungskosten, wenn die Verlegung des Familienwohnsitzes beruflich veranlasst ist und eine tägliche Rückkehr unzumutbar ist.",
  },
  {
    question: "Wie wird der Alleinverdienerabsetzbetrag vom Familienbonus Plus unterschieden?",
    options: ["Es gibt keinen Unterschied", "Der Alleinverdienerabsetzbetrag setzt einen Partner mit geringem Einkommen voraus, der Familienbonus Plus wird pro Kind gewährt", "Der Alleinverdienerabsetzbetrag wird nur an Väter ausgezahlt", "Der Familienbonus Plus ersetzt den Alleinverdienerabsetzbetrag vollständig"],
    correctIndex: 1,
    explanation: "Der Alleinverdienerabsetzbetrag knüpft am Einkommensverhältnis der Partner an, der Familienbonus Plus hingegen wird direkt pro Kind als Absetzbetrag gewährt und ist unabhängig vom Partner-Einkommen.",
  },
  {
    question: "Unter welcher Voraussetzung sind Begräbniskosten als außergewöhnliche Belastung absetzbar?",
    options: ["Immer, ohne Einschränkung", "Wenn die Kosten den Nachlass oder die Versicherungsleistung übersteigen und zwangsläufig sind", "Nur bei Personen unter 50 Jahren", "Nur wenn das Begräbnis im Ausland stattfindet"],
    correctIndex: 1,
    explanation: "Begräbniskosten sind absetzbar, soweit sie nicht aus dem Nachlass oder aus Versicherungsleistungen gedeckt werden können.",
  },
  {
    question: "Was passiert bei der Arbeitnehmerveranlagung, wenn die Werbungskosten unter dem Pauschbetrag liegen?",
    options: ["Die Steuererklärung ist nicht möglich", "Das Werbungskostenpauschale wird automatisch berücksichtigt", "Es müssen zwingend tatsächliche Kosten nachgewiesen werden", "Die Veranlagung ist Pflicht, wenn Werbungskosten zu niedrig sind"],
    correctIndex: 1,
    explanation: "Liegen die tatsächlichen Werbungskosten unter dem Pauschbetrag, wird automatisch das Werbungskostenpauschale in Höhe von mindestens 132 Euro jährlich berücksichtigt.",
  },
  {
    question: "Wie kann eine SV-Rückerstattung bei niedrigem Einkommen grundsätzlich geltend gemacht werden?",
    options: ["Durch einen Antrag auf Lohnsteuerbefreiung", "Im Rahmen der Arbeitnehmerveranlagung nach den Voraussetzungen des § 33 EStG", "Durch einen Antrag auf Pendlerpauschale", "Durch einen Antrag auf Familienbeihilfe"],
    correctIndex: 1,
    explanation: "Die sogenannte Negativsteuer ist eine gesetzlich geregelte SV-Rückerstattung nach § 33 EStG. Sie wird im Rahmen der Arbeitnehmerveranlagung ermittelt, wenn die jeweiligen Voraussetzungen erfüllt sind.",
  },
];
// --- Familienbeihilfe ---

const FBH_QUESTIONS: QuizQuestion[] = [
  {
    question: "Bis zu welchem Lebensjahr besteht grundsätzlich Anspruch auf Familienbeihilfe?",
    options: ["Bis zum 16. Lebensjahr", "Bis zum 18. Lebensjahr", "Bis zum 24. Lebensjahr", "Bis zum 27. Lebensjahr"],
    correctIndex: 1,
    explanation: "Die Familienbeihilfe steht grundsätzlich bis zur Vollendung des 18. Lebensjahres zu; bei Vorliegen bestimmter Voraussetzungen (z. B. Berufsausbildung) verlängert sich der Anspruch.",
  },
  {
    question: "Unter welcher Voraussetzung kann die Familienbeihilfe über das 18. Lebensjahr hinaus bezogen werden?",
    options: ["Nur bei Behinderung", "Bei ernsthafter und zielstrebiger Berufsausbildung, maximal bis 24 (in bestimmten Fällen bis 25)", "Automatisch bis 26 für alle", "Nur bei Vollwaisen"],
    correctIndex: 1,
    explanation: "Die Familienbeihilfe wird über das 18. Lebensjahr hinaus bei Berufsausbildung gewährt, grundsätzlich bis zur Vollendung des 24. Lebensjahres (bzw. 25. Lebensjahr bei bestimmten Studien).",
  },
  {
    question: "Welche Aussage zum eigenen Einkommen eines volljährigen Kindes und zur Familienbeihilfe ist richtig?",
    options: ["Eigenes Einkommen ist immer unbegrenzt unschädlich", "Für das zu versteuernde Einkommen gilt ab dem maßgeblichen Kalenderjahr eine gesetzliche Zuverdienstgrenze; ein Überschreiten kann zu einer Rückforderung führen", "Jedes Einkommen führt sofort zum vollständigen Verlust", "Es zählt nur das Bruttoeinkommen ohne gesetzliche Ausnahmen"],
    correctIndex: 1,
    explanation: "§ 5 FLAG sieht für das zu versteuernde Einkommen eines Kindes eine jährliche Grenze vor. Maßgeblich sind die gesetzliche Berechnung, Ausnahmen und der jeweils geltende Grenzbetrag.",
  },
  {
    question: "Welche Behörde ist in Österreich für die Familienbeihilfe zuständig?",
    options: ["Das Finanzamt Österreich", "Die Sozialversicherungsanstalt", "Das Arbeitsmarktservice (AMS)", "Die jeweilige Gemeinde"],
    correctIndex: 0,
    explanation: "Für die Familienbeihilfe ist das Finanzamt Österreich zuständig; Rechtsgrundlage ist insbesondere das Familienlastenausgleichsgesetz 1967.",
  },
  {
    question: "Wer hat Anspruch auf Familienbeihilfe?",
    options: ["Nur österreichische Staatsbürger", "Personen mit Wohnsitz oder gewöhnlichem Aufenthalt in Österreich für ihre Kinder, sowie unter bestimmten Voraussetzungen bei Auslandsbezug", "Nur Alleinerziehende", "Nur verheiratete Eltern"],
    correctIndex: 1,
    explanation: "Anspruch auf Familienbeihilfe haben Personen mit Wohnsitz oder gewöhnlichem Aufenthalt in Österreich für Kinder, die im gemeinsamen Haushalt leben oder für die sie überwiegend die Unterhaltskosten tragen.",
  },
  {
    question: "Was ist der Kinderabsetzbetrag und wie verhält er sich zur Familienbeihilfe?",
    options: ["Er ersetzt die Familienbeihilfe", "Er wird gemeinsam mit der Familienbeihilfe ausbezahlt und ist ein monatlicher Fixbetrag pro Kind", "Er ist eine einmalige Zahlung bei Geburt", "Er ist nur für das erste Kind vorgesehen"],
    correctIndex: 1,
    explanation: "Der Kinderabsetzbetrag wird gemeinsam mit der Familienbeihilfe ausbezahlt und beträgt monatlich einen bestimmten Betrag pro Kind.",
  },
  {
    question: "Können auch Großeltern Familienbeihilfe beziehen?",
    options: ["Nein, nur leibliche Eltern", "Ja, wenn die gesetzlichen Anspruchsvoraussetzungen erfüllt sind, insbesondere Haushaltszugehörigkeit oder subsidiär überwiegende Unterhaltsleistung", "Nur wenn die Eltern verstorben sind", "Nur mit gerichtlicher Genehmigung"],
    correctIndex: 1,
    explanation: "Auch Großeltern können anspruchsberechtigt sein. Vorrangig ist die Haushaltszugehörigkeit; fehlt eine anspruchsberechtigte Haushaltsgemeinschaft, kann unter den gesetzlichen Voraussetzungen die überwiegende Unterhaltsleistung maßgeblich sein.",
  },
  {
    question: "Endet Familienbeihilfe bei Abschluss einer Berufsausbildung stets sofort am Prüfungstag?",
    options: ["Ja, immer am Prüfungstag", "Nein; der Anspruch ist monatsbezogen und gesetzliche Anschluss- oder Übergangstatbestände können weiterbestehen", "Nein, er besteht immer weitere drei Monate", "Nein, er besteht automatisch ein weiteres Jahr"],
    correctIndex: 1,
    explanation: "Der Anspruch wird monatsbezogen beurteilt und endet nicht untertägig mit einer Prüfung. Ob er nach Abschluss weiterbesteht, hängt von den gesetzlichen Anschluss- und Übergangstatbeständen ab.",
  },
  {
    question: "Wann steht die erhöhte Familienbeihilfe wegen erheblicher Behinderung zu?",
    options: ["Nie, es gilt immer derselbe Betrag", "Wenn für das Kind Familienbeihilfe zusteht und eine erhebliche Behinderung nachgewiesen ist", "Schon bei jeder Erkrankung", "Nur wenn das Kind minderjährig ist"],
    correctIndex: 1,
    explanation: "Die erhöhte Familienbeihilfe ist ein Zuschlag zur Familienbeihilfe. Sie setzt einen Familienbeihilfenanspruch und eine erhebliche Behinderung voraus; die allgemeinen Anspruchs- und Altersregeln werden dadurch nicht aufgehoben.",
  },
  {
    question: "Was versteht man unter dem Mehrkindzuschlag?",
    options: ["Einen automatischen Bonus für das erste Kind", "Eine einkommensabhängige zusätzliche Leistung für das dritte und jedes weitere Kind, die gesondert geltend zu machen ist", "Einen Zuschlag nur für Zwillingsgeburten", "Einen Teil des Kinderabsetzbetrags"],
    correctIndex: 1,
    explanation: "Der Mehrkindzuschlag ist eine einkommensabhängige zusätzliche Leistung ab dem dritten Kind. Er wird nicht automatisch mit der Familienbeihilfe ausbezahlt, sondern ist gesondert geltend zu machen.",
  },
  {
    question: "Was gilt während des Präsenz-, Ausbildungs- oder Zivildienstes für die Familienbeihilfe?",
    options: ["Sie wird immer in voller Höhe weiterbezahlt", "Für diese Dienstzeiten besteht für volljährige Kinder grundsätzlich kein Anspruch", "Sie wird automatisch halbiert", "Sie wird durch eine Leistung des Bundesheeres ersetzt"],
    correctIndex: 1,
    explanation: "Während Präsenz-, Ausbildungs- oder Zivildienst besteht für volljährige Kinder grundsätzlich kein Anspruch auf Familienbeihilfe. Der Anspruch ist nach Ende des Dienstes anhand der dann vorliegenden Voraussetzungen neu zu beurteilen.",
  },
  {
    question: "Kann Familienbeihilfe für ein Kind bezogen werden, das im Ausland lebt?",
    options: ["Nein, niemals", "Ja, unter bestimmten Voraussetzungen, insbesondere bei EU/EWR-Bezug oder nach dem FLAG", "Nur in Deutschland", "Nur wenn das Kind die österreichische Staatsbürgerschaft hat"],
    correctIndex: 1,
    explanation: "Familienbeihilfe kann unter bestimmten Voraussetzungen auch für Kinder im Ausland bezogen werden, geregelt durch EU-Verordnungen und bilaterale Abkommen.",
  },
  {
    question: "In welchem Zahlungsrhythmus wird die Familienbeihilfe grundsätzlich gutgeschrieben?",
    options: ["Jährlich", "Monatlich", "Quartalsweise", "Halbjährlich"],
    correctIndex: 1,
    explanation: "Die Familienbeihilfe wird monatlich gutgeschrieben; bei Überweisung auf ein inländisches Girokonto erfolgt die Gutschrift grundsätzlich spätestens am 8. des Monats.",
  },
  {
    question: "Führt ein Grad der Behinderung von mindestens 50 % allein zu einem altersunbegrenzten Familienbeihilfenanspruch?",
    options: ["Ja, immer", "Nein; ein altersunbegrenzter Anspruch setzt insbesondere die gesetzlichen Voraussetzungen zur voraussichtlich dauernden Unfähigkeit voraus, sich selbst den Unterhalt zu verschaffen", "Ja, aber nur bis 30", "Nein, erhöhte Familienbeihilfe endet immer mit 24"],
    correctIndex: 1,
    explanation: "Der Grad der Behinderung von mindestens 50 % begründet den Erhöhungsbetrag, beseitigt aber nicht automatisch jede Altersgrenze. Für einen altersunbegrenzten Anspruch sind die besonderen gesetzlichen Voraussetzungen zur dauernden Unterhaltsunfähigkeit maßgeblich.",
  },
  {
    question: "Was ist die Voraussetzung für den Bezug der Familienbeihilfe bei einem volljährigen Kind in Berufsausbildung?",
    options: ["Das Kind muss im selben Haushalt wohnen", "Es muss eine ernsthafte und zielstrebige Berufsausbildung vorliegen", "Das Kind muss eine bestimmte Noten-Mindestleistung erbringen", "Das Kind darf nicht berufstätig sein"],
    correctIndex: 1,
    explanation: "Die Familienbeihilfe wird bei volljährigen Kindern nur bei ernsthafter und zielstrebiger Berufsausbildung bis maximal 24 (bzw. 25) weiter gewährt.",
  },
  {
    question: "Wer erhält die Familienbeihilfe bei getrennt lebenden Eltern?",
    options: ["Immer die Mutter", "Der Elternteil, bei dem das Kind hauptsächlich lebt und der die Haushaltsgemeinschaft bildet (Betreuungselternteil)", "Beide Elternteile zu gleichen Teilen", "Das Kind selbst ab 18"],
    correctIndex: 1,
    explanation: "Bei getrennt lebenden Eltern wird die Familienbeihilfe an jenen Elternteil ausbezahlt, der mit dem Kind im gemeinsamen Haushalt lebt und den Haushalt führt.",
  },
  {
    question: "Welche Aussage zu einem Studienwechsel und zur Familienbeihilfe ist richtig?",
    options: ["Jeder Studienwechsel ist unschädlich", "Ein Studienwechsel kann nach den gesetzlichen Studienwechselregeln den Anspruch beeinflussen; Zeitpunkt, Anzahl und anerkannte Vorstudienzeiten sind maßgeblich", "Der Anspruch ruht immer genau ein Jahr", "Nur die Inskription ist entscheidend"],
    correctIndex: 1,
    explanation: "Für Studienwechsel gelten die Verweisungsregeln des FLAG in Verbindung mit § 17 StudFG. Ein später oder zu häufiger Wechsel kann eine Wartezeit auslösen; gesetzliche Ausnahmen und die Anrechnung von Vorstudienzeiten sind zu beachten.",
  },
  {
    question: "Was passiert mit der Familienbeihilfe bei Geburt eines weiteren Kindes?",
    options: ["Sie bleibt unverändert", "Die Familienbeihilfe erhöht sich ab dem Monat der Geburt mit dem für das weitere Kind geltenden Betrag", "Sie pausiert für das erste Kind", "Es wird ein Einmalbetrag ausbezahlt"],
    correctIndex: 1,
    explanation: "Mit der Geburt eines weiteren Kindes entsteht ein eigenständiger Anspruch auf Familienbeihilfe für dieses Kind, der kumulativ zum bestehenden Anspruch hinzutritt.",
  },
  {
    question: "Können volljährige Kinder selbst Anspruch auf Familienbeihilfe haben?",
    options: ["Nein, das ist ausgeschlossen", "Ja, in gesetzlich geregelten Sonderfällen, etwa als Vollwaisen oder unter bestimmten Voraussetzungen ohne überwiegenden Elternunterhalt", "Immer automatisch ab 18", "Nur mit Zustimmung beider Eltern"],
    correctIndex: 1,
    explanation: "Das FLAG kennt Eigenansprüche volljähriger Kinder in bestimmten Sonderfällen. Davon zu unterscheiden ist die bloße Direktauszahlung eines elterlichen Anspruchs an das volljährige Kind.",
  },
  {
    question: "Was versteht man unter dem Schulstartgeld?",
    options: ["Eine monatliche Erhöhung der Familienbeihilfe", "Einen jährlichen Einmalbetrag, der im August gemeinsam mit der Familienbeihilfe für Kinder der gesetzlich bestimmten Altersgruppe ausbezahlt wird", "Einen Zuschuss ausschließlich für Nachhilfe", "Eine Ermäßigung bei Schulgebühren"],
    correctIndex: 1,
    explanation: "Das Schulstartgeld ist ein jährlicher Einmalbetrag für anspruchsberechtigte Kinder und wird im August gemeinsam mit der Familienbeihilfe ausbezahlt.",
  },
  {
    question: "Besteht Anspruch auf Familienbeihilfe während eines freiwilligen sozialen Jahres?",
    options: ["Nein", "Ja, unter bestimmten Voraussetzungen auch während eines freiwilligen sozialen Jahres", "Nur wenn das Kind unter 18 ist", "Nur bei vorheriger Bewilligung durch das Finanzamt"],
    correctIndex: 1,
    explanation: "Unter bestimmten Bedingungen kann auch während eines freiwilligen sozialen Jahres oder eines vergleichbaren Freiwilligendienstes Familienbeihilfe bezogen werden.",
  },
  {
    question: "Welche Wirkung kann Erwerbstätigkeit eines studierenden volljährigen Kindes auf die Familienbeihilfe haben?",
    options: ["Jede Erwerbstätigkeit führt automatisch zum Verlust", "Die Geringfügigkeitsgrenze ist nicht der maßgebliche Test; entscheidend sind die gesetzlichen Einkommensgrenzen und ein ernsthaft betriebenes Studium", "Die Familienbeihilfe wird stets anteilig gekürzt", "Der Bezug wird automatisch für ein Semester ausgesetzt"],
    correctIndex: 1,
    explanation: "Eine Erwerbstätigkeit ist nicht schon wegen Überschreitens der Geringfügigkeitsgrenze schädlich. Zu prüfen sind insbesondere die Zuverdienstgrenze nach § 5 FLAG und die Voraussetzungen einer ernsthaften Berufsausbildung.",
  },
  {
    question: "Wann endet die Familienbeihilfe bei Studienabbruch?",
    options: ["Sofort am Tag des Abbruchs", "Mit Ende des Monats, in dem die Entscheidung zum Abbruch getroffen wurde, spätestens aber mit Ablauf des bewilligten Zeitraums", "Am Ende des laufenden Semesters", "Erst nach einem Jahr"],
    correctIndex: 1,
    explanation: "Bei Studienabbruch endet die Familienbeihilfe mit Ablauf des Monats, in dem das Studium nicht mehr ernsthaft betrieben wird.",
  },
];
export function getPoolQuestions(category: string): readonly QuizQuestion[] {
  if (category === "Bundesabgabenordnung (Verfahrensrecht)") return BAO_QUESTIONS;
  if (category === "Arbeitnehmerveranlagung") return ANV_QUESTIONS;
  if (category === "Familienbeihilfe") return FBH_QUESTIONS;
  throw new UserVisibleError(
    `Ungültige Kategorie. Erlaubt: ${CATEGORIES.join(", ")}.`,
    400,
  );
}
