include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-nanopi-control
PKG_VERSION:=0.6.2
PKG_RELEASE:=1
PKG_LICENSE:=MIT
PKG_LICENSE_FILES:=LICENSE
PKG_MAINTAINER:=WrtPilot contributors

LUCI_NAME:=luci-app-nanopi-control
LUCI_TITLE:=LuCI support for WrtPilot
LUCI_DESCRIPTION:=Device status, storage migration and module manager for OpenWrt (currently NanoPi R5S)
LUCI_DEPENDS:=+luci-base +rpcd +libubox +parted +e2fsprogs +rsync +ca-bundle +uclient-fetch +ucode +ucode-mod-uci +ucode-mod-fs +curl +openssl-util +acme-acmesh +coreutils-timeout
LUCI_PKGARCH:=all

include $(TOPDIR)/feeds/luci/luci.mk

# Package scanner hint: call BuildPackage
