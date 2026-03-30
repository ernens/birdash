# 🐦 Birdash

[![MIT License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

Modernes Vogelerkennungs-Dashboard und Engine fur Raspberry Pi 5. Ersetzt [BirdNET-Pi](https://github.com/Nachtzuster/BirdNET-Pi) mit einer schnelleren Dual-Modell-Architektur.

> [English](README.md) | [Francais](README.fr.md) | [Nederlands](README.nl.md)

## Funktionen

- 🤖 **Dual-Modell-Inferenz** — BirdNET V2.4 + Perch V2 INT8 parallel
- 🎵 **Live-Spektrogramm** — Echtzeit-Audio mit Vogelnamen
- 🔍 **Erkennungsuberprufung** — Auto-Flagging + Massenaktionen
- 🤖 **Modellvergleich** — Seite-an-Seite-Analyse
- 🎙️ **Audiokonfiguration** — Gerat, Profile, Kalibrierung
- 🔔 **Intelligente Benachrichtigungen** — nur seltene Arten (ntfy.sh)
- 📡 **BirdWeather** — automatischer Upload
- 💻 **Web-Terminal** — Bash im Browser, unterstutzt Claude Code
- 💾 **Backup** — NFS/SMB/SFTP/S3/GDrive/WebDAV
- 🌍 4 UI-Sprachen (FR/EN/NL/DE) + 36 Sprachen fur Artnamen

## Quantisiertes Modell

**[ernensbjorn/perch-v2-int8-tflite](https://huggingface.co/ernensbjorn/perch-v2-int8-tflite)** auf HuggingFace

Siehe [README.md](README.md) fur Installationsanweisungen.

## Lizenz

[MIT](LICENSE)
