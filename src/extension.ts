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
	// parse tasks.json file
	try {
		let tasksFile = await vscode.workspace.fs.readFile(tasksUri);
		let tasks = JSON.parse(tasksFile.toString().replace(/\s*\/\/.*\r?\n/g, ""));

		// remove old statusBarItems and commands
		cleanup();

		// loop through input section of tasks.json
		tasks.inputs.forEach((input: any) => {

			// ignore inputs not intended for this extension
			if (!input.command.startsWith('statusBarParam.getSelected.')) {
				return;
			}
			addStatusBarParam(input.id, input.command, input.args);
		}); // end loop inputs
	} catch (err) {
		console.log("Couldn't parse tasks.json", err);
	}
}

function addStatusBarParam(id: string, commandIDGetParam: string, selectables: string[]) {
	// create command for selection of status bar param
	let commandIDSelectParam = `statusBarParam.select.${id}`;
	let commandIDPickParam = vscode.commands.registerCommand(commandIDSelectParam, () => onClick(selectables, statusBarItem));
	context.subscriptions.push(commandIDPickParam);
	disposables.push(commandIDPickParam);

	// create status bar item
	let statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
	statusBarItems.set(commandIDGetParam, statusBarItem);
	statusBarItem.command = commandIDSelectParam;
	statusBarItem.text = `Select \${input:${id}}...`;
	context.subscriptions.push(statusBarItem);
	disposables.push(statusBarItem);

	// return currently selected value of status bar param (when input:<input_id> is used in tasks.json)
	let commandGetParam = vscode.commands.registerCommand(commandIDGetParam, () => onGetParam(statusBarItem));
	context.subscriptions.push(commandGetParam);
	disposables.push(commandGetParam);

	statusBarItem.show();
}

async function onClick(selectables: string[], statusBarItem: vscode.StatusBarItem) {
	let value = await vscode.window.showQuickPick(selectables);
	if (!value) {
		return;
	}
	// set status bar item text on selected value
	statusBarItem.text = value;
}

function onGetParam(statusBarItem: vscode.StatusBarItem) {
	if (!statusBarItem) {
		return undefined;
	}
	return statusBarItem.text;
}

function cleanup() {
	disposables.forEach(disposable => {
		disposable.dispose();
	});
	statusBarItems.clear();
}

// this method is called when your extension is deactivated
export function deactivate() {
	cleanup();
}
