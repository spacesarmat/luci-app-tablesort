#!/usr/bin/env python3
"""Playwright checks against the synthetic Passwall2 node list fixture."""
import asyncio
import json
import os
import re
import socket
import subprocess
import sys
import time
import urllib.parse

from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.abspath(__file__))
URL = 'http://127.0.0.1:8765/cgi-bin/luci/admin/services/passwall2/node_list'
POSTS = os.path.join(ROOT, 'posts.bin')
SAMPLE = json.load(open(os.path.join(ROOT, 'fixtures', 'sample.json'), encoding='utf-8'))
GROUP_A = SAMPLE['groups'][0]['id']
GROUP_B = SAMPLE['groups'][1]['id']
COUNT_A = len(SAMPLE['groups'][0]['nodes'])
COUNT_B = len(SAMPLE['groups'][1]['nodes'])

res = []


def ok(name, cond, extra=''):
    res.append((name, bool(cond)))
    print(('PASS ' if cond else 'FAIL ') + name + ((' ' + str(extra)) if extra else ''))


JS_STATE = '''(g)=>{const t=document.getElementById("cbi-passwall2-nodes-"+g+"-table");
 const rows=[...t.querySelector("tbody").children].filter(r=>r.classList.contains("cbi-section-table-row"));
 const ids=rows.map(r=>r.id.replace("cbi-passwall2-",""));
 const ping=rows.map(r=>r.querySelector("td.pw-ping").textContent.trim());
 const names=rows.map(r=>document.getElementById("cbid.passwall2."+r.id.replace("cbi-passwall2-","")+".remarks").value);
 const addr=rows.map(r=>document.getElementById("cbid.passwall2."+r.id.replace("cbi-passwall2-","")+".address").value);
 const first=t.querySelector("tbody").firstElementChild.classList.contains("cbi-section-table-titles");
 const order=(document.getElementsByName("group.order."+g)[0]||{}).value||"";
 return {ids,ping,names,addr,first,order};}'''


def lat(text):
    match = re.match(r'^(\d+(?:\.\d+)?)\s*(ms|s)$', text.strip(), re.I)
    if not match:
        return None
    value = float(match.group(1))
    if match.group(2).lower() == 's':
        value *= 1000
    return value


def chrome_kwargs():
    args = ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    kwargs = {'args': args}
    chrome = os.environ.get('CHROME_PATH', '/usr/bin/google-chrome')
    if chrome and os.path.isfile(chrome) and os.access(chrome, os.X_OK):
        kwargs['executable_path'] = chrome
    return kwargs


def port_open():
    try:
        sock = socket.create_connection(('127.0.0.1', 8765), 0.2)
    except OSError:
        return False
    sock.close()
    return True


def ensure_server():
    if port_open():
        return None
    proc = subprocess.Popen([sys.executable, os.path.join(ROOT, 'server.py')])
    for _ in range(50):
        if port_open():
            return proc
        if proc.poll() is not None:
            raise SystemExit('fixture server exited before listening')
        time.sleep(0.1)
    proc.terminate()
    raise SystemExit('fixture server did not start')


async def sorted_by_collator(page, values):
    return await page.evaluate(
        '''(a)=>{const c=new Intl.Collator(document.documentElement.lang,{numeric:true,sensitivity:"base"});
        for (let i=1;i<a.length;i++) if (c.compare(a[i-1], a[i])>0) return false;
        return a.length>1;}''',
        values,
    )


