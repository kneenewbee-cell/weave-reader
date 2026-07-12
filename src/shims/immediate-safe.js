/**
 * Browser-safe immediate scheduler (no dynamic <script> injection).
 * Drop-in replacement for the `immediate` package used by jszip/lie.
 */
let draining = false;
const queue = [];

function flushQueue() {
	draining = true;
	let index = 0;
	const current = queue.slice();
	queue.length = 0;
	while (index < current.length) {
		current[index]();
		index += 1;
	}
	draining = false;
	if (queue.length > 0) {
		scheduleDrain();
	}
}

function scheduleDrain() {
	if (typeof queueMicrotask === "function") {
		queueMicrotask(flushQueue);
		return;
	}
	Promise.resolve().then(flushQueue);
}

export default function immediate(task) {
	if (typeof task !== "function") {
		return;
	}
	queue.push(task);
	if (!draining && queue.length === 1) {
		scheduleDrain();
	}
}
