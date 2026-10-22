#!/usr/bin/env bash
# Build luci-app-tablesort with an official OpenWrt SDK tarball.
# Usage: .github/build-sdk.sh <release> <apk|ipk>
# Example: .github/build-sdk.sh 25.12.6 apk
set -euo pipefail

REL="${1:?OpenWrt release, for example 25.12.6}"
EXT="${2:?apk or ipk}"
case "$EXT" in
  apk|ipk) ;;
  *) echo "extension must be apk or ipk" >&2; exit 2 ;;
esac

ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
WORKDIR="${WORKDIR:-/tmp/owrt-sdk-$REL}"
DIST="$ROOT/dist"
mkdir -p "$DIST" "$WORKDIR"

need() {
  command -v "$1" >/dev/null 2>&1 || { echo "missing command: $1" >&2; exit 1; }
}
need curl
need tar
need zstd
need make
need gcc
need git
need perl
need python3
need rsync

SUMS="$WORKDIR/sha256sums"
if [ ! -s "$SUMS" ]; then
  curl -fL --retry 3 -o "$SUMS" "https://downloads.openwrt.org/releases/${REL}/targets/x86/64/sha256sums"
fi

SDK_NAME=$(awk '/openwrt-sdk-.*Linux-x86_64\.tar\.zst$/ { print $2; exit }' "$SUMS")
SDK_NAME=${SDK_NAME#\*}
SDK_HASH=$(awk '/openwrt-sdk-.*Linux-x86_64\.tar\.zst$/ { print $1; exit }' "$SUMS")
if [ -z "$SDK_NAME" ] || [ -z "$SDK_HASH" ]; then
  echo "SDK tarball not listed in sha256sums for $REL" >&2
  exit 1
fi

ARCHIVE="$WORKDIR/$SDK_NAME"
if [ ! -s "$ARCHIVE" ]; then
  curl -fL --retry 3 -o "$ARCHIVE" "https://downloads.openwrt.org/releases/${REL}/targets/x86/64/${SDK_NAME}"
fi
echo "$SDK_HASH  $ARCHIVE" | sha256sum -c -

SDKDIR=$(find "$WORKDIR" -mindepth 1 -maxdepth 1 -type d -name 'openwrt-sdk-*' | head -1 || true)
if [ -z "$SDKDIR" ]; then
  tar --zstd -xf "$ARCHIVE" -C "$WORKDIR"
  SDKDIR=$(find "$WORKDIR" -mindepth 1 -maxdepth 1 -type d -name 'openwrt-sdk-*' | head -1)
fi
if [ ! -x "$SDKDIR/scripts/feeds" ]; then
  echo "SDK extract did not produce scripts/feeds" >&2
  exit 1
fi

cd "$SDKDIR"
# Official SDK pins feed commits. Rewrite git.openwrt.org to GitHub, same as
# openwrt/gh-action-sdk, and add this repository as a feed.
sed \
  -e 's,https://git.openwrt.org/feed/,https://github.com/openwrt/,' \
  -e 's,https://git.openwrt.org/openwrt/,https://github.com/openwrt/,' \
  -e 's,https://git.openwrt.org/project/,https://github.com/openwrt/,' \
  feeds.conf.default > feeds.conf
echo "src-link tablesort $ROOT" >> feeds.conf
echo "---- feeds.conf ----"
cat feeds.conf

# The package is arch-all and has no host build tools, so the big feeds stay
# untouched. src-link does not clone anything. Drop other feed links and the
# package index so a re-run cannot build leftover LuCI packages.
rm -rf package/feeds/luci package/feeds/packages package/feeds/routing package/feeds/telephony package/feeds/video tmp
./scripts/feeds update tablesort
./scripts/feeds install -p tablesort -f luci-app-tablesort

if [ ! -f .config ]; then
  make defconfig
fi
if ! grep -q '^CONFIG_PACKAGE_luci-app-tablesort=m' .config; then
  echo 'CONFIG_PACKAGE_luci-app-tablesort=m' >> .config
fi
if grep -q '^CONFIG_SIGNED_PACKAGES=y' .config; then
  sed -i 's/^CONFIG_SIGNED_PACKAGES=y/# CONFIG_SIGNED_PACKAGES is not set/' .config
fi
make defconfig

make package/luci-app-tablesort/clean V=s || true
if ! make package/luci-app-tablesort/compile -j"$(nproc)" V=s; then
  echo "parallel compile failed, retrying with -j1" >&2
  make package/luci-app-tablesort/compile -j1 V=s
fi

rm -f "$DIST"/luci-app-tablesort*."$EXT"
found=0
while IFS= read -r pkg; do
  cp -v "$pkg" "$DIST/"
  found=1
done < <(find bin -type f -name "luci-app-tablesort*.${EXT}" | sort)
if [ "$found" -ne 1 ]; then
  echo "expected luci-app-tablesort *.${EXT} under bin/" >&2
  find bin -type f | head -200 >&2 || true
  exit 1
fi

python3 - "$DIST" "$EXT" <<'PY'
import io, pathlib, subprocess, sys, tarfile, tempfile, zlib
dist = pathlib.Path(sys.argv[1])
ext = sys.argv[2]
packages = sorted(dist.glob('luci-app-tablesort*.' + ext))
if len(packages) != 1:
    raise SystemExit('dist has %d %s files' % (len(packages), ext))
pkg = packages[0]
blob = pkg.read_bytes()
text = ''
apk_bin = pathlib.Path('staging_dir/host/bin/apk')
if blob.startswith(b'ADBd') and apk_bin.is_file():
    with tempfile.TemporaryDirectory() as tmp:
        idx = pathlib.Path(tmp) / 'index.adb'
        subprocess.check_call(
            [str(apk_bin), '--allow-untrusted', 'mkndx', '-o', str(idx), str(pkg)],
            stdout=subprocess.DEVNULL)
        text = zlib.decompress(idx.read_bytes()[4:], -15).decode('latin1', 'replace')
        out = pathlib.Path(tmp) / 'files'
        out.mkdir()
        subprocess.check_call(
            [str(apk_bin), '--allow-untrusted', 'extract', '--destination', str(out), str(pkg)],
            stdout=subprocess.DEVNULL)
        js = out / 'www/luci-static/resources/tablesort.js'
        hook = out / 'usr/sbin/luci-tablesort-hook'
        if not js.is_file() or not hook.is_file():
            raise SystemExit('apk is missing tablesort.js or the hook')
        if not hook.stat().st_mode & 0o111:
            raise SystemExit('hook is not executable')
else:
    def open_tar(raw):
        return tarfile.open(fileobj=io.BytesIO(raw), mode='r:*')

    def control_and_data(raw):
        try:
            with open_tar(raw) as tar:
                names = tar.getnames()
                control_name = next((n for n in names if n.endswith('control.tar.gz')), None)
                data_name = next((n for n in names if n.endswith('data.tar.gz')), None)
                if control_name:
                    control_blob = tar.extractfile(control_name).read()
                    data_blob = tar.extractfile(data_name).read() if data_name else b''
                    return control_blob, data_blob
                for name in names:
                    if name.endswith('.PKGINFO') or name.endswith('/control') or name.rsplit('/', 1)[-1] == 'control':
                        member = tar.extractfile(name)
                        if member is not None:
                            text_box.append(member.read().decode('utf-8', 'replace'))
                return b'', b''
        except tarfile.TarError:
            control_blob = subprocess.check_output(['ar', 'p', str(pkg), 'control.tar.gz'])
            data_blob = subprocess.check_output(['ar', 'p', str(pkg), 'data.tar.gz'])
            return control_blob, data_blob

    text_box = []
    control_blob, data_blob = control_and_data(blob)
    if control_blob:
        with open_tar(control_blob) as ctar:
            for name in ctar.getnames():
                if name.rsplit('/', 1)[-1] == 'control':
                    text_box.append(ctar.extractfile(name).read().decode('utf-8', 'replace'))
    if data_blob:
        with open_tar(data_blob) as dtar:
            js = hook = None
            for member in dtar.getmembers():
                if member.name.endswith('www/luci-static/resources/tablesort.js'):
                    js = member
                if member.name.endswith('usr/sbin/luci-tablesort-hook'):
                    hook = member
            if js is None or hook is None:
                raise SystemExit('ipk is missing tablesort.js or the hook')
            if not hook.mode & 0o111:
                raise SystemExit('hook is not executable')
    text = '\n'.join(text_box)
if not text:
    raise SystemExit('no control metadata in %s' % pkg.name)
print('---- %s ----' % pkg.name)
print(text)
low = text.lower()
if not any(token in low for token in ('architecture: all', 'arch = all', 'arch: all', 'architecture: noarch', 'arch = noarch', 'arch: noarch', 'noarch')):
    raise SystemExit('package is not architecture-independent (expected all or noarch)')
if 'luci-compat' not in low:
    raise SystemExit('package does not depend on luci-compat')
print('package ok:', pkg.name)
PY

echo "built:"
ls -l "$DIST"/luci-app-tablesort*."$EXT"
