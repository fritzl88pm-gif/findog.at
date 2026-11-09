/**
 * Begruessungstexte von Fred. Reine Daten: Aenderungen hier brauchen keine
 * Logikanpassung (siehe welcome.ts fuer Auswahl und Datumslogik).
 */

export type WelcomePeriod = "morning" | "midday" | "afternoon" | "evening" | "lateNight";

export type WelcomeHolidayId =
  | "neujahr"
  | "dreikoenige"
  | "ostersonntag"
  | "ostermontag"
  | "staatsfeiertag"
  | "himmelfahrt"
  | "pfingstsonntag"
  | "pfingstmontag"
  | "fronleichnam"
  | "mariaeHimmelfahrt"
  | "nationalfeiertag"
  | "allerheiligen"
  | "mariaeEmpfaengnis"
  | "heiligerAbend"
  | "christtag"
  | "stefanitag"
  | "silvester";

const MORNING_GREETINGS = [
  "Guten Morgen! Ich hab mich schon zweimal gestreckt und einmal geschüttelt – bereit, wenn du es bist.",
  "Guten Morgen! Der Kaffee ist heiß, der Aktenstapel ist kalt. Womit fangen wir an?",
  "Guten Morgen! Ich hab die Nacht auf dem Ordnerstapel verbracht – überraschend bequem. Wobei kann ich helfen?",
  "Guten Morgen! Erste Runde ums Revier gedreht, alles ruhig. Und bei dir?",
  "Einen wunderschönen guten Morgen! Wirf mir deine Frage zu, ich bin schon in Position.",
  "Guten Morgen! Frisch aus dem Körbchen und bereits auf der Fährte. Wo geht's hin?",
  "Guten Morgen! Frühstück verschlungen, Platz für deine Fragen ist trotzdem noch da.",
  "Guten Morgen! Ohren aufgestellt, Nase justiert, Schwanz auf Betriebstemperatur. Leg los!",
  "Guten Morgen! Wer früh aufsteht, dem apportiert Fred. Was darf's sein?",
  "Guten Morgen! Ich hab schon die Zeitung geholt – jetzt bist du dran.",
  "Guten Morgen! Die Nase ist noch kalt, aber die Fährte ist schon warm. Was darf ich für dich suchen?",
  "Guten Morgen! Ich hab den Napf geleert und die Ohren gespitzt. Wobei kann ich unterstützen?",
  "Guten Morgen! Der Tag ist noch frisch wie ein ungelesener Akt. Wo fangen wir an?",
  "Servus und guten Morgen! Ich hab schon alle Belege im Vorzimmer beschnuppert. Was liegt bei dir?",
  "Guten Morgen! Einmal strecken, einmal gähnen, dann bin ich ganz bei dir.",
  "Guten Morgen! Ich hab die Post aus dem Briefkasten apportiert – leider nur Werbung. Und du?",
  "Guten Morgen! Der frühe Hund findet den Beleg. Was suchen wir heute?",
  "Grüß dich, guten Morgen! Ich sitz startklar neben dem Schreibtisch. Leg los.",
  "Guten Morgen! Mein Schwanz wedelt schon vor dem ersten Kaffee, das will was heißen.",
  "Guten Morgen! Noch ein Gähner, dann schnüffle ich mich gern durch deine Unterlagen.",
  "Guten Morgen! Der Tau ist vom Gras, der Staub ist von den Akten. Was steht an?",
  "Servus! Der Tag beginnt, die Nase läuft – bei mir heißt das: ich bin bereit.",
  "Guten Morgen! Ich hab dir einen Platz neben dem Körbchen freigehalten. Worum geht's?",
  "Guten Morgen! Frühe Stunde, klarer Kopf, feuchte Nase. Beste Voraussetzungen.",
  "Guten Morgen! Gib mir eine Spur, ich folge ihr bis zum letzten Paragrafen.",
] as const;

