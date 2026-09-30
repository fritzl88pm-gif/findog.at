import { OPER_DEATH_NAMES } from "./worlds/oper/death-names";
import { WINTER_DEATH_NAMES } from "./worlds/winter/death-names";

/** Lesbare Bezeichnung für die Todesursache (Skin-Name → deutscher Text). Unbekanntes wird ausgeblendet. */
const NAMES: Array<[RegExp, string]> = [
  // Wien
  [/tram/, "Straßenbahn"],
  [/bolt|lightning|blitz/, "Blitz"],
  [/pigeon|taube/, "Taube"],
  [/fiaker/, "Fiaker"],
  [/poller/, "Poller"],
  [/cone/, "Leitkegel"],
  [/bench/, "Parkbank"],
  [/wurstel/, "Würstelstand"],
  [/scaffold/, "Baugerüst"],
  [/bauzaun/, "Bauzaun"],
  [/rooftile|brick/, "Dachziegel"],
  [/rubble/, "Trümmer"],
  [/sign/, "Schild"],
  [/^beam$/, "Balken"],
  // Alpen
  [/lawine|avalanche/, "Lawine"],
  [/rockfall/, "Steinschlag"],
  [/rollstone/, "Rollstein"],
  [/boulder|rock|stein/, "Felsbrocken"],
  [/ibex|steinbock/, "Steinbock"],
  [/eagle|adler/, "Adler"],
  [/marmot/, "Murmeltier"],
  [/\bcow\b|^cow/, "Kuh"],
  [/beam-fence/, "Laserzaun"],
  [/fence/, "Zaun"],
  [/logs|trunk/, "Baumstamm"],
  [/ledge/, "Felsvorsprung"],
  [/cargo/, "Fracht"],
  [/cairn/, "Steinmandl"],
  [/snowball/, "Schneeball"],
  // Finanzamt
  [/stamp|stempel/, "Riesenstempel"],
  [/laser|beam-fence/, "Laser"],
  [/paper-plane/, "Papierflieger"],
  [/paper-stack|paper|akte/, "Aktenstapel"],
  [/binders/, "Ordner"],
  [/boxes/, "Kartons"],
  [/hanging/, "Hängeregister"],
  [/file-cart/, "Aktenwagen"],
  [/office-chair|chair|stuhl/, "Bürostuhl"],
  [/copier/, "Kopierer"],
  [/duct/, "Lüftungsrohr"],
  [/\bbat\b|^bat/, "Fledermaus"],
  [/lamp/, "Pendelleuchte"],
  [/shredder|schredder/, "Aktenvernichter"],
  // Prater
  [/candy/, "Zuckerwatte-Kiste"],
  [/valance/, "Buden-Vordach"],
  [/booth/, "Bude"],
  [/scooter/, "Autoscooter"],
  [/swing|karussell/, "Kettenkarussell"],
  [/ghostgate/, "Geisterbahn-Tor"],
  [/ghost|geist/, "Geist"],
  [/tires/, "Reifenstapel"],
  [/cannon|kanone/, "Kanone"],
  // Wachau
  [/cask|barrel|fass/, "Weinfass"],
  [/bee|biene/, "Bienenschwarm"],
  [/branch/, "Ast"],
  [/vines/, "Weinlaube"],
  [/wall/, "Mauer"],
  [/crates|crate|kiste/, "Kiste"],
  // Cyber
  [/drone|drohne/, "Drohne"],
  [/glitch/, "Glitch-Würfel"],
  [/phase/, "Phasen-Tor"],
  [/plasma/, "Plasma"],
  [/server/, "Server-Rack"],
  [/neon|barrier/, "Neon-Barriere"],
  // Guest-Gegner & Allgemeines
  [/odo/, "Odo"],
  [/madinger/, "Madinger"],
  [/jqa/, "JQA"],
  [/luki/, "Luki"],
  [/pit|water|abgrund|gap/, "Abgrund"],
  // neue Welten (eigene Dateien der Weltmodule)
  ...WINTER_DEATH_NAMES,
  ...OPER_DEATH_NAMES,
];

export function deathLabel(cause: string | undefined | null): string {
  if (!cause) return "";
  const c = cause.toLowerCase();
  for (const [re, name] of NAMES) if (re.test(c)) return name;
  return "";
}
