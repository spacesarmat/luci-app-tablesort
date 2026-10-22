# luci-app-tablesort

Click-to-sort column headers for legacy LuCI (CBI) tables in OpenWrt, e.g. the Passwall2 node list.

[English](#english) | [Русский](#русский)

## English

### What it does

`luci-app-tablesort` adds click-to-sort column headers on legacy Lua/CBI LuCI pages. The supported page is the Passwall2 node list: **Services - PassWall 2 - Node List** (`/cgi-bin/luci/admin/services/passwall2/node_list`).

- Click **Remarks**, **Ping**, **TCPing**, or **URL Test** in a group tab to sort that group. A second click reverses the order. The active column shows an arrow.
- Next to Remarks there are three extra controls: **type** (protocol, then name), **address** (server address and port), and a restore mark that returns the order saved on the router.
- Latency such as `12 ms` or `1.2 s` is compared as a number. `Timeout`, `---`, errors, and cells that have not been tested yet stay at the bottom.
- Names use natural, locale-aware order (`Relay 2` before `Relay 10`).
- While that page's automatic Ping or TCPing is still running, sorting waits until it finishes. The page writes results by row position, so rows must not move early.
- Sorting reorders rows in the browser and calls the page's own order function, the same path as drag-and-drop and "To Top". **The new order is visual until you press Save & Apply.** Save & Apply stores it through the page's own save logic.
- Drag-and-drop, To Top, group tabs, Reassign Group, and ping tests keep working.
- The sorter's own labels follow the LuCI language (Russian or English).

On a legacy CBI page that has no adapter, the script loads and returns immediately.

### Supported pages

| Page | Path | What is sortable |
|---|---|---|
| Passwall2 node list | `/cgi-bin/luci/admin/services/passwall2/node_list` | Current group only: name (natural order), type, address, Ping, TCPing, URL test (numeric, empty and Timeout last) |

### Install

Download the `.apk` from the [releases](https://github.com/spacesarmat/luci-app-tablesort/releases) page (OpenWrt 25.12 and newer), copy it to the router, and run:

```sh
apk add --allow-untrusted luci-app-tablesort-*.apk
```

OpenWrt 24.10 still uses opkg. Download the `.ipk` from the same release:

```sh
opkg install luci-app-tablesort_*.ipk
```

The 24.10 SDK names that file with underscores (`luci-app-tablesort_1.0.0-r1_all.ipk`). The 25.12 file uses hyphens (`luci-app-tablesort-1.0.0-r1.apk`). The package is architecture-independent (`PKGARCH:=all`): one `.apk`, and one `.ipk`, works on every target.

The package depends on `luci-compat`. On install, a uci-defaults script inserts the footer hook and enables `/etc/init.d/luci-tablesort`, which reapplies the hook at boot (for example after a `luci-compat` upgrade).

### Uninstall

```sh
apk del luci-app-tablesort
```

On OpenWrt 24.10:

```sh
opkg remove luci-app-tablesort
```

The package `prerm` script disables the init script and runs `luci-tablesort-hook remove`, which deletes the one include line from the CBI footer. `tablesort.js` is removed with the package files.

### Sorting and Save & Apply

Sorting does not write the router config by itself. It reorders the current table and updates the hidden `group.order.<group>` field, which is what Passwall2 already does for drag-and-drop and To Top. **Press Save & Apply on that page to keep the order.** Until then, a reload shows the previously saved order. The restore control puts the rows back to the order from when the page was opened.

### Hook commands

`/usr/sbin/luci-tablesort-hook` adds or removes one line immediately before `<%+footer%>` in `/usr/lib/lua/luci/view/cbi/footer.htm`:

```html
<script src="<%=resource%>/tablesort.js?v=1"></script><!-- luci-app-tablesort -->
```

No Passwall2 file is modified, so a Passwall2 update does not drop the hook. Re-applying is safe: if the line is already there, the script does nothing. It clears the LuCI template cache after a change.

```sh
luci-tablesort-hook apply
luci-tablesort-hook remove
luci-tablesort-hook status
```

Manual install without a package:

```sh
cp tablesort.js /www/luci-static/resources/
cp luci-tablesort-hook /usr/sbin/ && chmod 755 /usr/sbin/luci-tablesort-hook
luci-tablesort-hook apply
```

Manual removal:

```sh
luci-tablesort-hook remove
rm -f /www/luci-static/resources/tablesort.js /usr/sbin/luci-tablesort-hook
```

### Compatibility

- Legacy LuCI pages rendered by Lua CBI (`luci-compat`), which include `/usr/lib/lua/luci/view/cbi/footer.htm`.
- Checked on OpenWrt 25.12.6 x86_64 with `luci-app-passwall2` 26.10.20.
- OpenWrt 25.12 packages are `.apk` (apk). OpenWrt 24.10 packages are `.ipk` (opkg). Both are built from this repository.
- JavaScript LuCI views (the ucode client-rendered UI) already provide their own column sorting. This package does not wrap those views. It only sorts legacy CBI tables it has an adapter for.

### Build

GitHub Actions builds the package on every push to `main` and on tags `v*`, using the official OpenWrt SDK tarballs (25.12 for `.apk`, 24.10 for `.ipk`). A `v*` tag also publishes a GitHub Release with those files attached.

From a checkout of this repository, with the SDK host tools installed (`gcc`, `make`, `git`, `perl`, `python3`, `rsync`, `zstd`):

```sh
.github/build-sdk.sh 25.12.6 apk
.github/build-sdk.sh 24.10.8 ipk
```

The script downloads the official SDK, checks `sha256sums`, and runs `make package/luci-app-tablesort/compile`. The package is a normal LuCI application (`SECTION:=luci`, `PKGARCH:=all`) and does not need the Lua host tools.

### Tests

`tests/` runs the hook script in a temporary directory and, with Playwright, drives a synthetic Passwall2 node list. The fixture uses made-up group names and RFC 5737 documentation addresses. It is not a copy of a router page. See [tests/README.md](tests/README.md).

### Layout

| Path | Purpose |
|---|---|
| `luci-app-tablesort/htdocs/luci-static/resources/tablesort.js` | sorter and per-page adapters |
| `luci-app-tablesort/root/usr/sbin/luci-tablesort-hook` | add, remove, or show the footer hook |
| `luci-app-tablesort/root/etc/uci-defaults/90-luci-tablesort` | apply the hook on install |
| `luci-app-tablesort/root/etc/init.d/luci-tablesort` | re-apply the hook at boot |
| `luci-app-tablesort/Makefile` | LuCI package (`PKGARCH:=all`) |
| `tests/` | hook checks and synthetic browser fixtures |

### Adding another page

`tablesort.js` keeps an `adapters` list. An adapter defines `match()`, `root()`, `info(table)`, `columns` (td class to sort key), `key(tr, key, info, cols)`, `changed(table, info)`, and optionally `busy(root)`. The Passwall2 adapter is `passwall2NodeList`.

## Русский

### Что делает пакет

`luci-app-tablesort` добавляет сортировку по щелчку на заголовок колонки для старых страниц LuCI на Lua/CBI. Сейчас поддерживается список нод Passwall2: **Services - PassWall 2 - Node List** (`/cgi-bin/luci/admin/services/passwall2/node_list`).

- Щелчок по **Remarks**, **Ping**, **TCPing** или **URL Test** на вкладке группы сортирует эту группу. Повторный щелчок меняет направление. У активной колонки появляется стрелка.
- Рядом с Remarks есть три дополнительные кнопки: **тип** (протокол, затем имя), **адрес** (адрес сервера и порт) и возврат к порядку, который сохранен на роутере.
- Задержки вроде `12 ms` или `1.2 s` сравниваются как числа. `Timeout`, `---`, ошибки и еще не проверенные ячейки остаются внизу.
- Имена сравниваются в естественном порядке с учетом языка интерфейса (`Relay 2` раньше `Relay 10`).
- Пока страница сама еще выполняет автоматический Ping или TCPing, сортировка ждет окончания: эта страница записывает результаты по позиции строки.
- Сортировка переставляет строки в браузере и вызывает штатную функцию порядка страницы, ту же, что drag-and-drop и "To Top". **Новый порядок виден на странице, но не записан в роутер, пока вы не нажмете Save & Apply.** Сохранение идет через обычную логику этой страницы.
- Drag-and-drop, To Top, вкладки групп, Reassign Group и проверки пинга продолжают работать.
- Подписи самого сортировщика следуют языку LuCI (русский или английский).

На остальных старых CBI-страницах, для которых нет адаптера, скрипт загружается и сразу завершается.

### Поддерживаемые страницы

| Страница | Путь | Что сортируется |
|---|---|---|
| Список нод Passwall2 | `/cgi-bin/luci/admin/services/passwall2/node_list` | Только текущая группа: имя (естественный порядок), тип, адрес, Ping, TCPing, URL test (числа, пустые значения и Timeout внизу) |

### Установка

Скачайте `.apk` со страницы [релизов](https://github.com/spacesarmat/luci-app-tablesort/releases) (OpenWrt 25.12 и новее), скопируйте его на роутер и выполните:

```sh
apk add --allow-untrusted luci-app-tablesort-*.apk
```

OpenWrt 24.10 использует opkg. Скачайте `.ipk` из того же релиза:

```sh
opkg install luci-app-tablesort_*.ipk
```

SDK 24.10 называет этот файл с подчеркиваниями (`luci-app-tablesort_1.0.0-r1_all.ipk`). Файл 25.12 использует дефисы (`luci-app-tablesort-1.0.0-r1.apk`). Пакет не зависит от архитектуры (`PKGARCH:=all`): один `.apk` и один `.ipk` подходят для любой платформы.

Зависимость: `luci-compat`. При установке скрипт uci-defaults вставляет hook в подвал CBI и включает `/etc/init.d/luci-tablesort`. Init-скрипт повторяет hook при загрузке, например после обновления `luci-compat`.

### Удаление

```sh
apk del luci-app-tablesort
```

На OpenWrt 24.10:

```sh
opkg remove luci-app-tablesort
```

Скрипт `prerm` выключает init-скрипт и вызывает `luci-tablesort-hook remove`: одна строка include удаляется из подвала CBI. Файл `tablesort.js` удаляется вместе с файлами пакета.

### Сортировка и Save & Apply

Сама сортировка не записывает конфигурацию роутера. Она меняет порядок строк и скрытое поле `group.order.<group>`, как это уже делают drag-and-drop и To Top в Passwall2. **Чтобы сохранить порядок, нажмите Save & Apply на этой странице.** До этого обновление страницы показывает ранее сохраненный порядок. Кнопка восстановления возвращает строки к порядку на момент открытия страницы.

### Команды hook

`/usr/sbin/luci-tablesort-hook` добавляет или убирает одну строку прямо перед `<%+footer%>` в файле `/usr/lib/lua/luci/view/cbi/footer.htm`:

```html
<script src="<%=resource%>/tablesort.js?v=1"></script><!-- luci-app-tablesort -->
```

Файлы Passwall2 не изменяются, поэтому обновление Passwall2 не снимает hook. Повторный запуск безопасен: если строка уже есть, скрипт ничего не делает. После изменения он очищает кэш шаблонов LuCI.

```sh
luci-tablesort-hook apply
luci-tablesort-hook remove
luci-tablesort-hook status
```

Установка вручную, без пакета:

```sh
cp tablesort.js /www/luci-static/resources/
cp luci-tablesort-hook /usr/sbin/ && chmod 755 /usr/sbin/luci-tablesort-hook
luci-tablesort-hook apply
```

Удаление вручную:

```sh
luci-tablesort-hook remove
rm -f /www/luci-static/resources/tablesort.js /usr/sbin/luci-tablesort-hook
```

### Совместимость

- Старые страницы LuCI, которые рисует Lua CBI (`luci-compat`) и которые подключают `/usr/lib/lua/luci/view/cbi/footer.htm`.
- Проверено на OpenWrt 25.12.6 x86_64 с `luci-app-passwall2` 26.10.20.
- Пакеты OpenWrt 25.12 собираются как `.apk` (apk). Пакеты OpenWrt 24.10 собираются как `.ipk` (opkg). Оба варианта собираются из этого репозитория.
- Страницы LuCI на JavaScript (клиентский интерфейс на ucode) уже умеют сортировать свои таблицы. Этот пакет их не оборачивает. Он сортирует только старые CBI-таблицы, для которых написан адаптер.

### Сборка

GitHub Actions собирает пакет при каждом push в `main` и при тегах `v*`. Для `.apk` используется официальный SDK OpenWrt 25.12, для `.ipk` - SDK 24.10. Тег `v*` публикует GitHub Release и прикладывает эти файлы.

Из каталога этого репозитория, если установлены инструменты SDK (`gcc`, `make`, `git`, `perl`, `python3`, `rsync`, `zstd`):

```sh
.github/build-sdk.sh 25.12.6 apk
.github/build-sdk.sh 24.10.8 ipk
```

Скрипт скачивает официальный SDK, сверяет `sha256sums` и запускает `make package/luci-app-tablesort/compile`. Это обычное приложение LuCI (`SECTION:=luci`, `PKGARCH:=all`), ему не нужны host-утилиты Lua.

### Тесты

Каталог `tests/` проверяет hook-скрипт во временном каталоге и через Playwright открывает синтетическую страницу списка нод Passwall2. В фикстуре вымышленные имена групп и документационные адреса из RFC 5737. Это не снимок страницы с роутера. Подробности в [tests/README.md](tests/README.md).

### Состав

| Путь | Назначение |
|---|---|
| `luci-app-tablesort/htdocs/luci-static/resources/tablesort.js` | сортировщик и адаптеры страниц |
| `luci-app-tablesort/root/usr/sbin/luci-tablesort-hook` | добавить, убрать или показать hook |
| `luci-app-tablesort/root/etc/uci-defaults/90-luci-tablesort` | применить hook при установке |
| `luci-app-tablesort/root/etc/init.d/luci-tablesort` | повторно применить hook при загрузке |
| `luci-app-tablesort/Makefile` | пакет LuCI (`PKGARCH:=all`) |
| `tests/` | проверки hook и синтетическая страница |

### Как добавить страницу

В `tablesort.js` есть список `adapters`. Адаптер задает `match()`, `root()`, `info(table)`, `columns` (класс td и ключ сортировки), `key(tr, key, info, cols)`, `changed(table, info)` и при необходимости `busy(root)`. Адаптер Passwall2 называется `passwall2NodeList`.
