/*
 * Behavior of the synthetic Passwall2 node list fixture.
 * Enough of the real page for tablesort.js and the Playwright checks:
 * set_order, To Top, drag-and-drop, group tabs, auto ping, manual TCPing,
 * and the Reassign Group dialog. No router data.
 */
(function () {
	'use strict';

	window.auto_detection_time = 'icmp';
	window.ajax = window.ajax || { list: [] };

	window.get_address_full = function (id) {
		var addr = document.getElementById('cbid.passwall2.' + id + '.address');
		var port = document.getElementById('cbid.passwall2.' + id + '.port');
		return {
			address: addr ? addr.value : '',
			port: port ? port.value : ''
		};
	};

	window.set_order = function (group) {
		var table = document.getElementById('cbi-passwall2-nodes-' + group + '-table');
		if (!table) return;
		var body = table.querySelector('tbody');
		var ids = [];
		for (var i = 0; i < body.children.length; i++) {
			var tr = body.children[i];
			if (tr.classList.contains('cbi-section-table-row'))
				ids.push(tr.id.replace('cbi-passwall2-', ''));
		}
		var field = document.getElementsByName('group.order.' + group)[0];
		if (field) field.value = ids.join(' ');
	};

	window.row_top = function (btn) {
		var tr = btn.closest('tr');
		var tbody = tr.parentNode;
		var titles = tbody.querySelector('tr.cbi-section-table-titles');
		if (titles && titles.nextSibling) tbody.insertBefore(tr, titles.nextSibling);
		else tbody.insertBefore(tr, tbody.firstChild);
		var m = /^cbi-passwall2-nodes-(.+)-table$/.exec(tr.closest('table').id);
		if (m) window.set_order(m[1]);
	};

	window.reassign_group_div = {
		open: function () {
			document.getElementById('reassign_group_div').style.display = 'block';
		},
		close: function () {
			document.getElementById('reassign_group_div').style.display = 'none';
		}
	};

	function formatPing(v) {
		if (v == null || String(v).trim() === '') return 'Timeout';
		var n = parseFloat(v);
		if (isNaN(n)) return 'Timeout';
		if (n >= 1000) return (n / 1000).toFixed(1) + ' s';
		return String(Math.round(n)) + ' ms';
	}

	function showGroup(name) {
		var blocks = document.querySelectorAll('[data-ts-group]');
		for (var i = 0; i < blocks.length; i++) {
			blocks[i].style.display = blocks[i].getAttribute('data-ts-group') === name ? '' : 'none';
		}
	}

	var tabs = document.querySelectorAll('li[group_name] a');
	for (var t = 0; t < tabs.length; t++) {
		tabs[t].addEventListener('click', function (ev) {
			ev.preventDefault();
			showGroup(this.parentNode.getAttribute('group_name'));
		});
	}
	if (tabs.length) showGroup(tabs[0].parentNode.getAttribute('group_name'));

	var dragRow = null;
	document.addEventListener('mousedown', function (ev) {
		var handle = ev.target.closest && ev.target.closest('.drag-handle');
		if (!handle) return;
		dragRow = handle.closest('tr');
		ev.preventDefault();
	});
	document.addEventListener('mouseup', function (ev) {
		if (!dragRow) return;
		var row = dragRow;
		dragRow = null;
		var target = ev.target.closest && ev.target.closest('tr.cbi-section-table-row');
		if (!target || target === row || target.parentNode !== row.parentNode) return;
		target.parentNode.insertBefore(row, target);
		var m = /^cbi-passwall2-nodes-(.+)-table$/.exec(row.closest('table').id);
		if (m) window.set_order(m[1]);
	});

	document.addEventListener('click', function (ev) {
		var a = ev.target.closest && ev.target.closest('a.tcping-test');
		if (!a) return;
		ev.preventDefault();
		var td = a.closest('td');
		var id = a.getAttribute('data-id');
		var xhr = new XMLHttpRequest();
		window.ajax.list.push(xhr);
		xhr.open('GET', '/cgi-bin/luci/admin/services/passwall2/ping_node?id=' + encodeURIComponent(id));
		xhr.onload = function () {
			var data = {};
			try { data = JSON.parse(xhr.responseText); } catch (e) { data = {}; }
			var span = td.querySelector('.tcping_value');
			if (span) span.textContent = formatPing(data.ping);
		};
		xhr.send();
	});

	var spans = document.getElementsByClassName('ping_value');
	for (var i = 0; i < spans.length; i++) {
		(function (span) {
			var id = span.getAttribute('cbiid');
			var xhr = new XMLHttpRequest();
			window.ajax.list.push(xhr);
			xhr.open('GET', '/cgi-bin/luci/admin/services/passwall2/ping_node?id=' + encodeURIComponent(id) + '&slow=1');
			xhr.onload = function () {
				var data = {};
				try { data = JSON.parse(xhr.responseText); } catch (e) { data = {}; }
				span.textContent = formatPing(data.ping);
			};
			xhr.send();
		})(spans[i]);
	}
})();