async def main(lang):
    if COUNT_A < 4 or COUNT_B < 2:
        raise SystemExit('sample fixture needs at least 4 nodes in group A and 2 in group B')
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(**chrome_kwargs())
        page = await browser.new_page(viewport={'width': 1600, 'height': 1000})
        errs = []
        page.on('pageerror', lambda err: errs.append(str(err)))
        if lang == 'ru':
            async def fulfill_ru(route):
                response = await route.fetch()
                body = (await response.body()).decode('utf-8').replace(
                    '<html lang="en" >', '<html lang="ru" >', 1)
                await route.fulfill(body=body, content_type='text/html; charset=utf-8')
            await page.route('**/node_list', fulfill_ru)
        await page.goto(URL)
        ping_header = '#cbi-passwall2-nodes-%s-table th[data-ts-sort="ping"]' % GROUP_A
        await page.wait_for_selector(ping_header, timeout=20000, state='attached')
        await page.click('li[group_name="%s"] a' % GROUP_A)
        await page.wait_for_timeout(300)
        ok(lang + ': headers enhanced',
           await page.locator('#cbi-passwall2-nodes-%s-table th[data-ts-sort]' % GROUP_A).count() == 4)
        before = await page.evaluate(JS_STATE, GROUP_A)
        busy = await page.evaluate(
            '()=>[...document.getElementsByClassName("ping_value")].filter(s=>s.textContent.trim()=="---").length')
        await page.click(ping_header)
        note = await page.evaluate(
            '()=>(document.getElementById("ts-note-cbi-passwall2-nodes-%s-table")||{}).textContent||""' % GROUP_A)
        ok(lang + ': deferred while auto ping runs',
           busy == 0 or re.search(r'[0-9]', note), 'pending=%s note="%s"' % (busy, note[:60]))
        await page.wait_for_function(
            '''() => {
              const el = document.querySelector('#cbi-passwall2-nodes-%s-table th[data-ts-sort="ping"]');
              return !!(el && el.dataset.tsDir === "asc");
            }''' % GROUP_A,
            timeout=130000)
        await page.wait_for_function(
            '()=>!(window.ajax&&ajax.list.some(x=>x.readyState>0&&x.readyState<4))',
            timeout=130000)
        await page.wait_for_timeout(500)
        state = await page.evaluate(JS_STATE, GROUP_A)
        values = [lat(item) for item in state['ping']]
        nums = [item for item in values if item is not None]
        first_null = next((i for i, item in enumerate(values) if item is None), len(values))
        ok(lang + ': ping asc numeric', nums == sorted(nums),
           '%d values, first=%s' % (len(nums), state['ping'][:4]))
        ok(lang + ': timeouts/--- at bottom (asc)',
           all(item is None for item in values[first_null:]),
           'nulls=%d e.g. %s' % (len(values) - len(nums), state['ping'][-2:]))
        ok(lang + ': title row first', state['first'])
        ok(lang + ': order field = DOM order', state['order'] == ' '.join(state['ids']))
        ok(lang + ': same row set', sorted(state['ids']) == sorted(before['ids']))
        arrow = await page.inner_text(
            '#cbi-passwall2-nodes-%s-table th[data-ts-sort="ping"] .ts-arrow' % GROUP_A)
        ok(lang + ': arrow asc', arrow == '\u25b2')
        await page.click(ping_header)
        await page.wait_for_timeout(300)
        state2 = await page.evaluate(JS_STATE, GROUP_A)
        values2 = [lat(item) for item in state2['ping']]
        nums2 = [item for item in values2 if item is not None]
        first_null2 = next((i for i, item in enumerate(values2) if item is None), len(values2))
        ok(lang + ': ping desc',
           nums2 == sorted(nums2, reverse=True) and all(item is None for item in values2[first_null2:]))
        ok(lang + ': arrow desc',
           (await page.inner_text(
               '#cbi-passwall2-nodes-%s-table th[data-ts-sort="ping"] .ts-arrow' % GROUP_A)) == '\u25bc')
        ok(lang + ': row<->ping mapping kept',
           dict(zip(state['ids'], state['ping'])) == dict(zip(state2['ids'], state2['ping'])))
        await page.click(
            '#cbi-passwall2-nodes-%s-table th[data-ts-sort="name"]' % GROUP_A,
            position={'x': 5, 'y': 5})
        await page.wait_for_timeout(300)
        state3 = await page.evaluate(JS_STATE, GROUP_A)
        ok(lang + ': name asc (collator)',
           await sorted_by_collator(page, state3['names']), state3['names'][:3])
        ok(lang + ': ping arrow cleared',
           (await page.inner_text(
               '#cbi-passwall2-nodes-%s-table th[data-ts-sort="ping"] .ts-arrow' % GROUP_A)) == '')
        await page.click('#cbi-passwall2-nodes-%s-table .ts-sub[data-ts-sort="addr"]' % GROUP_A)
        await page.wait_for_timeout(300)
        state4 = await page.evaluate(JS_STATE, GROUP_A)
        filled = [item for item in state4['addr'] if item]
        ok(lang + ': address sort',
           await sorted_by_collator(page, filled) and len(filled) == len(state4['addr']),
           filled[:3])
        ok(lang + ': order field after addr', state4['order'] == ' '.join(state4['ids']))
        await page.click('#cbi-passwall2-nodes-%s-table .ts-sub[data-ts-sort="orig"]' % GROUP_A)
        await page.wait_for_timeout(300)
        state5 = await page.evaluate(JS_STATE, GROUP_A)
        ok(lang + ': original order restored', state5['ids'] == before['ids'])
        last = state5['ids'][-1]
        await page.evaluate(
            '()=>document.querySelector("#cbi-passwall2-%s input[onclick*=row_top]").click()' % last)
        state6 = await page.evaluate(JS_STATE, GROUP_A)
        ok(lang + ': To Top still works',
           state6['ids'][0] == last and state6['order'] == ' '.join(state6['ids']))
        dragged = state6['ids'][3]
        try:
            await page.drag_and_drop(
                '#cbi-passwall2-%s .drag-handle' % dragged,
                '#cbi-passwall2-%s td.pw-remark' % state6['ids'][0])
            await page.wait_for_timeout(500)
            state7 = await page.evaluate(JS_STATE, GROUP_A)
            ok(lang + ': drag-and-drop still works',
               state7['ids'].index(dragged) < 3 and state7['order'] == ' '.join(state7['ids']),
               'pos %s' % state7['ids'].index(dragged))
        except Exception as exc:
            ok(lang + ': drag-and-drop still works', False, exc)
        kept = (await page.evaluate(JS_STATE, GROUP_A))['order']
        await page.click('li[group_name="%s"] a' % GROUP_B)
        await page.wait_for_timeout(300)
        await page.click(
            '#cbi-passwall2-nodes-%s-table th[data-ts-sort="name"]' % GROUP_B,
            position={'x': 5, 'y': 5})
        await page.wait_for_timeout(300)
        other = await page.evaluate(JS_STATE, GROUP_B)
        ok(lang + ': other tab sorts its own table',
           other['order'] == ' '.join(other['ids']) and len(other['ids']) == COUNT_B)
        ok(lang + ': first group order untouched',
           (await page.evaluate(JS_STATE, GROUP_A))['order'] == kept)
        rid = other['ids'][1]
        await page.click('#cbi-passwall2-%s td.pw-tcping a' % rid)
        await page.wait_for_timeout(900)
        txt = await page.inner_text('#cbi-passwall2-%s td.pw-tcping' % rid)
        ok(lang + ': manual TCPing on sorted row',
           re.search(r'\d+ ms|Timeout|Тайм', txt) is not None, txt)
        await page.check('#cbi-passwall2-%s input.nodes_select' % rid)
        await page.evaluate('()=>reassign_group_div && reassign_group_div.open && reassign_group_div.open()')
        ok(lang + ': Reassign Group dialog opens',
           await page.evaluate(
               '()=>getComputedStyle(document.getElementById("reassign_group_div")).display!="none"'))
        await page.evaluate('()=>reassign_group_div.close()')
        open(POSTS, 'wb').close()
        await page.evaluate('()=>{document.querySelectorAll("form[name=cbi]").forEach(f=>f.onsubmit=null)}')
        async with page.expect_navigation():
            await page.click('input[name="cbi.apply"]')
        body = open(POSTS, 'rb').read().decode('utf-8', 'replace')
        posted = urllib.parse.unquote_plus(body)
        ok(lang + ': Save posts group.order.%s = sorted order' % GROUP_B,
           ('group.order.%s' % GROUP_B) in posted and ' '.join(other['ids']) in posted)
        ok(lang + ': Save posts group.order.%s (dragged order)' % GROUP_A,
           ('group.order.%s' % GROUP_A) in posted)
        baseline = {
            "Cannot read properties of undefined (reading 'admin')",
            'No related RPC reply',
        }
        ok(lang + ': no JS errors beyond mock-environment baseline',
           set(errs) <= baseline, [err for err in errs if err not in baseline][:3])
        await page.screenshot(path=os.path.join(ROOT, 'shot-%s.png' % lang))
        await browser.close()


def run():
    langs = sys.argv[1:] or ['en']
    server = ensure_server()
    try:
        for lang in langs:
            asyncio.run(main(lang))
    finally:
        if server is not None:
            server.terminate()
            try:
                server.wait(timeout=3)
            except subprocess.TimeoutExpired:
                server.kill()
    passed = sum(1 for _name, good in res if good)
    print('TOTAL', passed, '/', len(res))
    if passed != len(res):
        sys.exit(1)


if __name__ == '__main__':
    run()
