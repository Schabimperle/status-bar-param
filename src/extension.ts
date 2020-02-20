import * as vscode from 'vscode';
import * as fs from 'fs';

let statusBarItems: Map<string, vscode.StatusBarItem> = new Map();
let disposables: vscode.Disposable[] = [];
let lastRead: Date = new Date(0);
let tasksFilePath = '/Users/mschababerle/Documents/worspace/.vscode/tasks.json';

export function activate(context: vscode.ExtensionContext) {
	// wait for changes in tasks.json
	let watcher = vscode.workspace.createFileSystemWatcher('**/tasks.json');

	// on tasks.json changed
	watcher.onDidChange((event) => {
		fs.stat(tasksFilePath, function (err, stats) {

			// workaround for didChange event fired twice for one change
			let lastWrite = stats.mtime;
			if (lastWrite.getTime() == lastRead.getTime()) {
				return;
			}
			lastRead = lastWrite;
			onTasksJsonChanged(context);
		});
	});

	// init status bar items
	fs.stat(tasksFilePath, function (err, stats) {
		if (err) {
			console.error(err);
			return;
		}
		onTasksJsonChanged(context);
	});
}

function onTasksJsonChanged(context: vscode.ExtensionContext) {
	// parse tasks.json file
	let tasks = JSON.parse(fs.readFileSync(tasksFilePath).toString());

	// remove old statusBarItems and commands
	cleanup();

	// loop through input section of tasks.json
	tasks.inputs.forEach((input: any) => {

		// ignore inputs not intended for this extension
		if (!input.command.startsWith('statusBarParam.getSelected.')) {
			return;
		}
		addStatusBarParam(context, input.id, input.command, input.args);
	}); // end loop inputs
}

function addStatusBarParam(context: vscode.ExtensionContext, id: string, command: string, selectables: string[]) {
	// create command for selection of status bar param
	let commandIDSelect = `statusBarParam.select.${id}`;
	let commandSelectParam = vscode.commands.registerCommand(commandIDSelect, () => {
		onStatusBarItemClick(selectables, statusBarItem)
	});
	context.subscriptions.push(commandSelectParam);
	disposables.push(commandSelectParam);

	// create status bar item
	let statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
	statusBarItems.set(command, statusBarItem);
	statusBarItem.command = commandIDSelect;
	statusBarItem.text = `Select \${input:${id}}...`;
	context.subscriptions.push(statusBarItem);
	disposables.push(statusBarItem);
	
	// return currently selected value of status bar param (when input:<input_id> is used in tasks.json)
	let commandGetSelectedParam = vscode.commands.registerCommand(command, (...args: any[]): string | undefined => {
		let statusBarItem = statusBarItems.get(command);
		if (!statusBarItem) {
			return undefined;
		}
		return statusBarItem.text;
	});
	context.subscriptions.push(commandGetSelectedParam);
	disposables.push(commandGetSelectedParam);
	
	statusBarItem.show();
}

function onStatusBarItemClick(selectables: string[], statusBarItem: vscode.StatusBarItem) {
	vscode.window.showQuickPick(selectables).then((value) => {
		if (!value) {
			return;
		}
		// set status bar item text on selected value
		statusBarItem.text = value;
	});
}

function cleanup () {
	disposables.forEach(disposable => {
		disposable.dispose();
	});
	statusBarItems.clear();
}

// this method is called when your extension is deactivated
export function deactivate() {
	cleanup();
}
