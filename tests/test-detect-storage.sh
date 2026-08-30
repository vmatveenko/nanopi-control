#!/bin/sh

set -eu

DETECT_SCRIPT="${1:-/usr/libexec/nanopi-control/detect-storage}"
TEST_DIR="$(mktemp -d /tmp/nanopi-control-test.XXXXXX)"

cleanup() {
	rm -rf "$TEST_DIR"
}
trap cleanup EXIT INT TERM

mkdir -p \
	"$TEST_DIR/runtime" \
	"$TEST_DIR/sysinfo" \
	"$TEST_DIR/sys/class/block/mmcblk0/device" \
	"$TEST_DIR/sys/class/block/mmcblk1/device" \
	"$TEST_DIR/sys/dev/block" \
	"$TEST_DIR/devices/mmc0/block/mmcblk0/mmcblk0p2" \
	"$TEST_DIR/devices/mmc1/block/mmcblk1/mmcblk1p2"

printf '%s\n' 'friendlyarm,nanopi-r5s' > "$TEST_DIR/sysinfo/board_name"
printf '%s\n' 'FriendlyElec NanoPi R5S' > "$TEST_DIR/sysinfo/model"
printf '%s\n' '0.1.0-test' > "$TEST_DIR/version"

printf '%s\n' '1' > "$TEST_DIR/sys/class/block/mmcblk0/removable"
printf '%s\n' '124735488' > "$TEST_DIR/sys/class/block/mmcblk0/size"
printf '%s\n' 'SD' > "$TEST_DIR/sys/class/block/mmcblk0/device/type"

printf '%s\n' '0' > "$TEST_DIR/sys/class/block/mmcblk1/removable"
printf '%s\n' '60620800' > "$TEST_DIR/sys/class/block/mmcblk1/size"
printf '%s\n' 'MMC' > "$TEST_DIR/sys/class/block/mmcblk1/device/type"

ln -s "$TEST_DIR/devices/mmc0/block/mmcblk0/mmcblk0p2" "$TEST_DIR/sys/dev/block/179:2"
ln -s "$TEST_DIR/devices/mmc1/block/mmcblk1/mmcblk1p2" "$TEST_DIR/sys/dev/block/179:4"

run_detect() {
	NANOPI_CONTROL_RUNTIME_DIR="$TEST_DIR/runtime" \
	NANOPI_CONTROL_SYS_BLOCK="$TEST_DIR/sys/class/block" \
	NANOPI_CONTROL_SYS_DEV_BLOCK="$TEST_DIR/sys/dev/block" \
	NANOPI_CONTROL_MOUNTINFO="$TEST_DIR/mountinfo" \
	NANOPI_CONTROL_SYSINFO_DIR="$TEST_DIR/sysinfo" \
	NANOPI_CONTROL_VERSION_FILE="$TEST_DIR/version" \
		"$DETECT_SCRIPT" --json
}

assert_json() {
	local document="$1"
	local expression="$2"
	local expected="$3"
	local actual

	actual="$(printf '%s\n' "$document" | jsonfilter -e "$expression")"
	if [ "$actual" != "$expected" ]; then
		printf 'Assertion failed: %s expected %s, got %s\n' "$expression" "$expected" "$actual" >&2
		exit 1
	fi
}

printf '%s\n' '17 1 179:2 / / rw,noatime - ext4 /dev/root rw' > "$TEST_DIR/mountinfo"
sd_result="$(run_detect)"
assert_json "$sd_result" '@.supported' 'true'
assert_json "$sd_result" '@.boot_medium' 'sd'
assert_json "$sd_result" '@.root_device' '/dev/mmcblk0'
assert_json "$sd_result" '@.internal_device' '/dev/mmcblk1'
assert_json "$sd_result" '@.transfer_available' 'true'
[ -f "$TEST_DIR/runtime/booted-from-sd" ]

printf '%s\n' '17 1 179:4 / / rw,noatime - ext4 /dev/root rw' > "$TEST_DIR/mountinfo"
emmc_result="$(run_detect)"
assert_json "$emmc_result" '@.supported' 'true'
assert_json "$emmc_result" '@.boot_medium' 'emmc'
assert_json "$emmc_result" '@.root_device' '/dev/mmcblk1'
assert_json "$emmc_result" '@.transfer_available' 'false'
[ ! -e "$TEST_DIR/runtime/booted-from-sd" ]

printf '%s\n' 'All storage detection tests passed.'

