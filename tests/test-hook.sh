#!/bin/sh
# Apply, re-apply, status, and remove the footer hook against a temp file.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
HOOK="$ROOT/luci-app-tablesort/root/usr/sbin/luci-tablesort-hook"
INIT="$ROOT/luci-app-tablesort/root/etc/init.d/luci-tablesort"
DEFAULTS="$ROOT/luci-app-tablesort/root/etc/uci-defaults/90-luci-tablesort"

sh -n "$HOOK"
sh -n "$DEFAULTS"
sh -n "$INIT"

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
JS="$TMP/tablesort.js"
FOOT="$TMP/footer.htm"
printf '%s\n' '// sample' > "$JS"

fail() { echo "FAIL $1" >&2; exit 1; }
pass() { echo "PASS $1"; }

export TABLESORT_JS="$JS"
export TABLESORT_FOOTER="$FOOT"

printf '%s\n' 'header' '<%+footer%>' 'tail' > "$FOOT"
out=$("$HOOK" apply)
echo "$out" | grep -q 'hook added' || fail "apply message: $out"
grep -q 'luci-app-tablesort' "$FOOT" || fail 'mark missing after apply'
prev=$(awk 'NR > 1 && $0 == "<%+footer%>" { print prev } { prev = $0 }' "$FOOT")
echo "$prev" | grep -q 'luci-app-tablesort' || fail "hook is not directly above footer: $prev"
pass 'apply inserts the include before footer'

out=$("$HOOK" apply)
echo "$out" | grep -q 'already present' || fail "second apply: $out"
pass 'apply is idempotent'

printf '%s\n' 'header' '<script src="<%=resource%>/tablesort.js?v=1"></script><!-- luci-app-tablesort -->' '<%+footer%>' 'tail' > "$TMP/old.htm"
TABLESORT_FOOTER="$TMP/old.htm" "$HOOK" apply | grep -q 'hook added' || fail 'upgrade from an older hook line'
[ "$(grep -c 'luci-app-tablesort' "$TMP/old.htm")" = 1 ] || fail 'old hook line not replaced'
grep -q 'tablesort.js?v=1.1.0' "$TMP/old.htm" || fail 'new version not in hook line'
pass 'apply replaces an older hook line'

out=$("$HOOK" status)
echo "$out" | grep -q 'hook: present' || fail "status present: $out"
echo "$out" | grep -q "js: $JS" || fail "status js: $out"
pass 'status reports the hook and the js file'

out=$("$HOOK" remove)
echo "$out" | grep -q 'hook removed' || fail "remove: $out"
if grep -q 'luci-app-tablesort' "$FOOT"; then fail 'mark still present'; fi
out=$("$HOOK" status)
echo "$out" | grep -q 'hook: absent' || fail "status absent: $out"
pass 'remove deletes the include'

printf '%s\n' 'no anchor here' > "$FOOT"
if "$HOOK" apply >/dev/null 2>&1; then fail 'missing anchor should fail'; fi
pass 'missing anchor is an error'

rm -f "$JS"
printf '%s\n' '<%+footer%>' > "$FOOT"
if "$HOOK" apply >/dev/null 2>&1; then fail 'missing js should fail'; fi
pass 'missing js is an error'

export TABLESORT_JS="$ROOT/luci-app-tablesort/htdocs/luci-static/resources/tablesort.js"
export TABLESORT_FOOTER="$TMP/missing-footer.htm"
out=$("$HOOK" apply)
echo "$out" | grep -q 'nothing to do' || fail "missing footer: $out"
pass 'missing footer is a no-op'

echo 'hook tests ok'