const MIDDAY_GREETINGS = [
  "Mahlzeit! Ich hab schon zweimal um den Tisch geschlichen. Was gibt's bei dir?",
  "Mahlzeit! Die Jause ist gesichert, die Ohren sind frei. Wobei kann ich helfen?",
  "Hallo! Mittagspause – ich teile alles, außer der Wurstsemmel.",
  "Mahlzeit! Kurz durchgeatmet, Napf geleert, volle Konzentration für dich.",
  "Servus! Ich sitz mit treuem Blick neben dem Tisch. Funktioniert erstaunlich oft.",
  "Mahlzeit! Zwischen zwei Bissen hab ich immer Zeit für deine Frage.",
  "Hallo! Ich hab das Mittagessen im Blick und dich im Ohr. Leg los.",
  "Mahlzeit! Erst die Pause, dann die Arbeit – oder beides gleichzeitig, das ist meine Spezialität.",
  "Servus! Mittagszeit ist der beste Moment, um Unangenehmes zu erledigen. Was steht an?",
  "Mahlzeit! Ich kau noch, aber ich hör dir schon zu.",
  "Mahlzeit! Die Nase sagt Gulasch, der Kopf sagt Beleg. Ich nehme beides.",
  "Servus, Mahlzeit! Ein Ohr beim Essen, eins bei dir. Was gibt's?",
  "Mahlzeit! Wer Hunger hat, sucht schneller. Wobei darf ich helfen?",
  "Grüß dich! Mittagspause heißt bei mir: Napf, Runde, deine Frage. In der Reihenfolge.",
  "Mahlzeit! Ich hab die Semmel nicht angerührt – fast. Was kann ich für dich tun?",
  "Servus! Zwischen Suppe und Hauptspeise ist genau Zeit für eine kurze Fährte.",
  "Mahlzeit! Ich sitz schon am Tisch und mach den treuesten Blick des Tages. Und du?",
  "Hallo, Mahlzeit! Die Jause wartet, aber deine Frage hat Vorrang.",
  "Mahlzeit! Mittags riecht es überall nach Anhaltspunkten, meistens nach Schnitzel. Was suchen wir?",
  "Servus! Die Sonne steht hoch, mein Napf steht leer. Eins nach dem anderen – was liegt an?",
  "Mahlzeit! Ich hab die Akten kurz beiseitegelegt, aber nicht aus den Augen verloren.",
  "Hallo! Gut gesättigt denkt es sich besser. Womit soll ich dir helfen?",
  "Mahlzeit! Ich bring dir gern was – ein Stöckchen, einen Beleg, eine Antwort. Such dir was aus.",
  "Servus! Mittagsloch? Nicht mit mir. Ich bin hellwach und hör zu.",
  "Mahlzeit! Kurzer Spaziergang ums Büro, jetzt wieder voll bei der Sache.",
] as const;

