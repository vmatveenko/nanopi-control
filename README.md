# NanoPi Control

NanoPi Control is a LuCI module for FriendlyElec NanoPi R5S running OpenWrt.
It appears under **Services → NanoPi Control** and provides device diagnostics,
offline migration from an SD card to internal eMMC, storage expansion and
self-updates from GitHub Releases.

> The storage migration code is intentionally restricted to
> `friendlyarm,nanopi-r5s`, an ext4 root filesystem and the official OpenWrt
> Rockchip partition layout. It refuses to run when a safety check fails.

## Features

- overview of the device, OpenWrt release, memory and storage;
- reliable detection of the actual root block device through
  `/proc/self/mountinfo` and `/sys/dev/block`;
- distinction between removable SD and internal eMMC boot;
- an **SD to eMMC** tab shown on every SD boot and until migration is fully
  completed when running from eMMC;
- safe eMMC erasure while booted from SD, including migration-state reset;
- offline copy of the current OpenWrt installation, packages, configuration and
  NanoPi Control itself;
- verification of the copied boot partition and ext4 filesystem;
- post-boot expansion of partition 2 and ext4 to the full eMMC capacity;
- GitHub release check and one-click package update;
- Russian LuCI translation.

## Requirements

- FriendlyElec NanoPi R5S;
- OpenWrt with target `rockchip/armv8`;
- ext4 sysupgrade image;
- working internet access for installing NanoPi Control and checking updates;
- no internet is required during SD → eMMC transfer.

The package installs these runtime dependencies automatically: `parted`,
`e2fsprogs`, `rsync`, `ca-bundle` and `uclient-fetch`.

## Installation from GitHub Release

Connect to OpenWrt over SSH and run:

```sh
cd /tmp
uclient-fetch -O luci-app-nanopi-control.apk \
  https://github.com/vmatveenko/nanopi-control/releases/latest/download/luci-app-nanopi-control.apk
uclient-fetch -O luci-i18n-nanopi-control-ru.apk \
  https://github.com/vmatveenko/nanopi-control/releases/latest/download/luci-i18n-nanopi-control-ru.apk
uclient-fetch -O SHA256SUMS \
  https://github.com/vmatveenko/nanopi-control/releases/latest/download/SHA256SUMS

grep '  luci-app-nanopi-control.apk$' SHA256SUMS | sha256sum -c -
grep '  luci-i18n-nanopi-control-ru.apk$' SHA256SUMS | sha256sum -c -

apk --allow-untrusted add \
  ./luci-app-nanopi-control.apk \
  ./luci-i18n-nanopi-control-ru.apk

/etc/init.d/rpcd restart
/etc/init.d/uhttpd restart
```

Then open LuCI and navigate to **Services → NanoPi Control**.

OpenWrt 24.10 and older use `opkg` and are not supported by the current release
packages. The source can still be built in an older SDK, but the migration path
has only been designed for the OpenWrt 25.12 package environment.

## Updating NanoPi Control

Open **Services → NanoPi Control → Overview** and select
**Check for updates**. If a newer GitHub Release exists, the page offers an
update button.

The updater:

1. queries the latest release of `vmatveenko/nanopi-control`;
2. downloads the application APK, Russian translation and `SHA256SUMS`;
3. verifies both package hashes;
4. installs the packages with `apk --allow-untrusted add`;
5. restarts NanoPi Control, rpcd and uhttpd;
6. reloads the LuCI page.

The repository can be changed through the UCI option
`nanopi-control.main.repository` for development forks.

## SD → eMMC migration

### What is copied

NanoPi Control does not download another OpenWrt image. It transfers the system
that is currently running from the SD card, including:

- OpenWrt and installed packages;
- `/etc/config` and other persistent settings;
- users and passwords;
- NanoPi Control and its migration state.

Temporary filesystems (`/tmp`, `/run`, `/proc`, `/sys`, `/dev`) are not copied.
The transfer must be performed before Docker is installed because mounted
Docker storage is deliberately rejected by the preflight check.

### Safety model

- the source SD card is never partitioned, formatted or written to;
- the target must be a non-removable MMC device different from the current root
  device;
