import * as vscode from 'vscode';

let statusBarItems: Map<string, vscode.StatusBarItem> = new Map();
let disposables: vscode.Disposable[] = [];
let lastRead: number = 0;
let context: vscode.ExtensionContext;
let tasksPath: string = `${vscode.workspace.rootPath}/.vscode/tasks.json`;

export function activate(this: any, con: vscode.ExtensionContext) {
	context = con;
	// wait for changes in tasks.json
	vscode.workspace.createFileSystemWatcher(tasksPath)
		.onDidChange(onDidChangeTwiceWorkaound);
	vscode.workspace.createFileSystemWatcher(tasksPath)
		.onDidCreate(onDidChangeTwiceWorkaound);
	vscode.workspace.createFileSystemWatcher(tasksPath)
		.onDidDelete(cleanup);

	// init status bar items
	onDidChangeTwiceWorkaound(vscode.Uri.file(tasksPath));
}

async function onDidChangeTwiceWorkaound(tasksUri: vscode.Uri) {
	try {
		let stat = await vscode.workspace.fs.stat(tasksUri);
		// workaround for didChange event fired twice for one change
		let lastWrite = stat.mtime;
		if (lastWrite === lastRead) {
			return;
		}
		lastRead = lastWrite;
	} catch (err) {
		console.log("Can't open tasks.json: ", err);
		return;
	}

	onTasksJsonChanged(tasksUri);
}

async function onTasksJsonChanged(tasksUri: vscode.Uri) {
	try {
		let tasksFile = await vscode.workspace.fs.readFile(tasksUri);
		let tasks = JSON.parse(tasksFile.toString().replace(/\s*\/\/.*\r?\n/g, ""));

		// remove old statusBarItems and commands
		cleanup();

		tasks.inputs.forEach((input: any) => {
			// ignore inputs not intended for this extension
			if (!input.command.startsWith('statusBarParam.getSelected.') || input.args.length === 0) {
				return;
			}
			addStatusBarParam(input.id, input.command, input.args);
		});
	} catch (err) {
		console.log("Couldn't parse tasks.json", err);
	}
}

function addStatusBarParam(id: string, commandIDGetParam: string, selectables: string[]) {
	// create command for selection of status bar param
	let commandIDSelectParam = `statusBarParam.select.${id}`;
	let commandIDPickParam = vscode.commands.registerCommand(commandIDSelectParam, async () => {
		let value = await vscode.window.showQuickPick(selectables);
		if (value === undefined || !statusBarItem.command) {
			return;
		}
		setStatusBarItemText(value, statusBarItem);
	});
	context.subscriptions.push(commandIDPickParam);
	disposables.push(commandIDPickParam);

	// create status bar item
	let statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
	statusBarItems.set(commandIDGetParam, statusBarItem);
	statusBarItem.command = commandIDSelectParam;
	let text: any = context.workspaceState.get(statusBarItem.command);
	if (!selectables.includes(text)) {
		text = selectables[0];
	}
	setStatusBarItemText(text, statusBarItem);
	context.subscriptions.push(statusBarItem);
	disposables.push(statusBarItem);

	// return currently selected value of status bar param (when input:<input_id> is used in tasks.json)
	let commandGetParam = vscode.commands.registerCommand(commandIDGetParam, () => statusBarItem.text);
	context.subscriptions.push(commandGetParam);
	disposables.push(commandGetParam);

	statusBarItem.show();
}

async function setStatusBarItemText(value: string, statusBarItem: vscode.StatusBarItem) {
	if (!statusBarItem.command) {
		return;
	}
	if (value === "") {
		value = " ";
	}
	context.workspaceState.update(statusBarItem.command, value);
	statusBarItem.text = value;
}

function cleanup() {
	while (disposables.length > 0) {
		let disposable = disposables.pop();
		if (disposable) {
			disposable.dispose();
		}
	}
	statusBarItems.clear();
}

// this method is called when your extension is deactivated
export function deactivate() {
	cleanup();
}