const AFTERNOON_GREETINGS = [
  "Hallo! Mittagsschlaf verschoben, deine Frage ist wichtiger.",
  "Servus! Ich sitz brav neben dem Ordner und wedle. Wobei kann ich helfen?",
  "Hallo! Ich hab die Nase tief im Papierstapel – wirf mir was zu.",
  "Hallo! Zwei Runden um den Schreibtisch gedreht, jetzt bin ich voll fokussiert. Was liegt an?",
  "Servus! Welche Frage soll ich für dich apportieren?",
  "Hallo! Ich bin der einzige Hund, der freiwillig Formulare holt. Welches darf's sein?",
  "Hallo! Gerade einen Beleg gefunden, der unter dem Sofa lag. Hast du auch welche?",
  "Grüß dich! Ich hab Zeit, Geduld und eine ausgezeichnete Nase. Leg los.",
  "Hallo! Kurze Pause vom Stöckchen, volle Aufmerksamkeit für dich.",
  "Servus! Sag ein Stichwort, den Rest bring ich dir.",
  "Servus! Der Nachmittag ist lang, aber meine Geduld ist länger. Was liegt an?",
  "Hallo! Ich hab die Sonne auf dem Teppich verlassen, nur für dich.",
  "Grüß dich! Zeit für eine Fährte durch den Papierdschungel. Wohin soll's gehen?",
  "Hallo! Mein Napf ist voll, mein Kopf ist frei. Leg los.",
  "Servus! Die Akten stapeln sich, die Nase ist bereit. Womit beginnen wir?",
  "Hallo! Ich hab einen Beleg vergraben und wiedergefunden. Mit deinen geht's sicher schneller.",
  "Servus! Nachmittagsjause erledigt, der Schwanz wedelt wieder auf voller Leistung.",
  "Hallo! Kurz die Pfoten gestreckt, jetzt bin ich ganz Ohr.",
  "Grüß dich! Wirf mir ein Stichwort hin, ich bring dir die passende Stelle.",
  "Hallo! Der Kaffee wirkt, die Nase auch. Was darf ich für dich ausgraben?",
  "Servus! Mittagstief überstanden, Konzentration zurück. Wobei kann ich helfen?",
  "Hallo! Ich hab die Ohren aufgestellt und den Schreibtisch freigeräumt. Fang an.",
  "Servus! Egal wie verwinkelt die Frage, meine Nase findet den Weg.",
  "Hallo! Ein bisschen Sonne, ein bisschen Papier – ein guter Nachmittag für Klarheit.",
  "Grüß dich! Ich bin da, ich bin wach, ich bin neugierig. Was gibt's?",
] as const;

const EVENING_GREETINGS = [
  "Guten Abend! Der Tag war lang, mein Schwanz wedelt trotzdem noch. Was liegt an?",
  "Guten Abend! Noch eine Runde durchs Aktenrevier, bevor wir Feierabend machen?",
  "Guten Abend! Ich hab mir den Platz vorm Kamin gesichert – frag ruhig von dort aus.",
  "Guten Abend! Wirf mir deine Frage zu, ich fang sie auch im Halbdunkel.",
  "Guten Abend! Der Napf ist leer, der Kopf ist voll. Womit kann ich helfen?",
  "Guten Abend! Ich hab den ganzen Tag Papier gehütet. Jetzt bist du dran.",
  "Guten Abend! Für dich mach ich gern Überstunden – zahlt mir eh keiner in Leckerlis.",
  "Schönen Abend! Ein letzter Schnüffler durchs Steuerrecht, bevor Ruhe einkehrt?",
  "Guten Abend! Müde genug für Gemütlichkeit, wach genug für deine Frage.",
  "Guten Abend! Was hat sich heute angesammelt? Ich hör zu.",
  "Guten Abend! Die Lampe brennt, der Napf ist gefüllt. Womit kann ich dir helfen?",
  "Guten Abend! Ich hab den Tag über Akten bewacht, jetzt bewache ich deine Fragen.",
  "Servus, guten Abend! Noch eine Fährte vor dem Schlafengehen?",
  "Guten Abend! Draußen wird es dunkel, meine Nase sieht trotzdem klar.",
  "Guten Abend! Wenn der Stapel schon schläft, bin ich noch lange nicht müde.",
  "Guten Abend! Der Feierabend ruft, aber ein bisserl Zeit hab ich noch für dich.",
  "Guten Abend! Decke und Körbchen sind bereit, deine Frage darf trotzdem noch rein.",
  "Schönen Abend! Ich hab die Pfoten hochgelegt und die Ohren offen gelassen.",
  "Guten Abend! Zeit, den Tag zusammenzutragen – ich apportier dir gern die Belege.",
  "Guten Abend! Der Abendspaziergang war schön, jetzt hab ich Platz im Kopf.",
  "Grüß dich! Ein Abend ohne offene Frage ist ein guter Abend. Gibt's eine?",
  "Guten Abend! Ich schnüffel noch einmal quer durch den Tag. Was ist liegen geblieben?",
  "Servus! Der Abend ist ruhig, die Nase ist wach. Erzähl mir, was dich beschäftigt.",
  "Guten Abend! Bei Lampenlicht lesen sich Belege gleich viel gemütlicher.",
  "Guten Abend! Ich bin noch da, auch wenn der Napf schon leer ist. Wo drückt der Schuh?",
] as const;

