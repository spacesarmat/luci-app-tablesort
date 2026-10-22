# Tests

The fixture is synthetic. Group names are `group_a` and `group_b`, node names are `Relay N` and `Backup N`, and addresses are RFC 5737 documentation ranges (`192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24`). Nothing here is copied from a router.

`fixtures/sample.json` is the node list. `server.py` renders a small Passwall2-shaped page from it, serves `tablesort.js` from the package, and answers ping requests with the ping values in the fixture (including empty values, which the page shows as `Timeout`, and `1500`, which the page shows as `1.5 s`). `fixtures/page.js` supplies the page behavior the sorter calls: `set_order`, To Top, drag-and-drop, group tabs, automatic ping, manual TCPing, and the Reassign Group dialog.

## Hook script

From the repository root:

```sh
sh tests/test-hook.sh
python3 tests/check_public.py
```

`test-hook.sh` points `luci-tablesort-hook` at a temporary footer and checks apply, a second apply, status, and remove.

## Browser

```sh
python3 -m pip install -r tests/requirements.txt
python3 -m playwright install chromium   # skip when /usr/bin/google-chrome exists
python3 tests/test.py en ru
```

`test.py` starts `server.py` on `127.0.0.1:8765` when that port is free. It checks header enhancement, waiting while automatic ping is still running, numeric Ping ascending and descending with Timeout last (including a seconds value), the title row staying first, `group.order.<group>` matching the DOM, stable row-to-ping mapping, natural name order, address order, restore, To Top, drag-and-drop, sorting a second group without touching the first, manual TCPing, the Reassign Group dialog, and a Save & Apply post of the sorted order. Pass `en`, `ru`, or both.
