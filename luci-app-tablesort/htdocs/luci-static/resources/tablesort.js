/*
 * luci-app-tablesort: click-to-sort column headers for legacy (Lua) LuCI tables.
 * First adapter: Passwall2 node list (Services - PassWall 2 - Node List).
 *
 * Loaded on legacy CBI pages through a one-line hook in
 * /usr/lib/lua/luci/view/cbi/footer.htm (see /usr/sbin/luci-tablesort-hook).
 *
 * Sorting only reorders the rows of the current table in the DOM and then calls the
 * page's own order function (Passwall2: set_order(group)), the same as drag-and-drop
 * and "To Top" do. Nothing is written to the router until "Save & Apply" is pressed.
 */
(function () {
	'use strict';
	if (window.__luciTableSort) return;
	window.__luciTableSort = { version: 1 };

	var lang = (document.documentElement.lang || navigator.language || 'en').toLowerCase().indexOf('ru') === 0 ? 'ru' : 'en';
	var T = {
		ru: {
			hint: 'Нажмите, чтобы отсортировать; повторное нажатие - обратный порядок. Чтобы сохранить порядок, нажмите "Сохранить и применить".',
			type: 'тип', typeHint: 'Сортировать по типу/протоколу, затем по названию',
			addr: 'адрес', addrHint: 'Сортировать по адресу сервера и порту',
			origHint: 'Вернуть исходный (сохранённый) порядок',
			changed: 'Порядок изменён только на этой странице. Чтобы сохранить его на роутере, нажмите "Сохранить и применить".',
			restored: 'Восстановлен исходный порядок (он уже сохранён на роутере).',
			wait: 'Идёт автопроверка пинга (осталось %d). Сортировка выполнится сразу после её окончания...',
			waitFail: 'Автопроверка не закончилась за 2 минуты - сортировка отменена. Обновите страницу и попробуйте ещё раз.'
		},
		en: {
			hint: 'Click to sort; click again to reverse. Press "Save & Apply" to keep the order.',
			type: 'type', typeHint: 'Sort by type/protocol, then by name',
			addr: 'address', addrHint: 'Sort by server address and port',
			origHint: 'Restore the original (saved) order',
			changed: 'The order changed on this page only. Press "Save & Apply" to store it on the router.',
			restored: 'Original order restored (it is already saved on the router).',
			wait: 'Automatic ping is still running (%d left). Sorting will run as soon as it finishes...',
			waitFail: 'Automatic ping did not finish within 2 minutes - sorting cancelled. Reload the page and try again.'
		}
	}[lang];

	var collator = (window.Intl && Intl.Collator) ? new Intl.Collator(lang, { numeric: true, sensitivity: 'base' }) : null;
	function cmpText(a, b) { return collator ? collator.compare(a, b) : (a < b ? -1 : (a > b ? 1 : 0)); }

	/* "123 ms", "12.5 ms", "1.2 s" -> milliseconds; Timeout, Error, ---, Test, Check... -> null */
	function parseLatency(text) {
		var t = String(text || '').replace(/\s+/g, ' ').trim();
		var m = /^(\d+(?:[.,]\d+)?)\s*(ms|мс|s|с|сек)?$/i.exec(t);
		if (!m) return null;
		var v = parseFloat(m[1].replace(',', '.'));
		if (isNaN(v)) return null;
		if (m[2] && /^(s|с|сек)$/i.test(m[2])) v *= 1000;
		return v;
	}

	function hiddenVal(app, id, opt) {
		var el = document.getElementById('cbid.' + app + '.' + id + '.' + opt);
		return el && el.value != null ? String(el.value).trim() : '';
	}

	function cellsOf(tr) {
		var out = [];
		for (var i = 0; i < tr.children.length; i++)
			if (tr.children[i].tagName === 'TD' || tr.children[i].tagName === 'TH') out.push(tr.children[i]);
		return out;
	}

	/*
	 * Adapter: how to find tables on a page, which columns are sortable, how to read
	 * a sort key and how to tell the page that the order changed.
	 */
	var passwall2NodeList = {
		match: function () { return /\/passwall2\/node_list(\/|$)/.test(location.pathname) && document.getElementById('node_list'); },
		root: function () { return document.getElementById('node_list'); },
		tableRe: /^cbi-([A-Za-z0-9_]+)-nodes-(.+)-table$/,
		info: function (table) {
			var m = table && table.id ? this.tableRe.exec(table.id) : null;
			return m ? { app: m[1], group: m[2] } : null;
		},
		columns: { 'pw-remark': 'name', 'pw-ping': 'ping', 'pw-tcping': 'tcping', 'pw-urltest': 'urltest' },
		extra: { name: [['type', 'type', 'typeHint'], ['addr', 'addr', 'addrHint'], ['orig', '\u21BA', 'origHint']] },
		rowId: function (tr, info) { var p = 'cbi-' + info.app + '-'; return tr.id.indexOf(p) === 0 ? tr.id.substr(p.length) : tr.id; },
		key: function (tr, key, info, cols) {
			var id = this.rowId(tr, info), c;
			switch (key) {
			case 'name':
				return hiddenVal(info.app, id, 'remarks') || ((cellsOf(tr)[cols.name] || {}).textContent || '').trim();
			case 'type':
				c = cellsOf(tr)[cols.name];
				return (c ? c.textContent.split(/[：:]/)[0].trim() : '') + '\u0000' + hiddenVal(info.app, id, 'remarks');
			case 'addr': {
				var a = hiddenVal(info.app, id, 'address');
				return a ? a + '\u0000' + ('00000' + hiddenVal(info.app, id, 'port')).slice(-5) : null;
			}
			default:
				c = cellsOf(tr)[cols[key]];
				return c ? parseLatency(c.textContent) : null;
			}
		},
		changed: function (table, info) { if (typeof window.set_order === 'function') window.set_order(info.group); },
		/* auto ping (Automatic detection = Ping/TCPing) writes results by position in a live
		   DOM collection, so rows must not move while it is still running.
		   Returns { inflight: running requests, left: cells still waiting for a result } */
		busy: function (root) {
			var mode, inflight = 0, left = 0;
			try { mode = auto_detection_time; } catch (e) { mode = null; } // eslint-disable-line no-undef
			if (mode !== 'icmp' && mode !== 'tcping') return { inflight: 0, left: 0 };
			if (window.ajax && Array.isArray(window.ajax.list))
				window.ajax.list.forEach(function (x) { if (x.readyState > 0 && x.readyState < 4) inflight++; });
			var spans = root.getElementsByClassName(mode === 'tcping' ? 'tcping_value' : 'ping_value');
			for (var i = 0; i < spans.length; i++) {
				var id = spans[i].getAttribute('cbiid');
				if (!id || spans[i].textContent.trim() !== '---') continue;
				var full = (typeof window.get_address_full === 'function') ? window.get_address_full(id) : null;
				if (!full) {
					var m = /^cbi-([A-Za-z0-9_]+)-/.exec((spans[i].closest('tr') || {}).id || '');
					var app = m ? m[1] : 'passwall2';
					full = { address: hiddenVal(app, id, 'address'), port: hiddenVal(app, id, 'port') };
				}
				if (full.address && (mode === 'icmp' || full.port)) left++;
			}
			return { inflight: inflight, left: left };
		}
	};

	var adapters = [passwall2NodeList];
	var A = null;
	for (var ai = 0; ai < adapters.length; ai++) if (adapters[ai].match()) { A = adapters[ai]; break; }
	if (!A) return;
	var root = A.root();

	(function injectStyle() {
		if (document.getElementById('luci-tablesort-css')) return;
		var st = document.createElement('style');
		st.id = 'luci-tablesort-css';
		st.textContent =
			'th[data-ts-sort]{cursor:pointer;user-select:none;white-space:nowrap}' +
			'th[data-ts-sort]:hover{text-decoration:underline}' +
			'.ts-arrow{display:inline-block;min-width:1em;margin-left:.25em;font-size:90%}' +
			'.ts-sub{font-weight:normal;font-size:85%;opacity:.85;margin-left:.6em;cursor:pointer;text-decoration:underline dotted;white-space:nowrap}' +
			'.ts-sub.ts-active{opacity:1;font-weight:bold}' +
			'.ts-note{margin:.3em 0;padding:.3em .6em;border-radius:3px;background:rgba(251,154,5,.15);font-size:90%}';
		document.head.appendChild(st);
	})();

	function bodyOf(table) { return table.querySelector('tbody') || table; }

	function dataRows(table) {
		var body = bodyOf(table), out = [];
		for (var i = 0; i < body.children.length; i++) {
			var tr = body.children[i];
			if (tr.tagName === 'TR' && tr.classList.contains('cbi-section-table-row') && !tr.classList.contains('placeholder'))
				out.push(tr);
		}
		return out;
	}

	function colIndexMap(table) {
		var rows = dataRows(table), map = {};
		if (!rows.length) return map;
		var cells = cellsOf(rows[0]);
		for (var i = 0; i < cells.length; i++)
			for (var cls in A.columns)
				if (cells[i].classList.contains(cls)) map[A.columns[cls]] = i;
		return map;
	}

	function note(table, text) {
		var id = 'ts-note-' + table.id, el = document.getElementById(id);
		if (!text) { if (el) el.remove(); return; }
		if (!el) {
			el = document.createElement('div');
			el.id = id;
			el.className = 'ts-note';
			table.parentNode.insertBefore(el, table);
		}
		el.textContent = text;
	}

	function setIndicator(table, th, sub, key, dir) {
		table.querySelectorAll('.ts-arrow').forEach(function (s) { s.textContent = ''; });
		table.querySelectorAll('.ts-sub').forEach(function (s) { s.classList.remove('ts-active'); });
		table.querySelectorAll('th[data-ts-sort]').forEach(function (h) { if (h !== th) { delete h.dataset.tsDir; delete h.dataset.tsKey; } });
		var arrow = th.querySelector('.ts-arrow');
		if (arrow && key !== 'orig') arrow.textContent = dir === 'desc' ? '\u25BC' : '\u25B2';
		if (sub && key !== 'orig') sub.classList.add('ts-active');
	}

	function applyOrder(table, info, rows) {
		var body = bodyOf(table), frag = document.createDocumentFragment();
		rows.forEach(function (tr, i) {
			tr.classList.remove('cbi-rowstyle-1', 'cbi-rowstyle-2');
			tr.classList.add('cbi-rowstyle-' + (i % 2 + 1));
			frag.appendChild(tr);
		});
		body.appendChild(frag); /* the title row stays first, data rows follow in the new order */
		A.changed(table, info);
	}

	function doSort(table, th, sub, key) {
		var info = A.info(table), rows = dataRows(table), dir = 'asc';
		if (!info || rows.length < 2) return;
		if (key === 'orig') {
			var pos = {};
			(table.__tsOrig || []).forEach(function (id, i) { pos[id] = i; });
			rows.sort(function (a, b) {
				var pa = pos[A.rowId(a, info)], pb = pos[A.rowId(b, info)];
				return (pa == null ? 1e9 : pa) - (pb == null ? 1e9 : pb);
			});
			delete th.dataset.tsDir; delete th.dataset.tsKey;
		} else {
			dir = (th.dataset.tsKey === key && th.dataset.tsDir === 'asc') ? 'desc' : 'asc';
			th.dataset.tsKey = key;
			th.dataset.tsDir = dir;
			var cols = colIndexMap(table), sign = dir === 'desc' ? -1 : 1;
			var list = rows.map(function (tr, i) { return { tr: tr, i: i, k: A.key(tr, key, info, cols) }; });
			list.sort(function (a, b) {
				var ea = (a.k === null || a.k === ''), eb = (b.k === null || b.k === '');
				if (ea || eb) return ea === eb ? a.i - b.i : (ea ? 1 : -1); /* no value: always at the bottom */
				var c = (typeof a.k === 'number' && typeof b.k === 'number') ? a.k - b.k : cmpText(String(a.k), String(b.k));
				return c !== 0 ? sign * c : a.i - b.i;
			});
			rows = list.map(function (x) { return x.tr; });
		}
		applyOrder(table, info, rows);
		setIndicator(table, th, sub, key, dir);
		note(table, key === 'orig' ? T.restored : T.changed);
	}

	function requestSort(table, th, sub, key) {
		if (table.__tsWait) { clearInterval(table.__tsWait); table.__tsWait = null; }
		var st = A.busy ? A.busy(root) : { inflight: 0, left: 0 };
		if (!st.inflight && !st.left) { doSort(table, th, sub, key); return; }
		var started = Date.now(), idle = 0;
		note(table, T.wait.replace('%d', st.left || st.inflight));
		table.__tsWait = setInterval(function () {
			st = A.busy(root);
			idle = st.inflight ? 0 : idle + 1;
			/* done, or nothing has been running for 3 s (e.g. requests were aborted) */
			if ((!st.inflight && !st.left) || idle >= 6) {
				clearInterval(table.__tsWait);
				table.__tsWait = null;
				if (document.body.contains(table)) doSort(table, th, sub, key);
				return;
			}
			if (Date.now() - started > 120000) {
				clearInterval(table.__tsWait);
				table.__tsWait = null;
				note(table, T.waitFail);
				return;
			}
			note(table, T.wait.replace('%d', st.left || st.inflight));
		}, 500);
	}

	function enhance(table) {
		var info = A.info(table);
		if (table.__tsReady || !info) return;
		var titles = table.querySelector('tr.cbi-section-table-titles'), rows = dataRows(table);
		if (!titles || !rows.length) return;
		var cols = colIndexMap(table), ths = cellsOf(titles);
		table.__tsReady = true;
		table.__tsOrig = rows.map(function (tr) { return A.rowId(tr, info); });
		Object.keys(cols).forEach(function (key) {
			var th = ths[cols[key]];
			if (!th || th.classList.contains('cbi-section-actions')) return;
			th.setAttribute('data-ts-sort', key);
			th.title = T.hint;
			var arrow = document.createElement('span');
			arrow.className = 'ts-arrow';
			th.appendChild(arrow);
			(A.extra[key] || []).forEach(function (s) {
				var sp = document.createElement('span');
				sp.className = 'ts-sub';
				sp.setAttribute('data-ts-sort', s[0]);
				sp.textContent = T[s[1]] || s[1];
				sp.title = T[s[2]] || s[2];
				th.appendChild(sp);
			});
		});
	}

	function enhanceAll() {
		var tables = root.querySelectorAll('table.cbi-section-table');
		for (var i = 0; i < tables.length; i++) enhance(tables[i]);
	}

	root.addEventListener('click', function (ev) {
		var el = ev.target && ev.target.closest ? ev.target.closest('[data-ts-sort]') : null;
		if (!el || !root.contains(el) || ev.target.closest('input, a, button, select')) return;
		var th = el.closest('th'), table = el.closest('table');
		if (!th || !table || !A.info(table)) return;
		ev.preventDefault();
		ev.stopPropagation();
		requestSort(table, th, el === th ? null : el, el.getAttribute('data-ts-sort'));
	});

	var timer = null;
	new MutationObserver(function () {
		if (timer) return;
		timer = setTimeout(function () { timer = null; enhanceAll(); }, 50);
	}).observe(root, { childList: true, subtree: true });
	enhanceAll();
})();
