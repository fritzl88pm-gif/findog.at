# Fredrun 2.0 – Bild-Pipeline (fal.ai, GPT Image 2)

Die Welten **Christkindlmarkt** (`winter`) und **Opernball** (`oper`) sind bildgestützt: Kulissen und Props stammen von GPT Image 2
(`openai/gpt-image-2` auf fal.ai), die Weltmodule machen daraus Parallax, Licht, Wetter und Animation.

```
tools/fredrun2/art_prompts/<welt>.json   Stilzeilen + Aufträge (Name, Größe, Qualität, transparent) – reproduzierbare Prompts
tools/fredrun2/fal-art.mjs               Client: gen | batch | ledger, Parallelitätslimit, Kosten-Ledger mit Budgetgrenze
tools/fredrun2/pack_world_art.py         Roh-PNG → nahtlos kachelbare WebP-Ebenen in public/fredrun2/worlds/<welt>/ (+ manifest.json)
tools/fredrun2/pack_props.py             Props (kind: static, RGBA-PNG) → public/fredrun2/props/ (+ manifest.json)
tools/fredrun2/props_spec.json           Prop-Spezifikation (Einträge `winter-*`, `oper-*`, `wien-*`, `alpen-*`, `finanzamt-*`, `prater-*`, `wachau-*`, `cyber-*`)
tools/fredrun2/art_prompts/legacy.json   Hindernis-Props für die älteren Welten (30 Stück, 1024er-Formate, medium)
tools/fredrun2/asset-rev.mjs             Revisions-Hashes für Cache-Busting (siehe unten)
```

```bash
export FAL_KEY="<id>:<secret>"                      # nur Umgebung, nie ins Repo
node tools/fredrun2/fal-art.mjs batch tools/fredrun2/art_prompts/winter.json --out /tmp/art/winter --budget 3.4 [--only name1,name2] [--force]
python3 tools/fredrun2/pack_world_art.py --src /tmp/art/winter --world winter      # Kulissen
python3 tools/fredrun2/pack_props.py --src /tmp/art --only winter-snowman,…         # Props (src in props_spec.json: winter/winter-<name>.png)
```

## Erkenntnisse

* **Ebenen mit Alpha**: `background: "transparent"` liefert echte Transparenz (PNG). Ebenen mit transparentem Himmel stehen auf der Unterkante
  → Mittel-/Nahgrund; opake Ebenen (Himmel, Saalwände) füllen das Bild.
* **Kachelbarkeit**: Wird im Prompt „tiles seamlessly horizontally“ verlangt, schließt das Modell die Naht meist bemerkenswert gut. Der Packer
  überblendet zusätzlich 64 Spalten (vormultipliziert) und kürzt die Kachel um diese Breite → exakt nahtlos.
* **Format 3:1**: 2304×768 (Kulissen), 1536×512 (Böden), 1024×1024 (Props) – Seitenverhältnis ≤ 3:1, Maße Vielfache von 16.
* **Text im Bild** entsteht trotz „no text“ manchmal (Schilder): Prompt „all signs and boards are completely blank“ verwenden und neu würfeln.
* **Kosten** (fal-Schätzung, skaliert mit der Pixelzahl): low ≈ 0,02 $, medium ≈ 0,07 $, high ≈ 0,19 $ je 1024². Der Client bucht jede Erzeugung im
  `ledger.json` des Ausgabeordners und startet nichts mehr über `--budget` (USD). Parallelität ≤ 10 (fal-Limit) – Standard 6.
* Rohbilder (je 1–2 MB) liegen nicht im Repo; die Prompts sind versioniert, Ergebnisse sind aber nicht deterministisch.

## Verbrauch (Schätzung)

Kulissen und Props beider Welten ≈ 6,1 $ (Tests, `winter` ≈ 2,7 $, `oper` ≈ 2,8 $ inkl. Neuwürfeln), zusätzliche Props der Welt-Agenten ≈ 0,14 $ (`oper-bottle`, `oper-drape`),
30 Hindernis-Props der älteren Welten (`legacy.json`, medium, kein Neuwürfeln nötig) ≈ 1,65 $ → gesamt ≈ 7,9 $.

## Cache-Busting (Asset-Revisionen)

`/fredrun2/*` wird laut `next.config.ts` bis zu einen Tag ungeprüft aus dem Browser-Cache bedient. Ein wiederkehrender Spieler behielt so ein altes
`props/manifest.json` – die neuen Props fehlten, die Hindernisse der neuen Welten erschienen „ohne Textur“ (Fallback-Zeichnung).
Darum hängt der Client jeder Asset-URL `?v=<Hash>` an (`src/game/fredrun2/asset-rev.ts`, `withRev`). Der Hash ist ein Inhalts-Hash je Gruppe
(`chars`, `props`, `worlds`, `audio`, `previews`, `root`) und steht in der generierten Datei `asset-rev.generated.ts`.

```bash
node tools/fredrun2/asset-rev.mjs           # nach JEDER Änderung an public/fredrun2 ausführen (schreibt asset-rev.generated.ts)
node tools/fredrun2/asset-rev.mjs --check   # Prüfung (läuft auch als Test: asset-rev.test.ts)
```

Zusätzlich lädt `PropLib.preload` das Manifest einmalig am Cache vorbei neu, falls angeforderte Props darin fehlen.
