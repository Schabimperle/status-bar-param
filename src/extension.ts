import { workspace, ExtensionContext, WorkspaceFolder, window, commands, Disposable, StatusBarItem, StatusBarAlignment } from 'vscode';
import { WorkspaceParamWatcher, Param } from './WorkspaceParamWatcher';
import * as jsonc from 'jsonc-parser';

interface StatusBarParam {
	statusBarItem: StatusBarItem;
	param: Param;
	selectedValue: string;
}

interface WorkspaceData {
	watcher: WorkspaceParamWatcher;
	statusBarParams: StatusBarParam[];
	disposables: Disposable[];
}

let workspaceFolderToData = new Map<WorkspaceFolder, WorkspaceData>();
let context: ExtensionContext;
let showParamName: boolean = false;

export function activate(con: ExtensionContext) {
	console.log('activated');

	context = con;

	// init showParamName value
	showParamNameChanged();

	// listen for config changes
	let disposable = workspace.onDidChangeConfiguration(e => {
		console.log('on did change config');
		if (e.affectsConfiguration('statusBarParam')) {
			showParamNameChanged();
		}
	});
	context.subscriptions.push(disposable);

	// add command for creation of status bar items
	let command = commands.registerCommand('statusBarParam.add', addPramToTasksJson);
	context.subscriptions.push(command);

	// listen for changes of workspace folders
	let workspaceWatcher = workspace.onDidChangeWorkspaceFolders((e) => {
		e.added.forEach(workspaceFolder => addWorkspaceFolder(workspaceFolder));
		e.removed.forEach(workspaceFolder => removeWorkspaceFolder(workspaceFolder));
	});
	context.subscriptions.push(workspaceWatcher);

	// init workspace
	workspace.workspaceFolders?.forEach((workspaceFolder) => addWorkspaceFolder(workspaceFolder));
}

function addWorkspaceFolder(workspaceFolder: WorkspaceFolder) {
	console.log('workspaceFolderAdded', workspaceFolder.name);
	let watcher = new WorkspaceParamWatcher(workspaceFolder);
	let workspaceData = { watcher, statusBarParams: [], disposables: [] };
	workspaceFolderToData.set(workspaceFolder, workspaceData);
	watcher.onParamsChanged((params) => paramsChanged(workspaceData, params));

	// init statusBarItems manually the first time
	paramsChanged(workspaceData, watcher.params);
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

	// create status bar item
	let commandIDSelectParam = `statusBarParam.select.${param.name}`;
	let statusBarItem = window.createStatusBarItem(StatusBarAlignment.Left, 100);
	statusBarItem.command = commandIDSelectParam;
	let selectedValue: string = context.workspaceState.get(statusBarItem.command) || param.values[0];
	let statusBarParam = { statusBarItem, param, selectedValue };
	workspaceData.statusBarParams.push(statusBarParam);
	updateStatusBarParamText(statusBarParam);
	workspaceData.disposables.push(statusBarItem);
	
	// create command for selection of status bar param
	let commandIDPickParam = commands.registerCommand(commandIDSelectParam, async () => {
		let value = await window.showQuickPick(param.values);
		if (value === undefined || !statusBarItem.command) {
			return;
		}
		statusBarParam.selectedValue = value;
		updateStatusBarParamText(statusBarParam);
	});
	workspaceData.disposables.push(commandIDPickParam);
	
	// create command to retrieve the selected value (when input:<input_id> is used in tasks.json)
	let commandGetParam = commands.registerCommand(param.command, () => statusBarParam.selectedValue);
	workspaceData.disposables.push(commandGetParam);

	statusBarItem.show();
}

function updateStatusBarParamText(statusBarParam: StatusBarParam) {
	console.log('updateStatusBarParamText');
	if (!statusBarParam.statusBarItem.command) {
		return;
	}
	let text = statusBarParam.selectedValue;
	if (text === "") {
		text = " ";
	}
	if (showParamName) {
		text = `${statusBarParam.param.name}: ${text}`;
	}
	context.workspaceState.update(statusBarParam.statusBarItem.command, statusBarParam.selectedValue);
	statusBarParam.statusBarItem.text = text;
}

function showParamNameChanged() {
	let value = workspace.getConfiguration('statusBarParam').get<boolean>('showParamName');
	if (value === undefined || showParamName === value) {
		return;
	}
	showParamName = value;
	for (let workspaceData of workspaceFolderToData.values()) {
		workspaceData.statusBarParams.forEach(statusBarParam => {
			updateStatusBarParamText(statusBarParam);
		});
	}
}

function removeWorkspaceFolder(workspaceFolder: WorkspaceFolder) {
	console.log('workspaceFolderRemoved', workspaceFolder.name);
	let workspaceData = workspaceFolderToData.get(workspaceFolder);

	if (!workspaceData) {
		console.error('Removed workspace folder was not known');
		return;
	}

	workspaceData.watcher.dispose();
	clearWorkspaceData(workspaceData);
	workspaceFolderToData.delete(workspaceFolder);
}

function clearWorkspaceData(workspaceData: WorkspaceData) {
	console.log('clearWorkspaceData');
	while (workspaceData.disposables.length > 0) {
		let disposable = workspaceData.disposables.pop();
		if (disposable) {
			disposable.dispose();
		}
	}
	workspaceData.statusBarParams = [];
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
			placeHolder: 'Select a workspace, where the created input should be stored in the tasks.json.'
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
		tasksFile = (await workspace.fs.readFile(tasksUri)).toString();
	} catch {
		tasksFile = '{}';
	}

	// add to current tasks.json
	try {
		let tasks = jsonc.parse(tasksFile);
		if (!tasks) {
			tasks = {};
		}

		// add example task
		if (!tasks.version) {
			tasksFile = jsonc.applyEdits(tasksFile, jsonc.modify(tasksFile, ['version'], "2.0.0", {formattingOptions: {}}));
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
		tasksFile = jsonc.applyEdits(tasksFile, jsonc.modify(tasksFile, ['tasks'], tasks.tasks, {formattingOptions: {}}));

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
		tasksFile = jsonc.applyEdits(tasksFile, jsonc.modify(tasksFile, ['inputs'], tasks.inputs, {formattingOptions: {}}));

		workspace.fs.writeFile(tasksUri, Buffer.from(tasksFile));
		// workspace.fs.writeFile(tasksUri, Buffer.from(JSON.stringify(tasks, undefined, 4)));
	} catch (err) {
		console.error(err);
	}
}