- the board must report `friendlyarm,nanopi-r5s`;
- root must be ext4;
- the source layout must use partition 1 at sector `65536` with `32768`
  sectors and partition 2 at sector `131072`;
- target capacity and all required utilities are checked;
- the exact target device name must be entered before the destructive action;
- a global lock prevents two storage jobs from running simultaneously;
- the boot partition is verified with SHA-256 and the copied root filesystem is
  checked with `e2fsck -fn`.

### Migration steps

1. Flash the official NanoPi R5S **ext4** OpenWrt image to an SD card.
2. Boot NanoPi R5S from the card and configure LAN, internet and the root
   password.
3. Install NanoPi Control using the release instructions above.
4. Open **Services → NanoPi Control → SD to eMMC**.
5. Confirm that every preflight check is green.
6. Enter the displayed target device name, normally `/dev/mmcblk1`.
7. Start the transfer and wait until the progress reaches 100%. The copied
   eMMC system stores the `copy_completed` state.
8. Shut the NanoPi down. Do not reboot while copying is in progress.
9. Remove the SD card and start the NanoPi again.
10. Open NanoPi Control. In step 3 select **Confirm boot from eMMC**. The module
    verifies the active root device and stores `boot_confirmed` on eMMC.
11. In the step 4 card select **Expand internal storage**.
12. If the kernel asks for one intermediate reboot, reboot and return to the
    transfer page to finish ext4 expansion.
13. Successful expansion stores `expansion_completed`; the transfer tab then
    disappears while running from eMMC.
14. Keep the SD card unchanged until normal networking and LuCI access from
    eMMC have been confirmed.

### Erasing eMMC and resetting the assistant

When OpenWrt is running from the SD card, the **SD to eMMC** page offers one
device confirmation field and two actions: **Erase eMMC and start transfer**
and **Erase eMMC**. Both require the exact internal device name. Erasing removes
partition and filesystem signatures and the migration state, so the assistant
returns to the live preflight step. The operation is rejected when eMMC is the
active system device or any of its partitions is mounted.

Migration state is stored on eMMC. When booted from SD, NanoPi Control mounts
the eMMC root filesystem read-only just long enough to read this state. This is
why a completed eMMC still shows all four completed stages after booting the
recovery SD card, while the tab stays hidden after a completed eMMC boot.

The first-stage target root partition is intentionally created with only the
space needed for the current installation plus a safety margin. The final step
expands it to the entire eMMC. This provides a clear checkpoint between copying
and committing to the new boot device.

### Recovery

If NanoPi does not boot from eMMC, power it off, insert the original SD card and
boot again. Because the SD card was not modified, NanoPi Control reappears and
the transfer can be diagnosed or repeated. A failed copy may leave eMMC in a
partial state, but repeating the transfer recreates its partition table and
filesystems.

Migration progress is available through:

```sh
ubus call nanopi-control migration_status
cat /tmp/nanopi-control/migration.log
```

## Building

Place the repository in `package/luci-app-nanopi-control` inside an OpenWrt
25.12 SDK or buildroot:

```sh
./scripts/feeds update -a
./scripts/feeds install -a
make defconfig
make package/luci-app-nanopi-control/compile V=s
```

The resulting APKs are located below `bin/packages/`. The included GitHub
Actions workflow uses the official
[`openwrt/gh-action-sdk`](https://github.com/openwrt/gh-action-sdk) action for
`aarch64_generic-25.12.5`.

## Development installation

For an unpackaged test deployment, copy `root/*` to `/` and `htdocs/*` to
`/www`, set executable permissions on scripts, then run:

```sh
/etc/init.d/nanopi-control enable
/etc/init.d/nanopi-control start
/etc/init.d/rpcd restart
rm -f /tmp/luci-indexcache
/etc/init.d/uhttpd restart
```

## Tests

Run the fixture-based SD/eMMC detector test on OpenWrt:

```sh
tests/test-detect-storage.sh ./root/usr/libexec/nanopi-control/detect-storage
```

The test covers SD boot, normal eMMC boot and the post-copy eMMC expansion
state.

## License

MIT
