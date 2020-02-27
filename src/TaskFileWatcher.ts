import { StatusBarItem, Disposable, workspace, Uri, WorkspaceFolder, commands, window, StatusBarAlignment, ExtensionContext } from 'vscode';
import * as jsonc from 'jsonc-parser';

export class TaskFileWatcher {
	context!: ExtensionContext;
	statusBarItems: Map<string, StatusBarItem> = new Map();
	disposables: Disposable[] = [];
	lastRead: number = 0;
	vscodeFolder!: Uri;
	tasksFile!: Uri;
	
	constructor(context: ExtensionContext, workspaceFolder: WorkspaceFolder) {
		this.context = context;
		this.vscodeFolder = workspaceFolder.uri.with({path: `${workspaceFolder.uri.path}/.vscode`});
		this.tasksFile = workspaceFolder.uri.with({path: `${workspaceFolder.uri.path}/.vscode/tasks.json`});
		
		// wait for changes of .vscode folder
		let vscodeFolderWatcher = workspace.createFileSystemWatcher(this.vscodeFolder.path);
		vscodeFolderWatcher.onDidChange(this.onDidChangeTriggersTwiceWorkaound);
		vscodeFolderWatcher.onDidCreate(this.onDidChangeTriggersTwiceWorkaound);
		vscodeFolderWatcher.onDidDelete(this.cleanup);
		this.disposables.push(vscodeFolderWatcher);
		
		// wait for changes of tasks.json
		let tasksWatcher = workspace.createFileSystemWatcher(this.tasksFile.path);
		tasksWatcher.onDidChange(this.onDidChangeTriggersTwiceWorkaound);
		tasksWatcher.onDidCreate(this.onDidChangeTriggersTwiceWorkaound);
		tasksWatcher.onDidDelete(this.cleanup);
		this.disposables.push(tasksWatcher);

		// init status bar items
		this.onDidChangeTriggersTwiceWorkaound();
	}

	async onDidChangeTriggersTwiceWorkaound() {
		try {
			let stat = await workspace.fs.stat(this.tasksFile);
			// workaround for didChange event fired twice for one change
			let lastWrite = stat.mtime;
			if (lastWrite === this.lastRead) {
				return;
			}
			this.lastRead = lastWrite;
		} catch (err) {
			this.cleanup();
			return;
		}

		this.onTasksJsonChanged();
	}

	async onTasksJsonChanged() {
		try {
			let tasksFile = await workspace.fs.readFile(this.tasksFile);
			let tasks = jsonc.parse(tasksFile.toString());

			// remove old statusBarItems and commands
			this.cleanup();

			if (!tasks || !tasks.inputs) {
				return;
			}

			tasks.inputs.forEach((input: any) => {
				// ignore inputs not intended for this extension
				if (!input.command.startsWith('statusBarParam.getSelected.') || input.args.length === 0) {
					return;
				}
				this.addParamToStatusBar(input.id, input.command, input.args);
			});
		} catch (err) {
			console.error("Couldn't parse tasks.json:", err);
		}
	}

	addParamToStatusBar(id: string, commandIDGetParam: string, selectables: string[]) {
		// create command for selection of status bar param
		let commandIDSelectParam = `statusBarParam.select.${id}`;
		let commandIDPickParam = commands.registerCommand(commandIDSelectParam, async () => {
			let value = await window.showQuickPick(selectables);
			if (value === undefined || !statusBarItem.command) {
				return;
			}
			this.setStatusBarItemText(value, statusBarItem);
		});
		this.disposables.push(commandIDPickParam);

		// create status bar item
		let statusBarItem = window.createStatusBarItem(StatusBarAlignment.Left, 100);
		this.statusBarItems.set(commandIDGetParam, statusBarItem);
		statusBarItem.command = commandIDSelectParam;
		let text: any = this.context.globalState.get(statusBarItem.command);
		if (!selectables.includes(text)) {
			text = selectables[0];
		}
		this.setStatusBarItemText(text, statusBarItem);
		this.disposables.push(statusBarItem);

		// return currently selected value of status bar param (when input:<input_id> is used in tasks.json)
		let commandGetParam = commands.registerCommand(commandIDGetParam, () => statusBarItem.text);
		this.disposables.push(commandGetParam);

		statusBarItem.show();
	}

	async setStatusBarItemText(value: string, statusBarItem: StatusBarItem) {
		if (!statusBarItem.command) {
			return;
		}
		if (value === "") {
			value = " ";
		}
		this.context.globalState.update(statusBarItem.command, value);
		statusBarItem.text = value;
	}

	cleanup() {
		while (this.disposables.length > 0) {
			let disposable = this.disposables.pop();
			if (disposable) {
				disposable.dispose();
			}
		}
		this.statusBarItems.clear();
	}

}