const LATE_NIGHT_GREETINGS = [
  "Andere zählen Schafe, ich sortiere Ordner. Was hält dich wach?",
  "So spät noch auf der Fährte? Ich bin dabei.",
  "Um die Zeit sind nur Nachtschwärmer, Eulen und ich unterwegs. Was liegt an?",
  "Ich hab ein Ohr im Körbchen und eins bei dir. Erzähl.",
  "Nachtschicht? Ich hab mich extra nicht zusammengerollt. Leg los.",
  "Der Mond steht hoch, der Papierstapel auch. Womit fangen wir an?",
  "Psst, die anderen schlafen. Wir zwei können ganz leise arbeiten.",
  "Zu später Stunde noch was Steuerliches? Ich schnüffel mit.",
  "Ich hab mich dreimal im Kreis gedreht und mich dann doch für dich entschieden.",
  "Späte Stunde, wache Nase. Was beschäftigt dich?",
  "Noch wach? Ich auch – meine Nase lässt mich nicht schlafen.",
  "Eine Fährte um Mitternacht? Ich bin dabei.",
  "Die Straßen sind leer, der Aktenschrank ist still. Womit kann ich helfen?",
  "Servus, Nachteule! Ich hab extra eine Kerze neben dem Körbchen angelassen.",
  "Zu später Stunde schnüffelt es sich ruhig und konzentriert. Was beschäftigt dich?",
  "Eigentlich schlaf ich jetzt, aber für eine Frage mach ich ein Auge auf.",
  "Alle Welt schläft, nur wir zwei suchen noch. Wonach?",
  "Ich hab mich gerade eingerollt, aber ein Ohr ist noch bei dir. Leg los.",
  "Die Nacht ist lang, der Papierstapel auch. Fangen wir am besten vorne an.",
  "Mitten in der Nacht noch Gedanken über Belege? Willkommen im Klub.",
  "Der Mond schaut zu, ich schnüffle mit. Was gibt's?",
  "Schlaflos? Ich hab Zeit und eine warme Nase. Was liegt dir auf der Seele?",
  "Psst, nur die Uhr tickt noch. Sag mir, was du brauchst.",
  "Um die Zeit wirken Sorgen am größten. Gemeinsam schnüffeln wir sie klein.",
  "Späte Stunde, trotzdem Pfote bei Fuß. Worum geht's?",
] as const;

export const WEEKDAY_GREETINGS: Record<WelcomePeriod, readonly string[]> = {
  morning: MORNING_GREETINGS,
  midday: MIDDAY_GREETINGS,
  afternoon: AFTERNOON_GREETINGS,
  evening: EVENING_GREETINGS,
  lateNight: LATE_NIGHT_GREETINGS,
};

