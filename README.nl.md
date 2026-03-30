# 🐦 Birdash

[![MIT License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

Modern vogeldetectie-dashboard en engine voor Raspberry Pi 5. Vervangt [BirdNET-Pi](https://github.com/Nachtzuster/BirdNET-Pi) met een snellere dual-model architectuur.

> [English](README.md) | [Francais](README.fr.md) | [Deutsch](README.de.md)

## Kenmerken

- 🤖 **Dual-model inferentie** — BirdNET V2.4 + Perch V2 INT8 parallel
- 🎵 **Live spectrogram** — real-time audio met vogelnamen
- 🔍 **Detectie review** — auto-flagging + bulk acties
- 🤖 **Model vergelijking** — zij-aan-zij analyse
- 🎙️ **Audio configuratie** — apparaat, profielen, kalibratie
- 🔔 **Slimme meldingen** — alleen zeldzame soorten (ntfy.sh)
- 📡 **BirdWeather** — automatische upload
- 💻 **Web terminal** — bash in browser, ondersteunt Claude Code
- 💾 **Backup** — NFS/SMB/SFTP/S3/GDrive/WebDAV
- 🌍 4 UI-talen (FR/EN/NL/DE) + 36 talen voor soortnamen

## Gekwantiseerd model

**[ernensbjorn/perch-v2-int8-tflite](https://huggingface.co/ernensbjorn/perch-v2-int8-tflite)** op HuggingFace

Zie [README.md](README.md) voor installatie-instructies.

## Licentie

[MIT](LICENSE)
