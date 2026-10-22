#!/usr/bin/env python3
"""Playwright checks for the filter bar (1.1.0) against the synthetic fixtures."""
import asyncio
import collections
import os
import re
import sys
import urllib.parse

from playwright.async_api import async_playwright

import test as base

ROOT = base.ROOT
URL = base.URL
GEN_URL = 'http://127.0.0.1:8765/cgi-bin/luci/admin/network/generic_sample'
POSTS = base.POSTS
SAMPLE = base.SAMPLE
GA = base.GROUP_A
NODES = {n['id']: n for g in SAMPLE['groups'] for n in g['nodes']}
ok = base.ok
res = base.res

STATE = '''(tid)=>{const t=document.getElementById(tid);
 return [...t.querySelector("tbody").children].filter(r=>r.classList.contains("cbi-section-table-row")).map(r=>({
  id:r.id.replace(/^cbi-[a-z0-9]+-/,""), hidden:r.classList.contains("ts-hidden"), disp:getComputedStyle(r).display,
  ping:((r.querySelector("td.pw-ping")||{}).textContent||"").trim(), cls:r.className,
  chk:!!(r.querySelector("input.nodes_select")||{}).checked}));}'''


async def options(page, tid, key):
    return await page.evaluate(
        '([t,k])=>{const s=document.querySelector("#ts-filter-"+CSS.escape(t)+" select[data-ts-filter=\\""+k+"\\"]");'
        'return s?[...s.options].map(o=>[o.value,o.textContent]):null}', [tid, key])


async def choose(page, tid, key, value):
    await page.evaluate(
        '([t,k,v])=>{const s=document.querySelector("#ts-filter-"+CSS.escape(t)+" select[data-ts-filter=\\""+k+"\\"]");'
        's.value=v;s.dispatchEvent(new Event("change",{bubbles:true}));}', [tid, key, value])
    await page.wait_for_timeout(150)


def split_opt(text):
    label, _, n = text.rpartition(' (')
    return label, int(n.rstrip(')'))


def striped(rows):
    vis = [r for r in rows if not r['hidden']]
    return all(('cbi-rowstyle-%d' % (i % 2 + 1)) in r['cls'] for i, r in enumerate(vis))


