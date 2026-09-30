/**
 * Skin-Name → Todesursache (deutsch) für die Welt „winter“ (Christkindlmarkt); wird von ../../death-names.ts eingebunden.
 * Hinweis: Die Liste steht HINTER den Namen der anderen Welten (erster Treffer gewinnt) – die Skin-Namen sind so gewählt,
 * dass sie dort nichts Falsches treffen (z. B. „snowball“ → Schneeball über die Alpen-Zeile).
 */
export const WINTER_DEATH_NAMES: Array<[RegExp, string]> = [
  [/snowman/, "Schneemann"],
  [/presents|geschenk/, "Geschenke-Stapel"],
  [/xmas-tree|christbaum|weihnachtsbaum/, "Weihnachtsbaum"],
  [/sugarcane|zuckerstange/, "Zuckerstange"],
  [/iceblock|eisblock/, "Eisblock"],
  [/^stall|marktstand/, "Marktstand"],
  [/kessel|gluehwein|glühwein/, "Glühwein-Kessel"],
  [/icicle|eiszapfen/, "Eiszapfen"],
  [/snowball|schneeball/, "Schneeball"],
  [/krampus/, "Krampus"],
  [/gingerbread|lebkuchen/, "Lebkuchenmann"],
  [/^elf/, "Elf"],
  [/^sled|schlitten|rodel/, "Schlitten"],
  [/firebasket|feuerkorb/, "Feuerkorb"],
  [/chains|ketten/, "Glockenkette"],
];
