// Parse registry responses without trusting tag names as shell input.
import { readfile } from 'fs';
let mode = ARGV[0], data;
try { data = json(readfile(ARGV[1])); } catch (e) { exit(1); }
if (mode == 'ghcr') {
	if (type(data.tags) != 'array') exit(1);
	for (let tag in data.tags)
		if (match(tag, /^[0-9]+\.[0-9]+\.[0-9]+$/)) print(tag + '\n');
}
else {
	if (type(data.results) != 'array') exit(1);
	for (let tag in data.results) {
		let pattern = mode == 'caddy' ? /^[0-9]+\.[0-9]+\.[0-9]+-alpine$/ : /^[0-9]+\.[0-9]+\.[0-9]+$/;
		if (!match(tag.name, pattern)) continue;
		for (let img in tag.images || []) {
			if (img.architecture == 'arm64' && img.os == 'linux') {
				print(tag.name + '\n');
				break;
			}
		}
	}
}