async def node_list(browser, lang):
    page = await browser.new_page(viewport={'width': 1600, 'height': 1000})
    errs = []
    page.on('pageerror', lambda err: errs.append(str(err)))
    if lang == 'ru':
        async def fulfill_ru(route):
            response = await route.fetch()
            body = (await response.body()).decode('utf-8').replace('<html lang="en" >', '<html lang="ru" >', 1)
            await route.fulfill(body=body, content_type='text/html; charset=utf-8')
        await page.route('**/node_list', fulfill_ru)
    await page.goto(URL)
    tid = 'cbi-passwall2-nodes-%s-table' % GA
    await page.wait_for_selector('#ts-filter-' + tid, state='attached', timeout=20000)
    await page.click('li[group_name="%s"] a' % GA)
    await page.wait_for_function('()=>!(window.ajax&&ajax.list.some(x=>x.readyState>0&&x.readyState<4))', timeout=60000)
    await page.wait_for_timeout(300)
    rows = await page.evaluate(STATE, tid)
    total = len(rows)
    want = collections.Counter(NODES[r['id']]['type'] for r in rows)
    opts = await options(page, tid, 'type')
    got = dict(split_opt(t) for _v, t in opts[1:])
    ok(lang + ': type options built from the rows (with counts)', got == dict(want), got)
    ok(lang + ': "all" option shows the row count', opts[0][0] == '' and split_opt(opts[0][1])[1] == total)
    label_all = split_opt(opts[0][1])[0]
    ok(lang + ': labels in the page language', label_all == ('Все' if lang == 'ru' else 'All'), label_all)

    pick = max(opts[1:], key=lambda o: split_opt(o[1])[1])
    plabel, pn = split_opt(pick[1])
    await choose(page, tid, 'type', pick[0])
    rows = await page.evaluate(STATE, tid)
    vis = [r for r in rows if not r['hidden']]
    ok(lang + ': type filter shows only matching rows',
       len(vis) == pn and all(NODES[r['id']]['type'] == plabel for r in vis), (len(vis), pn))
    ok(lang + ': hidden rows stay in the DOM with display none',
       len(rows) == total and all(r['disp'] == 'none' for r in rows if r['hidden']))
    ok(lang + ': visible rows restriped', striped(rows))
    count = await page.inner_text('#ts-filter-%s .ts-count' % tid)
    ok(lang + ': shown count', re.search(r'\b%d\b.*\b%d\b' % (pn, total), count) is not None, count)

    await page.click('#%s th[data-ts-sort="ping"]' % tid, position={'x': 5, 'y': 5})
    await page.wait_for_timeout(400)
    rows = await page.evaluate(STATE, tid)
    vis = [r for r in rows if not r['hidden']]
    lat = [base.lat(r['ping']) for r in rows]
    nums = [x for x in lat if x is not None]
    ok(lang + ': sort with a filter sorts the whole table',
       nums == sorted(nums) and all(x is None for x in lat[len(nums):]), [r['ping'] for r in rows])
    ok(lang + ': filter kept after sort', len(vis) == pn and striped(rows))
    order = await page.evaluate('(g)=>document.getElementsByName("group.order."+g)[0].value', GA)
    ok(lang + ': order field has every row, hidden ones too', order.split() == [r['id'] for r in rows])

    await choose(page, tid, 'type', '')
    words = await options(page, tid, 'word')
    ok(lang + ': word options from remarks', words is not None and len(words) >= 3, words)
    wv, wt = [o for o in words if split_opt(o[1])[0].lower() == 'east'][0]
    await choose(page, tid, 'word', wv)
    rows = await page.evaluate(STATE, tid)
    vis = [r for r in rows if not r['hidden']]
    want_ids = [r['id'] for r in rows if 'east' in NODES[r['id']]['remarks'].split()]
    ok(lang + ': word filter', sorted(r['id'] for r in vis) == sorted(want_ids), [r['id'] for r in vis])
    tv = [o for o in (await options(page, tid, 'type')) if split_opt(o[1])[0] == 'VMess'][0][0]
    await choose(page, tid, 'type', tv)
    rows = await page.evaluate(STATE, tid)
    vis = [r for r in rows if not r['hidden']]
    ok(lang + ': type AND word',
       sorted(r['id'] for r in vis) == sorted(i for i in want_ids if NODES[i]['type'] == 'VMess'),
       [r['id'] for r in vis])

    await page.evaluate('(t)=>document.getElementById(t).querySelector("th").insertAdjacentHTML("beforeend","<input type=checkbox class=nodes_select_all>")', tid)
    await page.evaluate('(t)=>{const a=document.getElementById(t).querySelector(".nodes_select_all");'
                        'a.addEventListener("click",()=>document.getElementById(t).querySelectorAll("input.nodes_select").forEach(c=>c.checked=true));a.click();}', tid)
    await page.wait_for_timeout(100)
    rows = await page.evaluate(STATE, tid)
    ok(lang + ': "Select all" skips hidden rows',
       all(r['chk'] for r in rows if not r['hidden']) and not any(r['chk'] for r in rows if r['hidden']))
    await page.evaluate('(t)=>document.getElementById(t).querySelectorAll("input.nodes_select").forEach(c=>c.checked=false)', tid)

    await page.click('#ts-filter-%s [data-ts-reset]' % tid)
    await page.wait_for_timeout(150)
    rows = await page.evaluate(STATE, tid)
    ok(lang + ': reset shows every row', not any(r['hidden'] for r in rows))
    await page.fill('#ts-filter-%s input[data-ts-search]' % tid, '203.0.113')
    await page.wait_for_timeout(400)
    rows = await page.evaluate(STATE, tid)
    vis = [r for r in rows if not r['hidden']]
    ok(lang + ': search by address', [r['id'] for r in vis] == [i for i in [r['id'] for r in rows] if NODES[i]['address'].startswith('203.0.113')])
    open(POSTS, 'wb').close()
    await page.focus('#ts-filter-%s input[data-ts-search]' % tid)
    await page.keyboard.press('Enter')
    await page.wait_for_timeout(600)
    ok(lang + ': Enter in the search box does not submit', os.path.getsize(POSTS) == 0 and page.url.endswith('/node_list'))

    first = rows[0]['id']
    await page.evaluate('(id)=>document.getElementById("cbi-passwall2-"+id).remove()', first)
    await page.wait_for_timeout(300)
    opts2 = await options(page, tid, 'type')
    ok(lang + ': options rebuilt when a row is removed', split_opt(opts2[0][1])[1] == total - 1, opts2[0][1])

    open(POSTS, 'wb').close()
    await page.evaluate('()=>{document.querySelectorAll("form[name=cbi]").forEach(f=>f.onsubmit=null)}')
    async with page.expect_navigation():
        await page.click('input[name="cbi.apply"]')
    posted = urllib.parse.parse_qs(open(POSTS, 'rb').read().decode('utf-8', 'replace').split('\n=====')[0])
    ok(lang + ': filter controls are not posted', not any(k.startswith('ts') or k == '' for k in posted))
    ok(lang + ': Save posts the order with hidden rows', len(posted.get('group.order.' + GA, [''])[0].split()) == total)
    ok(lang + ': no JS errors', not [e for e in errs if e not in base_errs()], errs[:3])
    await page.close()