export const SUNDAY_GREETINGS: Record<WelcomePeriod, readonly string[]> = {
  morning: [
    "Guten Morgen und einen schönen Sonntag! Ich hab bis zehn geschlafen, du darfst trotzdem fragen.",
    "Sonntagmorgen! Kein Wecker, kein Stress – nur ich, mein Körbchen und deine Frage.",
    "Guten Morgen! Am Sonntag ist eigentlich Ruhetag, aber ich bin trotzdem da.",
    "Servus! Sonntagsfrühstück erledigt, Gipferl-Brösel noch im Fell. Was liegt an?",
    "Guten Morgen! Ich hab den Sonntag gemütlich begonnen – mit Strecken, Gähnen und dir.",
    "Schönen Sonntagmorgen! Die Akten haben frei, ich nicht. Wobei kann ich helfen?",
    "Guten Morgen! Sonntags schnüffle ich im Schongang. Was darf's sein?",
    "Grüß dich am Sonntagmorgen! Keine Eile, die Fährte läuft uns nicht davon.",
  ],
  midday: [
    "Mahlzeit und schönen Sonntag! Der Braten duftet, die Nase ist abgelenkt, die Ohren nicht.",
    "Sonntagmittag! Bei Tisch ist Ruhe, aber für deine Frage mach ich eine Ausnahme.",
    "Servus! Sonntagsbraten im Anmarsch – ich sitz vorsorglich schon mal daneben.",
    "Mahlzeit! Heut ist Ruhetag, trotzdem bin ich für dich da.",
    "Hallo! Sonntag, Mittagszeit, volle Nase. Was liegt dir am Herzen?",
    "Mahlzeit! Am Sonntag schmeckt die Suppe besser und die Fährte ist kürzer. Wobei helfen?",
    "Servus! Ein Sonntagsspaziergang ist geplant, aber vorher hab ich Zeit für dich.",
    "Mahlzeit! Sonntags lass ich die Akten ruhen, nur dir hör ich zu.",
  ],
  afternoon: [
    "Schönen Sonntagnachmittag! Kaffee, Kuchen und ein Hund, der trotzdem zuhört.",
    "Servus! Sonntag heißt Ruhetag – aber du bekommst mich trotzdem.",
    "Hallo! Ich hab den Sonntagnachmittag auf dem Sofa begonnen. Für dich steh ich gern auf.",
    "Grüß dich! Ein gemütlicher Sonntag, ein gemütlicher Hund. Was beschäftigt dich?",
    "Hallo! Am Sonntag arbeitet sonst keiner, ich bin freiwillig da. Wobei kann ich helfen?",
    "Servus am Sonntag! Spaziergang erledigt, die Pfoten sind müde, die Nase ist wach.",
    "Hallo! Die Akten schlafen sonntags, ich schnüffle im Halbschlaf. Leg los.",
    "Schönen Sonntag! Ich hab alle Zeit der Welt – also fast: bis zum Abendessen.",
  ],
  evening: [
    "Guten Abend und schönen Sonntagabend! Noch eine Frage vor Wochenbeginn?",
    "Sonntagabend! Der Tatort läuft bald, aber ich hab noch Zeit für dich.",
    "Guten Abend! Der Sonntag klingt aus, die Nase ist noch wach. Was liegt an?",
    "Servus! Sonntagabend im Körbchen – trotzdem für dich da.",
    "Guten Abend! Morgen startet die Woche – erledigen wir heute, was sich erledigen lässt?",
    "Schönen Sonntagabend! Ruhetag eigentlich, aber ein Hund nimmt sich nie ganz frei.",
    "Guten Abend! Der Sonntag war gemütlich, die Pfoten sind warm. Wobei darf ich helfen?",
    "Hallo! Sonntagabend heißt Ruhe vor dem Montag. Sortieren wir kurz die Gedanken?",
  ],
  lateNight: [
    "Noch wach am Sonntag? Ich hab ein Ohr offen, obwohl Ruhetag ist.",
    "Späte Sonntagsstunde – trotzdem bin ich da. Was beschäftigt dich?",
    "Sonntagnacht, morgen wartet der Montag. Was möchtest du vorher noch klären?",
    "Ruhetag zu Ende, Nase noch nicht. Wobei kann ich helfen?",
    "Sonntag spät: Alle liegen im Körbchen, nur wir zwei nicht. Was gibt's?",
    "Servus, Nachteule! Auch am Sonntag bin ich für dich da.",
    "Der Sonntag macht sich langsam davon. Eine letzte Fährte?",
    "Psst, Sonntagnacht. Ich arbeite heute ganz leise, versprochen.",
  ],
};

