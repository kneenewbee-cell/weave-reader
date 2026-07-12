export function showNotification(
	message: string,
	type: "success" | "error" | "info" | "warning" = "info"
) {
	const iconMap = {
		success: "\u2713",
		error: "\u2715",
		warning: "\u26A0",
		info: "\u2139",
	};

	const notification = activeWindow.createDiv({
		cls: `weave-notification notification-${type}`,
	});
	notification.createSpan({
		cls: "weave-notification-icon",
		text: iconMap[type] || iconMap.info,
	});
	notification.createSpan({
		cls: "weave-flex-1",
		text: message,
	});

	activeDocument.body.appendChild(notification);

	window.setTimeout(() => {
		notification.classList.add("is-visible");
	}, 10);

	window.setTimeout(() => {
		notification.classList.remove("is-visible");
		window.setTimeout(() => {
			if (notification.parentNode) {
				notification.remove();
			}
		}, 300);
	}, 3000);
}
