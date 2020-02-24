import * as vscode from 'vscode';
import * as jsonc from 'jsonc-parser';

let statusBarItems: Map<string, vscode.StatusBarItem> = new Map();
let disposables: vscode.Disposable[] = [];
let lastRead: number = 0;
let context: vscode.ExtensionContext;
let tasksPath: string = `${vscode.workspace.rootPath}/.vscode/tasks.json`;
let tasksUri: vscode.Uri = vscode.Uri.file(tasksPath);

export function activate(this: any, con: vscode.ExtensionContext) {
	context = con;

	// wait for changes in tasks.json
	vscode.workspace.createFileSystemWatcher(tasksPath)
		.onDidChange(onDidChangeTriggersTwiceWorkaound);
	vscode.workspace.createFileSystemWatcher(tasksPath)
		.onDidCreate(onDidChangeTriggersTwiceWorkaound);
	vscode.workspace.createFileSystemWatcher(tasksPath)
		.onDidDelete(cleanup);
		
	// wait for changes of .vscode folder
	let tasksFolderPath = `${vscode.workspace.rootPath}/.vscode`;
	vscode.workspace.createFileSystemWatcher(tasksFolderPath)
		.onDidChange(onDidChangeTriggersTwiceWorkaound);
	vscode.workspace.createFileSystemWatcher(tasksFolderPath)
		.onDidDelete(cleanup);

	// add command for creation of status bar items
	let command = vscode.commands.registerCommand('statusBarParam.add', onAddPramToTasksJson);
	context.subscriptions.push(command);

	// init status bar items
	onDidChangeTriggersTwiceWorkaound();
}

async function onAddPramToTasksJson() {
	// get command id by input box
	let id = await vscode.window.showInputBox({
		prompt: "Enter the input name, usable in tasks with ${input:<name>}.",
		validateInput: (value: string) => value.includes(' ') ? 'No spaces allowed here' : undefined
	});
	if (!id) {
		vscode.window.showWarningMessage("Canceled adding status bar parameter. A status bar parameter needs a name to get used by ${input:<name>}!");
		return;
	}

	// get args by input box
	let args: string[] = [];
	let arg: string | undefined = "";
	let i = 1;
	while (true) {
		arg = await vscode.window.showInputBox({
			prompt: `Enter ${i++}. parameter, leave empty when finished.`
		});
		if (arg === '') {
			break;
		} else if (arg === undefined) {
			args = [];
			break;
		}
		args.push(arg);
	}
	if (args.length === 0) {
		vscode.window.showWarningMessage("Canceled adding status bar parameter. Adding a status bar parameter without selectable values is not allowed!");
		return;
	}

	// read current tasks.json
	let tasksFile;
	let tasksUri = vscode.Uri.file(tasksPath);
	try {
		tasksFile = await vscode.workspace.fs.readFile(tasksUri);
	} catch {
		tasksFile = '{}';
	}

	// add to current tasks.json
	try {
		let tasks = jsonc.parse(tasksFile.toString());
		if (!tasks) {
			tasks = {};
		}
				
		// add example task  
		if (!tasks.version) {
			tasks.version = "2.0.0";
		}
		if (!tasks.tasks) {
			tasks.tasks = [];
		}
		tasks.tasks.push({
			label: `echo value of ${id}`,
			type: "shell",
			command: `echo \"Current value of ${id} is '\${input:${id}}'\."`,
			problemMatcher: []
		});
		
		// add input
		if (!tasks.inputs) {
			tasks.inputs = [];
		}
		tasks.inputs.push({
			id,
			type: "command",
			command: `statusBarParam.getSelected.${id}`,
			args
		});

		vscode.workspace.fs.writeFile(tasksUri, Buffer.from(JSON.stringify(tasks, undefined, 4)));
	} catch (err) {
		console.error(err);
	}
}

async function onDidChangeTriggersTwiceWorkaound() {
	try {
		let stat = await vscode.workspace.fs.stat(tasksUri);
		// workaround for didChange event fired twice for one change
		let lastWrite = stat.mtime;
		if (lastWrite === lastRead) {
			return;
		}
		lastRead = lastWrite;
	} catch (err) {
		cleanup();
		return;
	}

	onTasksJsonChanged();
}

async function onTasksJsonChanged() {
	try {
		let tasksFile = await vscode.workspace.fs.readFile(tasksUri);
		let tasks = jsonc.parse(tasksFile.toString());

		// remove old statusBarItems and commands
		cleanup();

		if (!tasks || !tasks.inputs) {
			return;
		}

		tasks.inputs.forEach((input: any) => {
			// ignore inputs not intended for this extension
			if (!input.command.startsWith('statusBarParam.getSelected.') || input.args.length === 0) {
				return;
			}
			addParamToStatusBar(input.id, input.command, input.args);
		});
	} catch (err) {
		console.error("Couldn't parse tasks.json:", err);
	}
}

function addParamToStatusBar(id: string, commandIDGetParam: string, selectables: string[]) {
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
