export class FoliateSessionGuard<TView> {
	private viewSessionToken = 0;
	private positionOperationToken = 0;

	startViewSession(): number {
		this.viewSessionToken += 1;
		return this.viewSessionToken;
	}

	invalidateViewSession(): void {
		this.startViewSession();
		this.startPositionOperation();
	}

	startPositionOperation(): number {
		this.positionOperationToken += 1;
		return this.positionOperationToken;
	}

	isActiveViewSession(viewSessionToken: number, currentView: TView | null, view?: TView | null): boolean {
		return (
			viewSessionToken === this.viewSessionToken &&
			(typeof view === "undefined" || currentView === view)
		);
	}

	canApplyPositionOperation(
		currentView: TView | null,
		positionOperationToken?: number,
		viewSessionToken?: number,
		view?: TView | null
	): boolean {
		if (
			typeof positionOperationToken === "number" &&
			positionOperationToken !== this.positionOperationToken
		) {
			return false;
		}
		if (
			typeof viewSessionToken === "number" &&
			!this.isActiveViewSession(viewSessionToken, currentView, view)
		) {
			return false;
		}
		return true;
	}
}
