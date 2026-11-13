#!/bin/bash
# Checks a tree for personal details before it is published: run it before every push of a public copy.
#
#   scripts/scrub-check.sh [folder]     the folder to check (default: this repository's tracked files)
#
# It looks for:
#   - every term in the state folder's scrub-terms.txt (one per line, whole words, case ignored, # for comments):
#     your name, user names, project names, old names. The list stays private: it is never in the repository.
#   - your home folder's path and your login name
#   - git's user.name and user.email on this Mac
#   - any email address, except example ones
# Files you mean to carry your name (a LICENSE line) go in the state folder's scrub-allow.txt, one path per line:
# the word list isn't checked in them, the email and home-folder checks still are.
# Exit 0 when nothing is found, 1 with every hit listed otherwise.
set -uo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
DIR="$(cd "${1:-$REPO}" 2>/dev/null && pwd)" || { echo "scrub-check: no such folder: ${1:-}" >&2; exit 2; }
STATE="${OBERTH_STATE_DIR:-$HOME/Library/Application Support/oberth}"
TERMS="$STATE/scrub-terms.txt"
ALLOW="$STATE/scrub-allow.txt"
allowed() { [ -f "$ALLOW" ] && grep -v '^\s*#' "$ALLOW" | grep -qxF -- "$1"; }

files() {
  if git -C "$DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    git -C "$DIR" ls-files -z --cached --others --exclude-standard
  else
    (cd "$DIR" && find . -type f -not -path './.git/*' -not -path './node_modules/*' -print0)
  fi
}

LIST="$(mktemp)"; trap 'rm -f "$LIST" "$LIST.terms" "$LIST.home"' EXIT
{ [ -f "$TERMS" ] && grep -v '^\s*#' "$TERMS" | sed '/^\s*$/d'
  echo "$HOME"; whoami
  git config --global user.name 2>/dev/null; git config --global user.email 2>/dev/null
} | sort -u > "$LIST.terms"
echo "$HOME" > "$LIST.home"
[ -f "$TERMS" ] || echo "note: no $TERMS, so only the built-in checks ran" >&2

found=0
cd "$DIR" || exit 2
while IFS= read -r -d '' f; do
  f="${f#./}"
  [ -f "$f" ] || continue
  # names and terms, as whole words (a path counts whole too); allowed files only get the home-folder check
  if allowed "$f"; then terms="$LIST.home"; else terms="$LIST.terms"; fi
  if out="$(grep -I -n -i -w -F -f "$terms" -- "$f" 2>/dev/null)"; then
    echo "$out" | sed "s#^#$f:#"; found=1
  fi
  # a term in a file's own path
  if echo "$f" | grep -q -i -w -F -f "$LIST.terms"; then echo "$f: (in the file's path)"; found=1; fi
  # email addresses, other than example ones
  if out="$(grep -I -n -o -E '[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}' -- "$f" 2>/dev/null | grep -v -i -E ':git@|@(example\.(com|org|net)|users\.noreply\.github\.com)$')"; then
    echo "$out" | sed "s#^#$f:email:#"; found=1
  fi
done < <(files)

if [ "$found" = 0 ]; then echo "scrub-check: nothing personal found in $DIR"; else echo "scrub-check: personal details found (above)" >&2; fi
exit "$found"
