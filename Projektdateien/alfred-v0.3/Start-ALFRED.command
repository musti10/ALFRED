#!/bin/zsh
cd -- "${0:A:h}" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null; then
  echo 'Node.js 24 fehlt. Bitte Node.js installieren.'
  read '?Enter zum Schließen …'; exit 1
fi
if [[ "$(node -p 'process.versions.node.split(".")[0]')" != 24 ]]; then
  echo 'Bitte Node.js 24 verwenden.'
  read '?Enter zum Schließen …'; exit 1
fi
alfred_port="${PORT:-3210}"
if ! node -e 'const n=Number(process.argv[1]);process.exit(Number.isInteger(n)&&n>=1024&&n<=65535?0:1)' "$alfred_port"; then
  echo 'Der Port muss zwischen 1024 und 65535 liegen.'
  read '?Enter zum Schließen …'; exit 1
fi
alfred_url="http://127.0.0.1:$alfred_port"
alfred_ready() {
  local response
  response=$(/usr/bin/curl --silent --fail --max-time 1 "$alfred_url/api/info") || return 1
  [[ "$response" == *'"app":"alfred-local"'* ]]
}
if alfred_ready; then
  echo "ALFRED läuft bereits: $alfred_url"
  /usr/bin/open "$alfred_url"
  echo 'Zum Beenden das ursprüngliche ALFRED-Terminal verwenden.'
  read '?Enter zum Schließen dieses Fensters …'; exit 0
fi
echo 'ALFRED startet … Zum Beenden hier Ctrl+C drücken.'
node server.ts &
alfred_pid=$!
trap 'kill "$alfred_pid" 2>/dev/null' EXIT
trap 'exit 0' INT TERM
for attempt in {1..40}; do
  if alfred_ready; then
    /usr/bin/open "$alfred_url"
    break
  fi
  if ! kill -0 "$alfred_pid" 2>/dev/null; then break; fi
  /bin/sleep 0.25
done
wait "$alfred_pid"
read '?ALFRED beendet. Enter zum Schließen …'
