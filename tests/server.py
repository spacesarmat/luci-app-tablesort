#!/usr/bin/env python3
"""Fixture server for the tablesort browser tests.

Serves a synthetic Passwall2 node list built from fixtures/sample.json, the
real tablesort.js from the package, and deterministic ping replies. Addresses
in the fixture are RFC 5737 documentation ranges.
"""
import json
import os
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

BASE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(BASE)
JS = os.path.join(ROOT, 'luci-app-tablesort', 'htdocs', 'luci-static', 'resources', 'tablesort.js')
PAGE_JS = os.path.join(BASE, 'fixtures', 'page.js')
SAMPLE_PATH = os.path.join(BASE, 'fixtures', 'sample.json')
POSTS = os.path.join(BASE, 'posts.bin')

with open(SAMPLE_PATH, encoding='utf-8') as fh:
    SAMPLE = json.load(fh)

PINGS = {}
for group in SAMPLE['groups']:
    for node in group['nodes']:
        PINGS[node['id']] = node.get('ping', '')


def esc(value):
    return (str(value)
            .replace('&', '&amp;')
            .replace('<', '&lt;')
            .replace('>', '&gt;')
            .replace('"', '&quot;'))


def render_page():
    tabs = []
    blocks = []
    for group in SAMPLE['groups']:
        gid = group['id']
        tabs.append(
            '<li group_name="%s"><a href="#">%s</a></li>' % (esc(gid), esc(group['label']))
        )
        rows = []
        ids = []
        for index, node in enumerate(group['nodes']):
            nid = node['id']
            ids.append(nid)
            style = 'cbi-rowstyle-%d' % (index % 2 + 1)
            rows.append(
                '<tr id="cbi-passwall2-%s" class="cbi-section-table-row %s">'
                '<td><input type="checkbox" class="nodes_select"></td>'
                '<td class="pw-remark">'
                '<input id="cbid.passwall2.%s.remarks" value="%s">'
                '<input type="hidden" id="cbid.passwall2.%s.address" value="%s">'
                '<input type="hidden" id="cbid.passwall2.%s.port" value="%s">'
                '<span class="proto">%s: %s</span>'
                '</td>'
                '<td class="pw-ping"><span class="ping_value" cbiid="%s">---</span></td>'
                '<td class="pw-tcping"><span class="tcping_value" cbiid="%s">---</span> '
                '<a class="tcping-test" href="#" data-id="%s">Test</a></td>'
                '<td class="pw-urltest"><span class="urltest_value" cbiid="%s">---</span></td>'
                '<td class="cbi-section-actions">'
                '<input type="button" value="To Top" onclick="row_top(this)"> '
                '<span class="drag-handle" title="Drag">::</span>'
                '</td></tr>' % (
                    esc(nid), style,
                    esc(nid), esc(node['remarks']),
                    esc(nid), esc(node['address']),
                    esc(nid), esc(node['port']),
                    esc(node['type']), esc(node['remarks']),
                    esc(nid), esc(nid), esc(nid), esc(nid),
                )
            )
        blocks.append(
            '<fieldset id="cbi-passwall2-nodes-%s-fieldset" data-ts-group="%s">'
            '<legend>%s</legend>'
            '<input type="hidden" name="group.order.%s" value="%s">'
            '<table class="cbi-section-table" id="cbi-passwall2-nodes-%s-table"><tbody>'
            '<tr class="cbi-section-table-titles">'
            '<th></th>'
            '<th class="pw-remark">Remarks</th>'
            '<th class="pw-ping">Ping</th>'
            '<th class="pw-tcping">TCPing</th>'
            '<th class="pw-urltest">URL Test</th>'
            '<th class="cbi-section-actions"></th>'
            '</tr>%s</tbody></table></fieldset>' % (
                esc(gid), esc(gid), esc(group['label']),
                esc(gid), esc(' '.join(ids)),
                esc(gid), ''.join(rows),
            )
        )
    return '''<!DOCTYPE html>
<html lang="en" >
<head>
<meta charset="utf-8">
<title>Passwall2 node list sample</title>
<style>
body { font: 14px/1.4 sans-serif; margin: 16px; }
table { border-collapse: collapse; }
td, th { border: 1px solid #ccc; padding: 4px 8px; vertical-align: top; }
.drag-handle { cursor: grab; display: inline-block; padding: 2px 6px; }
ul.tabs { list-style: none; padding: 0; display: flex; gap: 12px; }
ul.tabs a { cursor: pointer; }
#reassign_group_div { margin: 8px 0; padding: 8px; border: 1px solid #888; }
</style>
</head>
<body>
<form name="cbi" method="post" action="/cgi-bin/luci/admin/services/passwall2/node_list">
<h1>Node list sample</h1>
<ul class="tabs">%s</ul>
<div id="node_list">%s</div>
<div id="reassign_group_div" style="display:none">Reassign group (sample)</div>
<p><input type="submit" name="cbi.apply" value="Save &amp; Apply"></p>
</form>
<script src="/fixtures/page.js"></script>
<script src="/luci-static/resources/tablesort.js?v=1"></script>
</body>
</html>
''' % (''.join(tabs), ''.join(blocks))


PAGE = render_page().encode('utf-8')


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        return

    def send_body(self, code, body, content_type='text/html; charset=utf-8'):
        if isinstance(body, str):
            body = body.encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def route(self, method):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        if path.startswith('/luci-static/resources/tablesort.js'):
            with open(JS, 'rb') as fh:
                return self.send_body(200, fh.read(), 'application/javascript')
        if path.startswith('/fixtures/page.js'):
            with open(PAGE_JS, 'rb') as fh:
                return self.send_body(200, fh.read(), 'application/javascript')
        if path.endswith('/passwall2/node_list'):
            if method == 'POST':
                length = int(self.headers.get('Content-Length', '0'))
                data = self.rfile.read(length)
                with open(POSTS, 'ab') as fh:
                    fh.write(data + b'\n=====\n')
                return self.send_body(200, '<html><body>saved</body></html>')
            return self.send_body(200, PAGE)
        if path.endswith('/ping_node'):
            qs = urllib.parse.parse_qs(parsed.query)
            node_id = qs.get('id', [''])[0]
            if 'slow' in qs:
                time.sleep(2.5)
            ping = PINGS.get(node_id, '42')
            return self.send_body(200, json.dumps({'ping': ping}), 'application/json')
        if path.endswith('/urltest_node'):
            return self.send_body(200, json.dumps({'use_time': '120'}), 'application/json')
        if path.endswith('/get_node'):
            return self.send_body(200, json.dumps(SAMPLE), 'application/json')
        if path.endswith('/get_now_use_node'):
            return self.send_body(200, json.dumps({'global': ''}), 'application/json')
        if '/translations/' in path:
            return self.send_body(200, '', 'application/javascript')
        return self.send_body(200, '{}', 'application/json')

    def do_GET(self):
        self.route('GET')

    def do_POST(self):
        self.route('POST')


def main():
    server = ThreadingHTTPServer(('127.0.0.1', 8765), Handler)
    server.serve_forever()


if __name__ == '__main__':
    main()