/** Feiertagsgruss ist tageszeitunabhaengig formuliert. */
export const HOLIDAY_GREETINGS: Record<WelcomeHolidayId, readonly string[]> = {
  neujahr: [
    "Prosit Neujahr! Gute Vorsätze, volle Ordner – ich helfe bei beidem.",
    "Frohes neues Jahr! Die Nase ist frisch, der Aktenstapel noch jungfräulich.",
    "Neujahr! Das Jahr ist neu, die Belege sind es noch nicht. Wobei kann ich helfen?",
    "Ein gutes neues Jahr! Ich bin schon auf der ersten Fährte.",
  ],
  dreikoenige: [
    "Heilige Drei Könige! Ich bring zwar kein Gold, aber gern eine Antwort.",
    "Dreikönigstag! Die Sterndeuter folgten einem Stern, ich folge meiner Nase.",
    "Servus am Dreikönigstag! Heut ist Feiertag, ich bin trotzdem für dich da.",
    "Heilige Drei Könige – Gold, Weihrauch und Myrrhe hab ich nicht. Dafür Zeit und eine gute Nase.",
  ],
  ostersonntag: [
    "Frohe Ostern! Ich hab schon Eier gefunden – Belege sind schwerer, aber ich versuch's.",
    "Ostersonntag! Das Nest hab ich beschnuppert, jetzt bin ich bei dir.",
    "Frohe Ostern! Heut suche ich Eier, aber für deine Frage lasse ich sie liegen.",
    "Schöne Ostern! Feiertag hin oder her, ich bin da.",
  ],
  ostermontag: [
    "Ostermontag! Die Eier sind gefunden, die Nase ist bereit.",
    "Schönen Ostermontag! Ein gemütlicher Feiertag – frag ruhig trotzdem.",
    "Servus am Ostermontag! Spaziergang erledigt, Pfoten ausgestreckt.",
    "Ostermontag, Feiertag – ich bin trotzdem da. Was liegt an?",
  ],
  staatsfeiertag: [
    "Staatsfeiertag! Heut hat sogar das Amt frei, ich nicht.",
    "Schönen 1. Mai! Staatsfeiertag heißt Ruhe – aber ich bin da.",
    "Staatsfeiertag! Den Maibaum hab ich beschnuppert, jetzt gilt's dir.",
    "Servus am Staatsfeiertag! Nase hoch, Ohren auf – was darf es sein?",
  ],
  himmelfahrt: [
    "Christi Himmelfahrt! Feiertag und Fenstertag in einem – ich bin trotzdem da.",
    "Schönen Feiertag zu Christi Himmelfahrt! Ich bleib am Boden und helfe dir gern.",
    "Christi Himmelfahrt! Die Fährte führt heut ausnahmsweise ins Grüne.",
    "Servus an Christi Himmelfahrt! Auch Feiertage haben offene Fragen.",
    "Himmelfahrtstag – freier Tag, wacher Hund. Was liegt an?",
  ],
  pfingstsonntag: [
    "Frohe Pfingsten! Der Frühling riecht herrlich, aber deine Frage riecht spannender.",
    "Pfingstsonntag! Feiertag, Sonne, Nase im Wind – und Zeit für dich.",
    "Schöne Pfingsten! Ich hab die Akten ruhen lassen, nicht aber die Ohren.",
    "Pfingstsonntag! Ruhig und festlich – wobei darf ich helfen?",
  ],
  pfingstmontag: [
    "Pfingstmontag! Ein Feiertag ohne Termine – nur ich und deine Frage.",
    "Schönen Pfingstmontag! Der Ausflug kann warten, deine Frage auch – aber ich nicht.",
    "Servus am Pfingstmontag! Pfoten hochgelegt, Ohren offen.",
    "Pfingstmontag, Feiertag – ich bin trotzdem da. Was gibt's?",
  ],
  fronleichnam: [
    "Fronleichnam! Die Prozession zieht vorbei, ich sitz brav am Straßenrand. Und du?",
    "Schönen Fronleichnamstag! Feiertag, Blumenteppiche, Blasmusik – und ich für deine Fragen.",
    "Servus am Fronleichnamstag! Heute ist Feiertag, die Nase hat trotzdem Dienst.",
    "Fronleichnam! Ein freier Tag mit Blasmusik. Wobei kann ich dir helfen?",
  ],
  mariaeHimmelfahrt: [
    "Mariä Himmelfahrt! Mitten im Sommer ein Feiertag – ich hab die Pfoten im Gras.",
    "Schönen Feiertag zu Mariä Himmelfahrt! Kräuterbuschen gesegnet, Nase bereit.",
    "Servus an Mariä Himmelfahrt! Feiertag heißt: gemütlich, aber nicht ohne mich.",
    "Mariä Himmelfahrt – ruhiger Tag, wacher Hund. Was liegt an?",
  ],
  nationalfeiertag: [
    "Nationalfeiertag! Heut hat Österreich frei, ich bleib auf Posten.",
    "Schönen Nationalfeiertag! Ich wedle rot-weiß-rot.",
    "Servus am 26. Oktober! Nationalfeiertag – Fahne raus, Nase hoch.",
    "Nationalfeiertag! Das Bundesheer marschiert, ich schnüffle. Wobei kann ich helfen?",
  ],
  allerheiligen: [
    "Allerheiligen – ein stiller Tag. Ich bin da, wenn du eine Frage hast.",
    "Servus an Allerheiligen. Feiertag und Zeit zum Innehalten – ich hör gern zu.",
    "Allerheiligen! Ein ruhiger Tag, ich halte mich dezent im Hintergrund.",
    "Einen besinnlichen Allerheiligen-Feiertag! Wenn du was brauchst, bin ich da.",
  ],
  mariaeEmpfaengnis: [
    "Mariä Empfängnis! Feiertag mitten im Advent – ich bin trotzdem für dich da.",
    "Schönen Feiertag zu Mariä Empfängnis! Es duftet nach Punsch, meine Nase ist abgelenkt, aber bereit.",
    "Servus am 8. Dezember! Mariä Empfängnis, Einkaufsfeiertag – ich bleib bei dir.",
    "Mariä Empfängnis! Ruhe im Advent, Zeit für deine Fragen.",
  ],
  heiligerAbend: [
    "Heiliger Abend! Das Christkind kommt bald, ich halte die Stellung.",
    "Frohen Heiligen Abend! Ich hab das Fell gebürstet und die Schleife umgebunden.",
    "Heiliger Abend! Plätzchenduft in der Nase – aber für deine Frage bleibt Platz.",
    "Schönen Heiligen Abend! Auch heute bin ich für dich da.",
  ],
  christtag: [
    "Frohe Weihnachten! Der Christtag ist gemütlich, ich bin es auch.",
    "Christtag! Unterm Baum ist alles ausgepackt, bei mir ist noch Platz für deine Frage.",
    "Schönen Christtag! Ich hab ein Leckerli bekommen und teile meine Zeit mit dir.",
    "Frohe Weihnachten am Christtag! Ruhe, Kekse, Hund – wobei kann ich helfen?",
  ],
  stefanitag: [
    "Stefanitag! Der zweite Weihnachtsfeiertag – Pfoten hoch, Ohren offen.",
    "Schönen Stefanitag! Reste vom Festessen im Napf, Zeit für dich im Kopf.",
    "Servus am Stefanitag! Weihnachten klingt aus, ich bin trotzdem da.",
    "Stefanitag – gemütlicher Feiertag, wacher Hund. Was liegt an?",
  ],
  silvester: [
    "Silvester! Letzter Tag des Jahres – ich helfe, bevor es knallt.",
    "Guten Rutsch! Heut noch schnell was klären? Ich bin dabei.",
    "Silvester! Das Jahr geht, die Belege bleiben. Wobei kann ich helfen?",
    "Servus an Silvester! Böller mag ich nicht, Fragen schon. Was liegt an?",
  ],
};
