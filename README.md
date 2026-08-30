# NanoPi Control

`NanoPi Control` is a LuCI application for FriendlyElec NanoPi R5S running
OpenWrt. It is displayed under **Services → NanoPi Control**.

The first development version provides:

- an overview of the device, OpenWrt version, memory and storage;
- reliable detection of the current root block device;
- distinction between SD-card and internal eMMC boot;
- a **Transfer to internal storage** tab shown only when OpenWrt is running
  from an SD card and internal eMMC is detected;
- a non-destructive transfer assistant and readiness checks.

The actual write/copy operation is intentionally disabled in `0.1.0`. Storage
migration is destructive and will be enabled after testing the partition and
bootloader logic on a NanoPi R5S booted from an SD card.

## Project layout

```text
htdocs/                         LuCI JavaScript views
root/etc/init.d/                boot-time storage detection
root/usr/libexec/nanopi-control diagnostics
root/usr/libexec/rpcd/          read-only rpcd endpoint
root/usr/share/luci/menu.d/     Services menu and tabs
root/usr/share/rpcd/acl.d/      LuCI RPC permissions
po/ru/                          Russian translation
```

## Storage detection

NanoPi Control does not infer the boot source from the presence of an SD card.
It reads the major/minor number of `/` from `/proc/self/mountinfo`, resolves it
through `/sys/dev/block`, and checks the parent MMC device's `removable` flag.

When all of the following are true, the init script creates
`/tmp/nanopi-control/booted-from-sd`:

1. board name is `friendlyarm,nanopi-r5s`;
2. the root filesystem is on a removable MMC device;
3. a non-removable device with MMC type is present.

The LuCI menu uses this runtime marker to conditionally expose the transfer
tab. Inserting an SD card while the router is running from eMMC does not expose
the tab.

## Build in the OpenWrt SDK

Place this repository in `package/luci-app-nanopi-control` inside an OpenWrt
SDK or buildroot, then run:

```sh
./scripts/feeds update -a
./scripts/feeds install -a
make defconfig
make package/luci-app-nanopi-control/compile V=s
```

OpenWrt 25.12 and later produce an `.apk`; older supported buildroots may
produce an `.ipk`.

The repository also contains a GitHub Actions workflow based on the official
[`openwrt/gh-action-sdk`](https://github.com/openwrt/gh-action-sdk) action. It
builds the package for OpenWrt 25.12 on `aarch64_generic` and publishes the
package as a workflow artifact.

## Development installation

For an unpackaged development installation, copy `root/*` to `/` and
`htdocs/*` to `/www`, then run:

```sh
chmod 0755 /etc/init.d/nanopi-control \
  /usr/libexec/nanopi-control/detect-storage \
  /usr/libexec/rpcd/nanopi-control

/etc/init.d/nanopi-control enable
/etc/init.d/nanopi-control start
/etc/init.d/rpcd restart
rm -f /tmp/luci-indexcache
/etc/init.d/uhttpd restart
```

This version performs diagnostics only. It does not partition, format or write
to eMMC.

## Tests

The detector includes a fixture-based test for both supported boot scenarios.
Run it on OpenWrt (it requires `jshn.sh` and `jsonfilter`):

```sh
tests/test-detect-storage.sh ./root/usr/libexec/nanopi-control/detect-storage
```
