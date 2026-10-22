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
 *
 * Filtering (1.1.0) only hides rows with a CSS class. Rows stay in the DOM, so their
 * form fields and the saved order are submitted as before. Every filter value is
 * collected at runtime from the rows of the table on the page; nothing is hardcoded.
 * Other legacy CBI tables get filter-only support for columns with few distinct values.
 */
(function () {
	'use strict';
	if (window.__luciTableSort) return;
	window.__luciTableSort = { version: '1.1.0' };

	var lang = (document.documentElement.lang || navigator.language || 'en').toLowerCase().indexOf('ru') === 0 ? 'ru' : 'en';
	if (lang !== 'ru') {
		/* some pages say lang="en" while the UI is translated: look at the page's own Save button */
		var apply = document.querySelector('input[name="cbi.apply"], .cbi-page-actions .cbi-button-apply');
		if (apply && /[\u0400-\u04FF]/.test(apply.value || apply.textContent || '')) lang = 'ru';
	}
	var T = {
		ru: {
			hint: 'Нажмите, чтобы отсортировать; повторное нажатие - обратный порядок. Чтобы сохранить порядок, нажмите "Сохранить и применить".',
			type: 'тип', typeHint: 'Сортировать по типу/протоколу, затем по названию',
			addr: 'адрес', addrHint: 'Сортировать по адресу сервера и порту',
			origHint: 'Вернуть исходный (сохранённый) порядок',
			changed: 'Порядок изменён только на этой странице. Чтобы сохранить его на роутере, нажмите "Сохранить и применить".',
			restored: 'Восстановлен исходный порядок (он уже сохранён на роутере).',
			wait: 'Идёт автопроверка пинга (осталось %d). Сортировка выполнится сразу после её окончания...',
			waitFail: 'Автопроверка не закончилась за 2 минуты - сортировка отменена. Обновите страницу и попробуйте ещё раз.',
			filter: 'Фильтр:', all: 'Все', empty: '(пусто)', fType: 'Тип', fWord: 'Слово в описании',
			search: 'поиск...', searchHint: 'Показать только строки, содержащие этот текст',
			shown: 'Показано %s из %t', reset: 'Сбросить', resetHint: 'Показать все строки',
			filterHint: 'Фильтр только скрывает строки на странице и ничего не меняет на роутере. Скрытые строки не выделяются кнопкой "Выбрать все".'
		},
		en: {
			hint: 'Click to sort; click again to reverse. Press "Save & Apply" to keep the order.',
			type: 'type', typeHint: 'Sort by type/protocol, then by name',
			addr: 'address', addrHint: 'Sort by server address and port',
			origHint: 'Restore the original (saved) order',
			changed: 'The order changed on this page only. Press "Save & Apply" to store it on the router.',
			restored: 'Original order restored (it is already saved on the router).',
			wait: 'Automatic ping is still running (%d left). Sorting will run as soon as it finishes...',
			waitFail: 'Automatic ping did not finish within 2 minutes - sorting cancelled. Reload the page and try again.',
			filter: 'Filter:', all: 'All', empty: '(empty)', fType: 'Type', fWord: 'Word in remarks',
			search: 'search...', searchHint: 'Show only rows that contain this text',
			shown: 'Shown %s of %t', reset: 'Reset', resetHint: 'Show all rows',
			filterHint: 'The filter only hides rows on this page and changes nothing on the router. Hidden rows are not selected by "Select all".'
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


	/* words of a free-text field, for the "word" filter; letters and digits only */
	var wordSplit;
	try { wordSplit = new RegExp('[^\\p{L}\\p{N}]+', 'u'); } catch (e) { wordSplit = /[\s.,;:!?|\/\\()\[\]{}<>"'`~@#$%^&*=+_-]+/; }
	function words(text) {
		var seen = {}, out = [];
		String(text || '').split(wordSplit).forEach(function (w) {
			if (w.length < 2 || /^\d+$/.test(w)) return;
			var k = w.toLowerCase();
			if (!seen[k]) { seen[k] = 1; out.push(w); }
		});
		return out;
	}

	/* visible value of a plain table cell; undefined for editable cells (text inputs, checkboxes) */
	function cellValue(td) {
		if (!td) return '';
		var sel = td.querySelector('select');
		if (sel) { var o = sel.options[sel.selectedIndex]; return o ? o.text.trim() : ''; }
		if (td.querySelector('input:not([type=hidden]), textarea')) return undefined;
		return td.textContent.replace(/\s+/g, ' ').trim().slice(0, 60);
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
		/* filters: built from the rows on the page at runtime */
		typeOf: function (tr, cols) {
			var c = cellsOf(tr)[cols.name], t = c ? c.textContent.replace(/\s+/g, ' ').trim() : '';
			var i = t.indexOf('\uFF1A');
			if (i < 0) i = t.indexOf(':');
			return (i < 0 ? '' : t.slice(0, i)).replace(/\s+Realm$/, '').trim();
		},
		filters: function (table, info, cols) {
			var self = this;
			return [
				{ key: 'type', label: T.fType, get: function (tr) { return self.typeOf(tr, cols); } },
				{ key: 'word', label: T.fWord, multi: true, minCount: 2, max: 40,
					get: function (tr) { return words(hiddenVal(info.app, self.rowId(tr, info), 'remarks')); } }
			];
		},
		search: function (tr, info, cols) {
			var id = this.rowId(tr, info);
			return [this.typeOf(tr, cols), hiddenVal(info.app, id, 'remarks'), hiddenVal(info.app, id, 'address') + ':' + hiddenVal(info.app, id, 'port')].join(' ');
		},
		searchMinRows: 2,
		/* row checkboxes of the page's "Select all" / "Delete select nodes" / "Reassign Group" */
		rowCheckbox: 'input.nodes_select',
		selectAll: '.nodes_select_all, #select_all_btn',
		selectionChanged: function () { if (typeof window.update_select_state === 'function') window.update_select_state(); },
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

	/* Any other legacy CBI table: no sorting, filters for columns with few distinct values */
	var genericCbi = {
		generic: true,
		match: function () { return document.querySelector('table.cbi-section-table'); },
		root: function () { return document.getElementById('maincontent') || document.body; },
		info: function (table) { return table && table.classList && table.classList.contains('cbi-section-table') ? { app: '' } : null; },
		columns: {},
		extra: {},
		rowId: function (tr) { return tr.id || ''; },
		filters: function (table, info, cols, rows) {
			if (rows.length < 4) return [];
			var titles = table.querySelector('tr.cbi-section-table-titles'), ths = titles ? cellsOf(titles) : [], defs = [];
			var n = cellsOf(rows[0]).length;
			for (var i = 0; i < n && defs.length < 4; i++) {
				var th = ths[i];
				if (th && th.classList.contains('cbi-section-actions')) continue;
				var seen = {}, distinct = 0, ok = true;
				for (var r = 0; r < rows.length; r++) {
					var v = cellValue(cellsOf(rows[r])[i]);
					if (v === undefined) { ok = false; break; }
					if (!seen.hasOwnProperty(v)) { seen[v] = 1; distinct++; if (distinct > 15) { ok = false; break; } }
				}
				if (!ok || distinct < 2 || distinct >= rows.length) continue;
				var label = th ? th.textContent.replace(/\s+/g, ' ').trim() : '';
				defs.push({ key: 'c' + i, label: label || ('#' + (i + 1)), get: (function (idx) {
					return function (tr) { var v = cellValue(cellsOf(tr)[idx]); return v === undefined ? '' : v; };
				})(i) });
			}
			return defs;
		},
		search: function (tr) { return tr.textContent; },
		searchMinRows: 10
	};

	var adapters = [passwall2NodeList, genericCbi];
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
			'.ts-note{margin:.3em 0;padding:.3em .6em;border-radius:3px;background:rgba(251,154,5,.15);font-size:90%}' +
			'tr.ts-hidden{display:none!important}' +
			'.ts-filter{display:flex;flex-wrap:wrap;align-items:center;gap:.3em .8em;margin:.4em 0;font-size:90%}' +
			'.ts-filter label{display:inline-flex;align-items:center;gap:.3em;white-space:nowrap}' +
			'.ts-filter select,.ts-filter input{width:auto!important;min-width:6em;max-width:22em;height:auto;padding:.15em .3em;margin:0}' +
			'.ts-filter .ts-count{opacity:.8}' +
			'.ts-filter.ts-on .ts-count{font-weight:bold;opacity:1}';
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
		refreshFilter(table);
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


	/* ---- filters ---- */
	var uidSeq = 0;
	function uid(table) { if (!table.__tsUid) table.__tsUid = table.id || ('ts-t' + (++uidSeq)); return table.__tsUid; }

	function collect(table) {
		var info = A.info(table), rows = dataRows(table), cols = colIndexMap(table);
		var defs = (A.filters && rows.length >= 2) ? A.filters(table, info, cols, rows) : [], shown = [];
		defs.forEach(function (d) {
			var counts = {}, labels = {}, vals = rows.map(function (tr) {
				var v = d.get(tr);
				var list = d.multi ? (v || []) : [v == null ? '' : String(v)];
				var keys = list.map(function (x) {
					var k = d.multi ? String(x).toLowerCase() : String(x);
					counts[k] = (counts[k] || 0) + 1;
					(labels[k] = labels[k] || {})[x] = (labels[k][x] || 0) + 1;
					return k;
				});
				return keys;
			});
			var opts = Object.keys(counts).filter(function (k) {
				return !d.multi || (counts[k] >= (d.minCount || 1) && counts[k] < rows.length);
			}).map(function (k) {
				var best = '', bn = -1;
				for (var l in labels[k]) if (labels[k][l] > bn) { bn = labels[k][l]; best = l; }
				return { v: k, label: best === '' ? T.empty : best, n: counts[k] };
			});
			if (d.multi) opts.sort(function (a, b) { return b.n - a.n || cmpText(a.label, b.label); });
			else opts.sort(function (a, b) { return cmpText(a.label, b.label); });
			if (d.max) opts = opts.slice(0, d.max);
			if (d.multi ? opts.length >= 1 : opts.length >= 2) { d.vals = vals; d.opts = opts; shown.push(d); }
		});
		var search = A.search && rows.length >= (A.searchMinRows || 2);
		var sig = rows.length + (search ? 's' : '') + '|' + shown.map(function (d) {
			return d.key + '=' + d.opts.map(function (o) { return o.v + ':' + o.n; }).join(',');
		}).join('|');
		return { info: info, rows: rows, cols: cols, defs: shown, search: search, sig: sig };
	}

	function buildBar(table, c) {
		var st = table.__tsF || (table.__tsF = { sel: {}, q: '' });
		var id = 'ts-filter-' + uid(table), bar = document.getElementById(id);
		if (!bar) {
			bar = document.createElement('div');
			bar.id = id;
			bar.className = 'ts-filter';
			bar.title = T.filterHint;
			table.parentNode.insertBefore(bar, table);
			bar.__tsTable = table;
		}
		while (bar.firstChild) bar.removeChild(bar.firstChild);
		var head = document.createElement('span');
		head.textContent = T.filter;
		bar.appendChild(head);
		var keep = {};
		c.defs.forEach(function (d) {
			var lab = document.createElement('label'), sel = document.createElement('select');
			lab.appendChild(document.createTextNode(d.label));
			sel.className = 'cbi-input-select';
			sel.setAttribute('data-ts-filter', d.key);
			var all = document.createElement('option');
			all.value = '';
			all.textContent = T.all + ' (' + c.rows.length + ')';
			sel.appendChild(all);
			d.opts.forEach(function (o) {
				var op = document.createElement('option');
				op.value = 'v:' + o.v;
				op.textContent = o.label + ' (' + o.n + ')';
				sel.appendChild(op);
			});
			var cur = st.sel[d.key] || '';
			if (cur && !d.opts.some(function (o) { return 'v:' + o.v === cur; })) cur = '';
			sel.value = cur;
			if (cur) keep[d.key] = cur;
			lab.appendChild(sel);
			bar.appendChild(lab);
		});
		st.sel = keep;
		if (c.search) {
			var inp = document.createElement('input');
			inp.type = 'search';
			inp.className = 'cbi-input-text';
			inp.placeholder = T.search;
			inp.title = T.searchHint;
			inp.setAttribute('data-ts-search', '1');
			inp.value = st.q;
			bar.appendChild(inp);
		} else st.q = '';
		var cnt = document.createElement('span');
		cnt.className = 'ts-count';
		bar.appendChild(cnt);
		var rst = document.createElement('button');
		rst.type = 'button';
		rst.className = 'btn cbi-button';
		rst.setAttribute('data-ts-reset', '1');
		rst.textContent = T.reset;
		rst.title = T.resetHint;
		bar.appendChild(rst);
		return bar;
	}

	function applyFilter(table, c, bar) {
		var st = table.__tsF || { sel: {}, q: '' }, q = (st.q || '').toLowerCase().trim(), on = !!q, shown = 0, unchecked = false;
		c.defs.forEach(function (d) { if (st.sel[d.key]) on = true; });
		c.rows.forEach(function (tr, i) {
			var ok = true;
			c.defs.forEach(function (d) {
				var s = st.sel[d.key];
				if (ok && s && d.vals[i].indexOf(s.slice(2)) < 0) ok = false;
			});
			if (ok && q && String(A.search(tr, c.info, c.cols)).toLowerCase().indexOf(q) < 0) ok = false;
			if (ok !== !tr.classList.contains('ts-hidden')) tr.classList.toggle('ts-hidden', !ok);
			if (ok) {
				shown++;
				var want = 'cbi-rowstyle-' + ((shown - 1) % 2 + 1), other = want === 'cbi-rowstyle-1' ? 'cbi-rowstyle-2' : 'cbi-rowstyle-1';
				if (!tr.classList.contains(want)) tr.classList.add(want);
				if (tr.classList.contains(other)) tr.classList.remove(other);
			} else if (A.rowCheckbox) {
				var cb = tr.querySelector(A.rowCheckbox);
				if (cb && cb.checked) { cb.checked = false; unchecked = true; }
			}
		});
		if (unchecked && A.selectionChanged) A.selectionChanged();
		var cnt = bar.querySelector('.ts-count');
		var txt = T.shown.replace('%s', shown).replace('%t', c.rows.length);
		if (cnt && cnt.textContent !== txt) cnt.textContent = txt;
		if (bar.classList.contains('ts-on') !== on) bar.classList.toggle('ts-on', on);
	}

	function removeBar(table) {
		var bar = table.__tsUid ? document.getElementById('ts-filter-' + table.__tsUid) : null;
		if (bar) bar.remove();
		dataRows(table).forEach(function (tr) { if (tr.classList.contains('ts-hidden')) tr.classList.remove('ts-hidden'); });
		table.__tsSig = null;
	}

	function refreshFilter(table) {
		if (!A.filters || !A.info(table)) return;
		var c = collect(table);
		if (!c.defs.length && !c.search) { if (table.__tsSig) removeBar(table); return; }
		var bar = document.getElementById('ts-filter-' + uid(table));
		if (!bar || c.sig !== table.__tsSig) { bar = buildBar(table, c); table.__tsSig = c.sig; }
		applyFilter(table, c, bar);
	}

	function barTable(el) { var bar = el && el.closest ? el.closest('.ts-filter') : null; return bar && bar.__tsTable ? bar.__tsTable : null; }

	root.addEventListener('change', function (ev) {
		var t = ev.target, table;
		if (t && t.getAttribute && t.getAttribute('data-ts-filter') && (table = barTable(t))) {
			(table.__tsF = table.__tsF || { sel: {}, q: '' }).sel[t.getAttribute('data-ts-filter')] = t.value;
			refreshFilter(table);
		} else if (A.generic && t && t.tagName === 'SELECT' && (table = t.closest('table.cbi-section-table'))) {
			refreshFilter(table); /* a value in a filtered column was edited */
		}
	});
	var searchTimer = null;
	root.addEventListener('input', function (ev) {
		var t = ev.target, table = t && t.getAttribute && t.getAttribute('data-ts-search') ? barTable(t) : null;
		if (!table) return;
		clearTimeout(searchTimer);
		searchTimer = setTimeout(function () {
			(table.__tsF = table.__tsF || { sel: {}, q: '' }).q = t.value;
			refreshFilter(table);
		}, 150);
	});
	root.addEventListener('keydown', function (ev) {
		/* Enter in the search box must not submit the page form */
		if (ev.key === 'Enter' && ev.target && ev.target.getAttribute && ev.target.getAttribute('data-ts-search')) ev.preventDefault();
	});
	root.addEventListener('click', function (ev) {
		var t = ev.target, table = t && t.getAttribute && t.getAttribute('data-ts-reset') ? barTable(t) : null;
		if (!table) return;
		ev.preventDefault();
		table.__tsF = { sel: {}, q: '' };
		table.__tsSig = null;
		refreshFilter(table);
	});
	if (A.selectAll) document.addEventListener('click', function (ev) {
		/* "Select all" must not select rows hidden by the filter */
		if (!ev.target || !ev.target.closest || !ev.target.closest(A.selectAll)) return;
		setTimeout(function () {
			var any = false;
			root.querySelectorAll('tr.ts-hidden ' + A.rowCheckbox).forEach(function (cb) { if (cb.checked) { cb.checked = false; any = true; } });
			if (any && A.selectionChanged) A.selectionChanged();
		}, 0);
	});

	function enhanceAll() {
		var tables = root.querySelectorAll('table.cbi-section-table');
		for (var i = 0; i < tables.length; i++) {
			try { enhance(tables[i]); refreshFilter(tables[i]); } catch (e) { if (window.console) console.warn('luci-app-tablesort:', e); }
		}
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
