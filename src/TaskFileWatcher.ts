import { StatusBarItem, Disposable, workspace, Uri, WorkspaceFolder, commands, window, StatusBarAlignment, ExtensionContext, RelativePattern } from 'vscode';
import * as jsonc from 'jsonc-parser';

export class TaskFileWatcher {
	context!: ExtensionContext;
	statusBarItems: Map<string, StatusBarItem> = new Map();
	disposables: Disposable[] = [];
	tasksWatcher!: Disposable;
	lastRead: number = 0;
	
	constructor(context: ExtensionContext, workspaceFolder: WorkspaceFolder) {
		this.context = context;
		console.log('TaskFileWatcher created for ', workspaceFolder.name);
		
		// workaround for bug: https://github.com/microsoft/vscode/issues/10633
		let tasksUri = workspaceFolder.uri.with({path: `${workspaceFolder.uri.path}/.vscode/tasks.json`});

		// wait for changes of tasks.json
		let pattern = new RelativePattern(workspaceFolder, '.vscode/tasks.json');
		let tasksWatcher = workspace.createFileSystemWatcher(pattern);
		tasksWatcher.onDidChange((tasksUri: Uri) => this.onDidChangeTriggersTwiceWorkaound(tasksUri));
		tasksWatcher.onDidCreate((tasksUri: Uri) => this.onDidChangeTriggersTwiceWorkaound(tasksUri));
		tasksWatcher.onDidDelete(() => this.cleanupStatusBarItems());
		
		// init status bar items
		this.onDidChangeTriggersTwiceWorkaound(tasksUri);
	}

	async onDidChangeTriggersTwiceWorkaound(tasksUri: Uri) {
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
			this.cleanupStatusBarItems();
			return;
		}

		this.onTasksJsonChanged(tasksUri);
	}

	async onTasksJsonChanged(tasksUri: Uri) {
		console.log('onTasksJsonChanged');
		try {
			let tasksFile = await workspace.fs.readFile(tasksUri);
			let tasks = jsonc.parse(tasksFile.toString());

			// remove old statusBarItems and commands
			this.cleanupStatusBarItems();

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
		console.log('addParamToStatusBar');
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
		console.log('setStatusBarItemText');
		if (!statusBarItem.command) {
			return;
		}
		if (value === "") {
			value = " ";
		}
		this.context.globalState.update(statusBarItem.command, value);
		statusBarItem.text = value;
	}

	cleanupStatusBarItems() {
		console.log('cleanup');
		while (this.disposables.length > 0) {
			let disposable = this.disposables.pop();
			if (disposable) {
				disposable.dispose();
			}
		}
		this.statusBarItems.clear();
	}

	cleanup() {
		this.cleanupStatusBarItems();
		this.tasksWatcher.dispose();
	}

}