def base_errs():
    return {"Cannot read properties of undefined (reading 'admin')", 'No related RPC reply'}


async def generic(browser):
    page = await browser.new_page()
    errs = []
    page.on('pageerror', lambda err: errs.append(str(err)))
    await page.goto(GEN_URL)
    tid = 'cbi-sample-iface'
    await page.wait_for_selector('#ts-filter-' + tid, state='attached', timeout=10000)
    keys = await page.evaluate('(t)=>[...document.querySelectorAll("#ts-filter-"+t+" select")].map(s=>s.parentNode.firstChild.textContent)', tid)
    ok('generic: filters only for low-cardinality columns', keys == ['Zone', 'Protocol'], keys)
    ok('generic: no sort headers on generic tables', await page.locator('#%s th[data-ts-sort]' % tid).count() == 0)
    ok('generic: search box for 10+ rows', await page.locator('#ts-filter-%s input[data-ts-search]' % tid).count() == 1)
    zone = await options(page, tid, 'c1')
    ok('generic: select-cell values with counts', [t for _v, t in zone[1:]] == ['GUEST (4)', 'LAN (4)', 'WAN (4)'], zone)
    await choose(page, tid, 'c1', zone[2][0])
    rows = await page.evaluate(STATE, tid)
    ok('generic: filter by select value', sum(1 for r in rows if not r['hidden']) == 4)
    await choose(page, tid, 'c1', '')
    await page.select_option('#cbi-sample-lan1 select', 'guest')
    await page.wait_for_timeout(300)
    zone2 = await options(page, tid, 'c1')
    ok('generic: options follow an edited select', [t for _v, t in zone2[1:]] == ['GUEST (5)', 'LAN (4)', 'WAN (3)'], zone2)
    open(POSTS, 'wb').close()
    async with page.expect_navigation():
        await page.click('input[name="cbi.apply"]')
    posted = urllib.parse.parse_qs(open(POSTS, 'rb').read().decode('utf-8', 'replace').split('\n=====')[0])
    zones = [k for k in posted if k.endswith('.zone')]
    ok('generic: hidden rows still posted', len(zones) == 12, len(zones))
    ok('generic: no JS errors', not errs, errs[:3])
    await page.close()


async def main(langs):
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(**base.chrome_kwargs())
        for lang in langs:
            await node_list(browser, lang)
        await generic(browser)
        await browser.close()


def run():
    langs = sys.argv[1:] or ['en']
    server = base.ensure_server()
    try:
        asyncio.run(main(langs))
    finally:
        if server is not None:
            server.terminate()
    passed = sum(1 for _n, good in res if good)
    print('TOTAL', passed, '/', len(res))
    if passed != len(res):
        sys.exit(1)


if __name__ == '__main__':
    run()
