import { FileSystemWatcher, workspace, Uri, WorkspaceFolder, RelativePattern } from 'vscode';
import * as jsonc from 'jsonc-parser';

export class WorkspaceParamWatcher {
	tasksWatcher!: FileSystemWatcher;
	lastRead: number = 0;
	params: Param[] = [];
	listeners: Array<(params: Param[]) => any> = [];

	constructor( workspaceFolder: WorkspaceFolder) {
		console.log('TaskFileWatcher created for', workspaceFolder.name);

		// workaround for bug: https://github.com/microsoft/vscode/issues/10633
		let tasksUri = workspaceFolder.uri.with({ path: `${workspaceFolder.uri.path}/.vscode/tasks.json` });

		// wait for changes of tasks.json
		let pattern = new RelativePattern(workspaceFolder, '.vscode/tasks.json');
		this.tasksWatcher = workspace.createFileSystemWatcher(pattern);
		this.tasksWatcher.onDidChange((tasksUri: Uri) => this.changeTriggersTwiceWorkaound(tasksUri));
		this.tasksWatcher.onDidCreate((tasksUri: Uri) => this.changeTriggersTwiceWorkaound(tasksUri));
		this.tasksWatcher.onDidDelete(() => this.listeners.forEach(listener => listener([])));

		// init status bar items
		this.changeTriggersTwiceWorkaound(tasksUri);
	}

	async changeTriggersTwiceWorkaound(tasksUri: Uri) {
		try {
			console.log('onDidChangeTriggersTwiceWorkaround');
			let stat = await workspace.fs.stat(tasksUri);
			// workaround for didChange event fired twice for one change
			let lastWrite = stat.mtime;
			if (lastWrite === this.lastRead) {
				return;
			}
			this.lastRead = lastWrite;
		} catch (err) {
			this.listeners.forEach(listener => listener([]));
			return;
		}

		this.tasksJsonChanged(tasksUri);
	}

	async tasksJsonChanged(tasksUri: Uri) {
		console.log('onTasksJsonChanged');
		try {
			let tasksFile = await workspace.fs.readFile(tasksUri);
			let tasks = jsonc.parse(tasksFile.toString());

			if (!tasks || !tasks.inputs) {
				return;
			}

			this.params = [];
			tasks.inputs.forEach((input: any) => {
				// ignore inputs not intended for this extension
				if (!tasks.command || !input.command.startsWith('statusBarParam.get.') || input.args.length === 0) {
					return;
				}
				this.params.push({
					name: input.id,
					command: input.command,
					values: input.args
				});
			});

			this.listeners.forEach((listener) => {
				listener(this.params);
			});
		} catch (err) {
			console.error("Couldn't parse tasks.json:", err);
		}
	}

	onParamsChanged(listener: (params: Param[]) => any) {
		this.listeners.push(listener);
	}

	dispose() {
		this.tasksWatcher.dispose();
	}

}

export interface Param {
	name: string;
	command: string;
	values: string[];
}