/** Lesbare Bezeichnung für die Todesursache (Skin-Name → deutscher Text). Unbekanntes wird ausgeblendet. */
const NAMES: Array<[RegExp, string]> = [
  [/tram/, "Straßenbahn"],
  [/bolt|lightning|blitz/, "Blitz"],
  [/pigeon|taube/, "Taube"],
  [/fiaker/, "Fiaker"],
  [/ibex|steinbock/, "Steinbock"],
  [/lawine|avalanche/, "Lawine"],
  [/rock|boulder|stein/, "Felsbrocken"],
  [/stamp|stempel/, "Riesenstempel"],
  [/laser|beam/, "Laser"],
  [/shredder|schredder/, "Aktenvernichter"],
  [/chair|stuhl/, "Bürostuhl"],
  [/paper|akte/, "Aktenlawine"],
  [/barrel|fass/, "Weinfass"],
  [/bee|biene/, "Biene"],
  [/drone|drohne/, "Drohne"],
  [/glitch/, "Glitch"],
  [/phase/, "Phasen-Tor"],
  [/cannon|kanone/, "Kanone"],
  [/ghost|geist/, "Geist"],
  [/swing|karussell/, "Kettenkarussell"],
  [/scooter/, "Autoscooter"],
  [/odo/, "Odo"],
  [/madinger/, "Madinger"],
  [/jqa/, "JQA"],
  [/luki/, "Luki"],
  [/pit|water|abgrund|gap/, "Abgrund"],
  [/crate|kiste/, "Kiste"],
];

export function deathLabel(cause: string | undefined | null): string {
  if (!cause) return "";
  const c = cause.toLowerCase();
  for (const [re, name] of NAMES) if (re.test(c)) return name;
  return "";
}
