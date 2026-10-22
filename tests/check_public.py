#!/usr/bin/env python3
"""Fail if the tree contains an em dash, the private fixture name, or a non-documentation IP."""
import ipaddress
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
SKIP = {'.git', '__pycache__', 'dist', 'node_modules'}
EM = '\u2014'
EN = '\u2013'
IP_RE = re.compile(r'\b(?:\d{1,3}\.){3}\d{1,3}\b')
ALLOWED = [
    ipaddress.ip_network('192.0.2.0/24'),
    ipaddress.ip_network('198.51.100.0/24'),
    ipaddress.ip_network('203.0.113.0/24'),
    ipaddress.ip_network('127.0.0.0/8'),
    ipaddress.ip_network('0.0.0.0/32'),
]

problems = []
for path in ROOT.rglob('*'):
    if not path.is_file():
        continue
    if any(part in SKIP for part in path.parts):
        continue
    if path.suffix in {'.png', '.apk', '.ipk', '.zst', '.gz'}:
        continue
    text = path.read_bytes().decode('utf-8', errors='replace')
    rel = path.relative_to(ROOT).as_posix()
    if EM in text or EN in text:
        problems.append('%s contains an em dash or en dash' % rel)
    private_group = 'QUA' + 'TTRO'
    if re.search(private_group, text, re.I):
        problems.append('%s contains a private group name' % rel)
    for match in IP_RE.findall(text):
        try:
            addr = ipaddress.ip_address(match)
        except ValueError:
            continue
        if not any(addr in net for net in ALLOWED):
            problems.append('%s has non-documentation IP %s' % (rel, match))

if problems:
    print('\n'.join(problems))
    sys.exit(1)
print('public-content check ok')
