# reverse

Sammlung von **Reverse-Engineering- und Nachbau-Projekten**. Jedes Projekt liegt in einem
eigenen Ordner unter [`projects/`](projects) und ist komplett eigenständig: eigene
Abhängigkeiten, eigene Tests, eigene CI. Projekte beeinflussen sich gegenseitig nicht.

## Projekte

| Projekt | Ordner | Vorbild | Plattform | Stack | Status |
| ------- | ------ | ------- | --------- | ----- | ------ |
| **MAD Studio** – pattern-basierte DAW | [`projects/mad-studio`](projects/mad-studio) | FL Studio (Image-Line) | macOS · Browser | TypeScript · React · Web Audio · Electron · C++/JUCE (native Engine) | 🟢 v0.2 – Automation, Aufnahme, VST3/AU |

<!-- Neue Projekte hier als Zeile ergänzen. Status: 🔵 Recherche · 🟡 in Arbeit · 🟢 lauffähig · ⚪ pausiert -->

## Aufbau des Repos

```
reverse/
├── README.md                 ← diese Übersicht (Projekttabelle pflegen!)
├── .mcp.json                 ← REA als MCP-Server für Claude Code (rea-agents@5.0.0)
├── .claude/skills/           ← REA-Skill: Arbeitsweise fürs Reverse Engineering
├── .github/workflows/        ← CI pro Projekt: <projekt>-*.yml, läuft nur bei Änderungen im Projektordner
├── templates/project/        ← Vorlage für neue Projekte (README.md + RESEARCH.md)
└── projects/
    └── mad-studio/           ← DAW im Stil von FL Studio für macOS
```

Konventionen:

- **Ordnername** = Projektname in `kebab-case` (z. B. `projects/mad-studio`).
- Jedes Projekt hat eine **`README.md`** (Ziel, Stand, Bedienung, Entwicklung) und eine
  **`RESEARCH.md`** (Quellen, Befunde, offene Fragen – getrennt nach Beobachtung,
  Schlussfolgerung und Unbekanntem).
- **Analyse-Ziele** (fremde Apps, Installer, Binärdateien) gehören nach
  `projects/<name>/targets/` – dieser Ordner wird per `.gitignore` nie committet.
- CI-Workflows heissen `<projekt>-<zweck>.yml` und filtern per `paths:` auf ihren Projektordner.

## Neues Projekt anlegen

1. Vorlage kopieren: `cp -r templates/project projects/<name>`
2. In `README.md` und `RESEARCH.md` alle `<Platzhalter>` ausfüllen (Vorbild, Ziel, Status).
3. Analyse-Ziele nach `projects/<name>/targets/` legen (wird ignoriert).
4. Zeile in der Projekttabelle oben ergänzen.
5. Optional CI: `.github/workflows/mad-studio-ci.yml` kopieren, Namen, `paths:` und
   `working-directory` anpassen.

## REA verwenden

[REA – Reverse Engineer Anything](https://github.com/morluto/rea) ist für dieses Repo vorkonfiguriert:

- **`.mcp.json`** registriert den REA-MCP-Server (`npx -y rea-agents@5.0.0 mcp`). Claude Code
  fragt beim ersten Öffnen des Repos, ob der Server aktiviert werden soll.
- **`.claude/skills/reverse-engineer-anything/`** enthält den passenden REA-Skill
  (unverändert aus dem npm-Paket, MIT-Lizenz, siehe `SOURCE.md`).
- **Statische JavaScript/Electron-Analyse** braucht keine Zusatzsoftware:
  `npx -y rea-agents@5.0.0 analyze-javascript-application /pfad/zur/app.asar --json`
- **Beispiel:** REA hat das ausgelieferte Paket von MAD Studio auf Electron-Sicherheit geprüft –
  Ergebnisse und Evidence-IDs in [`projects/mad-studio/RESEARCH.md`](projects/mad-studio/RESEARCH.md).
- **Grosse Ziele:** Der MCP-Aufruf hat in Claude Code ein 60-s-Limit. Für grosse Bundles die CLI
  verwenden (siehe Beispiel oben) oder gezielt einen Teil des Pakets analysieren.
- **Native Binärdateien** (Mach-O, PE, ELF) brauchen Hopper, Ghidra oder IDA:
  `npx -y rea-agents@5.0.0 doctor` zeigt, was fehlt; `npx -y rea-agents@5.0.0 setup`
  richtet REA für deine Agents ein (mit Vorschau vor jeder Änderung).
