#!/bin/zsh
set -e
cd "$(dirname "$0")"
VOICE_PROJECT="$(cd ../.. && pwd)"
if [[ ! -x "$VOICE_PROJECT/Sprachlabor/.venv/bin/python" ]]; then
  print 'Bitte zuerst Sprachlabor/Einrichten.command ausführen.'
  read '?Enter zum Schließen …'; exit 1
fi
"$VOICE_PROJECT/Sprachlabor/.venv/bin/python" -m pip install 'piper-tts==1.8.0'
node download-model.mjs
print 'Lokale Stimme eingerichtet. ALFRED danach neu starten.'
read '?Enter zum Schließen …'
