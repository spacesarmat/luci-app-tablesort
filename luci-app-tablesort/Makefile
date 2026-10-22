# luci-app-tablesort - click-to-sort column headers for legacy (Lua) LuCI tables.
# PKGARCH is all: one package file runs on every target.
#
# File layout matches what luci.mk installs (htdocs under /www, root under /).
# This Makefile does not include feeds/luci/luci.mk: on OpenWrt 25.12 that file
# still build-depends on lua/host, and the packages feed ships Lua as lua5.4
# with no source package named lua. The installed files, the luci-compat
# dependency, and the maintainer scripts are the same.

include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-tablesort
PKG_VERSION:=1.0.0
PKG_RELEASE:=1
PKG_LICENSE:=Apache-2.0
PKG_MAINTAINER:=ANDY BUM (spacesarmat)

include $(INCLUDE_DIR)/package.mk

define Package/luci-app-tablesort
  SECTION:=luci
  CATEGORY:=LuCI
  SUBMENU:=3. Applications
  TITLE:=Click-to-sort table headers for LuCI (Passwall2 node list and more)
  DEPENDS:=+luci-compat
  PKGARCH:=all
  URL:=https://github.com/spacesarmat/luci-app-tablesort
  MAINTAINER:=ANDY BUM (spacesarmat)
endef

define Package/luci-app-tablesort/description
  Click-to-sort column headers for legacy LuCI (CBI) tables in OpenWrt, for example the Passwall2 node list.
endef

define Build/Compile
endef

define Package/luci-app-tablesort/install
	$(INSTALL_DIR) $(1)/www/luci-static/resources
	$(INSTALL_DATA) ./htdocs/luci-static/resources/tablesort.js $(1)/www/luci-static/resources/tablesort.js
	$(INSTALL_DIR) $(1)/usr/sbin
	$(INSTALL_BIN) ./root/usr/sbin/luci-tablesort-hook $(1)/usr/sbin/luci-tablesort-hook
	$(INSTALL_DIR) $(1)/etc/init.d
	$(INSTALL_BIN) ./root/etc/init.d/luci-tablesort $(1)/etc/init.d/luci-tablesort
	$(INSTALL_DIR) $(1)/etc/uci-defaults
	$(INSTALL_BIN) ./root/etc/uci-defaults/90-luci-tablesort $(1)/etc/uci-defaults/90-luci-tablesort
endef

define Package/luci-app-tablesort/postinst
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || {
	rm -f /tmp/luci-indexcache.*
	rm -rf /tmp/luci-modulecache/
	/etc/init.d/rpcd reload >/dev/null 2>&1 || true
}
exit 0
endef

define Package/luci-app-tablesort/prerm
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] && exit 0
if [ -x /etc/init.d/luci-tablesort ]; then
	/etc/init.d/luci-tablesort disable >/dev/null 2>&1 || true
fi
if [ -x /usr/sbin/luci-tablesort-hook ]; then
	/usr/sbin/luci-tablesort-hook remove >/dev/null 2>&1 || true
fi
exit 0
endef

$(eval $(call BuildPackage,luci-app-tablesort))
