import { workspace, ExtensionContext, WorkspaceFolder, window, commands, Disposable, StatusBarItem, StatusBarAlignment } from 'vscode';
import { WorkspaceParamWatcher, Param } from './WorkspaceParamWatcher';
import * as jsonc from 'jsonc-parser';

interface WorkspaceData {
	watcher: WorkspaceParamWatcher;
	statusBarItems: Map<string, StatusBarItem>;
	disposables: Disposable[];
}

let workspaceFolderToData = new Map<WorkspaceFolder, WorkspaceData>();
let context!: ExtensionContext;

export function activate(con: ExtensionContext) {
	console.log('activated');

	context = con;

	// add command for creation of status bar items
	let command = commands.registerCommand('statusBarParam.add', addPramToTasksJson);
	context.subscriptions.push(command);

	// listen for changes of workspace folders
	let workspaceWatcher = workspace.onDidChangeWorkspaceFolders((e) => {
		e.added.forEach(workspaceFolder => workspaceFolderAdded(workspaceFolder));
		e.removed.forEach(workspaceFolder => workspaceFolderRemoved(workspaceFolder));
	});
	context.subscriptions.push(workspaceWatcher);

	// init workspace
	workspace.workspaceFolders?.forEach((workspaceFolder) => workspaceFolderAdded(workspaceFolder));
}

function workspaceFolderAdded(workspaceFolder: WorkspaceFolder) {
	console.log('workspaceFolderAdded', workspaceFolder.name);
	let watcher = new WorkspaceParamWatcher(workspaceFolder);
	let workspaceData = { watcher, statusBarItems: new Map(), disposables: [] };
	workspaceFolderToData.set(workspaceFolder, workspaceData);
	watcher.onParamsChanged((params) => paramsChanged(workspaceData, params));

	// init statusBarItems manually the first time
	paramsChanged(workspaceData, watcher.params);
}

function workspaceFolderRemoved(workspaceFolder: WorkspaceFolder) {
	console.log('workspaceFolderRemoved', workspaceFolder.name);
	let workspaceData = workspaceFolderToData.get(workspaceFolder);
	if (!workspaceData) {
		console.error('Removed workspace folder was not known');
		return;
	}
	clearWorkspaceData(workspaceData);
	workspaceFolderToData.delete(workspaceFolder);
}

function paramsChanged(workspaceData: WorkspaceData, params: Param[]) {
	console.log('paramsChanged');
	// remove old statusBarItems and commands
	clearWorkspaceData(workspaceData);
	// add new params
	params.forEach(param => addParamToStatusBar(workspaceData, param));
}

function addParamToStatusBar(workspaceData: WorkspaceData, param: Param) {
	console.log('addParamToStatusBar');
	// create command for selection of status bar param
	let commandIDSelectParam = `statusBarParam.select.${param.name}`;
	let commandIDPickParam = commands.registerCommand(commandIDSelectParam, async () => {
		let value = await window.showQuickPick(param.values);
		if (value === undefined || !statusBarItem.command) {
			return;
		}
		setStatusBarItemText(value, statusBarItem);
	});
	workspaceData.disposables.push(commandIDPickParam);

	// create status bar item
	let statusBarItem = window.createStatusBarItem(StatusBarAlignment.Left, 100);
	workspaceData.statusBarItems.set(param.command, statusBarItem);
	statusBarItem.command = commandIDSelectParam;
	let text: any = context.globalState.get(statusBarItem.command);
	if (!param.values.includes(text)) {
		text = param.values[0];
	}
	setStatusBarItemText(text, statusBarItem);
	workspaceData.disposables.push(statusBarItem);

	// return currently selected value of status bar param (when input:<input_id> is used in tasks.json)
	let commandGetParam = commands.registerCommand(param.command, () => statusBarItem.text);
	workspaceData.disposables.push(commandGetParam);

	statusBarItem.show();
}

function setStatusBarItemText(value: string, statusBarItem: StatusBarItem) {
	console.log('setStatusBarItemText');
	if (!statusBarItem.command) {
		return;
	}
	if (value === "") {
		value = " ";
	}
	context.globalState.update(statusBarItem.command, value);
	statusBarItem.text = value;
}

function clearWorkspaceData(workspaceData: WorkspaceData) {
	console.log('clearWorkspaceData');
	while (workspaceData.disposables.length > 0) {
		let disposable = workspaceData.disposables.pop();
		if (disposable) {
			disposable.dispose();
		}
	}
	workspaceData.statusBarItems.clear();
}

// this method is called when your extension is deactivated
export function deactivate() {
	workspaceFolderToData.forEach(workspaceData => {
		workspaceData.watcher.dispose();
		clearWorkspaceData(workspaceData);
	});

	console.log('deactivated');
}

async function addPramToTasksJson() {
	// check if there is a workspace where a tasks.json can be written
	let workspaceFolder;
	if (workspaceFolderToData.size === 0) {
		window.showWarningMessage('You need to open a folder first!');
	} else if (workspaceFolderToData.size === 1) {
		workspaceFolder = workspaceFolderToData.keys().next().value;
	} else {
		workspaceFolder = await window.showWorkspaceFolderPick({
			placeHolder: 'Select a workspace, in which tasks.json the created input should be stored.'
		});
	}
	if (!workspaceFolder) {
		return;
	}

	// get command id by input box
	let id = await window.showInputBox({
		prompt: 'Enter the input name, usable in tasks with ${input:<name>}.',
		validateInput: (value: string) => value.includes(' ') ? 'No spaces allowed here!' : undefined
	});
	if (!id) {
		window.showWarningMessage('Canceled adding status bar parameter. A status bar parameter needs a name to get used by ${input:<name>}!');
		return;
	}

	// get args by input box
	let args: string[] = [];
	let arg: string | undefined = "";
	let i = 1;
	while (true) {
		arg = await window.showInputBox({
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
		window.showWarningMessage('Canceled adding status bar parameter. Adding a status bar parameter without selectable values is not allowed!');
		return;
	}

	// read current tasks.json
	let tasksFile;
	let tasksUri = workspaceFolder.uri.with({ path: `${workspaceFolder.uri.path}/.vscode/tasks.json` });
	try {
		tasksFile = await workspace.fs.readFile(tasksUri);
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
			type: 'shell',
			command: `echo \"Current value of ${id} is '\${input:${id}}'\."`,
			problemMatcher: []
		});

		// add input
		if (!tasks.inputs) {
			tasks.inputs = [];
		}
		tasks.inputs.push({
			id,
			type: 'command',
			command: `statusBarParam.get.${id}`,
			args
		});

		workspace.fs.writeFile(tasksUri, Buffer.from(JSON.stringify(tasks, undefined, 4)));
	} catch (err) {
		console.error(err);
	}
}