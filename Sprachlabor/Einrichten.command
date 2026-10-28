#!/bin/zsh
set -e
cd "$(dirname "$0")"
python3 -c 'import sys; assert sys.version_info[:2] == (3,11), "Bitte für diesen geprüften Prototyp Python 3.11 verwenden."'
[[ -x .venv/bin/python ]] || python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-lock.txt
print 'Sprachlabor eingerichtet. Jetzt den Starter im übergeordneten Ordner verwenden.'
read '?Enter zum Schließen …'
