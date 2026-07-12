export interface PaginatedLayoutRecoveryInput {
	hostWidth: number;
	frameViewportWidths: number[];
	minHostWidth?: number;
	minViewportRatio?: number;
	minNarrowViewportPx?: number;
}

export function shouldRecoverPaginatedLayout(input: PaginatedLayoutRecoveryInput): boolean {
	const minHostWidth = input.minHostWidth ?? 480;
	const minViewportRatio = input.minViewportRatio ?? 0.33;
	const minNarrowViewportPx = input.minNarrowViewportPx ?? 180;

	if (input.hostWidth < minHostWidth) {
		return false;
	}
	if (input.frameViewportWidths.length === 0) {
		return false;
	}

	const narrowestViewportWidth = input.frameViewportWidths.reduce((smallest, width) => {
		if (width <= 0) {
			return smallest;
		}
		return Math.min(smallest, width);
	}, Number.POSITIVE_INFINITY);

	if (!Number.isFinite(narrowestViewportWidth)) {
		return false;
	}

	return narrowestViewportWidth <= Math.max(minNarrowViewportPx, input.hostWidth * minViewportRatio);
}

export class ReaderPaginatedLayoutRecoveryScheduler {
	private recoveryToken = 0;
	private pendingFrame: number | null = null;

	schedule(recover: (token: number) => void | Promise<void>): number {
		this.cancelFrame();
		const token = ++this.recoveryToken;
		this.pendingFrame = window.requestAnimationFrame(() => {
			this.pendingFrame = null;
			void recover(token);
		});
		return token;
	}

	bumpToken(): void {
		this.recoveryToken += 1;
		this.cancelFrame();
	}

	cancelFrame(): void {
		if (this.pendingFrame !== null) {
			window.cancelAnimationFrame(this.pendingFrame);
			this.pendingFrame = null;
		}
	}

	isCurrentToken(token: number): boolean {
		return token === this.recoveryToken;
	}
}
