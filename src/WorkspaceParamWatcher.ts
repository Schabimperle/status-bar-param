import { workspace, Uri, WorkspaceFolder, RelativePattern } from 'vscode';
import * as jsonc from 'jsonc-parser';
import * as fs from 'fs';

export class ParamWatcher {
	onDispose!: Function;
	lastRead: number = 0;
	params: Param[] = [];
	listeners: Array<(params: Param[]) => any> = [];

	static FromInsideWorkspace(workspaceFolder: WorkspaceFolder, relativePath: string): ParamWatcher {
		console.log('Creating FileWatcher for', workspaceFolder.name, relativePath);

		// workaround for bug: https://github.com/microsoft/vscode/issues/10633
		let uri = workspaceFolder.uri.with({ path: `${workspaceFolder.uri.path}/${relativePath}` });

		// wait for changes of tasks.json
		let paramWatcher = new ParamWatcher();
		let pattern = new RelativePattern(workspaceFolder, relativePath);
		let watcher = workspace.createFileSystemWatcher(pattern);
		watcher.onDidChange(() => paramWatcher.changeTriggersTwiceWorkaound(uri));
		watcher.onDidCreate(() => paramWatcher.changeTriggersTwiceWorkaound(uri));
		watcher.onDidDelete(() => paramWatcher.listeners.forEach(listener => listener([])));
		paramWatcher.onDispose = watcher.dispose;

		// init status bar items
		paramWatcher.changeTriggersTwiceWorkaound(uri);
		return paramWatcher;
	}

	static FromOutsideWorkspace(jsonFile: Uri): ParamWatcher {
		console.log('Creating FileWatcher for', jsonFile.toString());

		// wait for changes of the given file
		let paramWatcher = new ParamWatcher();
		let watcher = fs.watch(jsonFile.fsPath);
		watcher.on('change', () => paramWatcher.changeTriggersTwiceWorkaound(jsonFile));
		watcher.on('close', () => paramWatcher.listeners.forEach(listener => listener([])));
		paramWatcher.onDispose = watcher.close;

		// init status bar items
		paramWatcher.changeTriggersTwiceWorkaound(jsonFile);
		return paramWatcher;
	}

	async changeTriggersTwiceWorkaound(jsonFile: Uri) {
		try {
			console.log('onDidChangeTriggersTwiceWorkaround');
			let stat = await workspace.fs.stat(jsonFile);
			// workaround for didChange event fired twice for one change
			let lastWrite = stat.mtime;
			if (lastWrite === this.lastRead) {
				return;
			}
			this.lastRead = lastWrite;
			this.jsonFileChanged(jsonFile);
		} catch (err) {
			this.listeners.forEach(listener => listener([]));
			return;
		}
	}

	async jsonFileChanged(jsonFile: Uri) {
		console.log('jsonFileChanged', jsonFile.toString());
		try {
			let fileContent = await workspace.fs.readFile(jsonFile);
			let file = jsonc.parse(fileContent.toString());

			this.params = [];
			if (file?.inputs || file?.tasks?.inputs) {
				let inputs = file.inputs || file.tasks.inputs;
				inputs.forEach((input: any) => {
					// ignore inputs not intended for this extension
					if (!input.command || !input.command.startsWith('statusBarParam.get.') || input.args.length === 0) {
						return;
					}
					this.params.push({
						name: input.id,
						command: input.command,
						values: input.args
					});
				});
			}

			this.listeners.forEach((listener) => {
				listener(this.params);
			});
		} catch (err) {
			console.error("Couldn't parse json:", err);
		}
	}

	onParamsChanged(listener: (params: Param[]) => any) {
		this.listeners.push(listener);
	}

	dispose() {
		this.onDispose();
	}

}

export interface Param {
	name: string;
	command: string;
	values: string[];
}