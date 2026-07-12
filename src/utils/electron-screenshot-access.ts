export interface ElectronCaptureRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

interface ElectronNativeImage {
	isEmpty(): boolean;
	toJPEG(quality: number): Uint8Array;
}

interface ElectronWebContents {
	capturePage(rect: ElectronCaptureRect): Promise<ElectronNativeImage>;
}

interface ElectronBrowserWindow {
	webContents?: ElectronWebContents;
}

export interface ElectronRemoteModule {
	getCurrentWindow(): ElectronBrowserWindow;
}

interface ElectronModule {
	remote?: ElectronRemoteModule;
}

function isElectronRemoteModule(value: unknown): value is ElectronRemoteModule {
	return (
		value !== null &&
		typeof value === "object" &&
		typeof (value as ElectronRemoteModule).getCurrentWindow === "function"
	);
}

function isElectronModule(value: unknown): value is ElectronModule {
	return value !== null && typeof value === "object";
}

export function getElectronRemoteModule(): ElectronRemoteModule | null {
	const windowWithRequire = window as Window & { require?: (moduleId: string) => unknown };
	if (typeof windowWithRequire.require !== "function") {
		return null;
	}

	try {
		const electron = windowWithRequire.require("electron");
		if (isElectronModule(electron) && electron.remote && isElectronRemoteModule(electron.remote)) {
			return electron.remote;
		}
	} catch {
		/* Electron unavailable outside desktop runtime */
	}

	try {
		const remote = windowWithRequire.require("@electron/remote");
		return isElectronRemoteModule(remote) ? remote : null;
	} catch {
		/* @electron/remote unavailable */
	}

	return null;
}
