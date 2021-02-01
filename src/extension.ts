import { workspace, ExtensionContext, window, commands, Disposable, StatusBarItem, StatusBarAlignment, Uri, WorkspaceFolder, QuickPickItem } from 'vscode';
import { JsonWatcher } from './JsonWatcher';
import { Param, Command } from './Param';
import * as jsonc from 'jsonc-parser';
import * as path from 'path';

interface StatusBarParam {
	statusBarItem: StatusBarItem;
	param: Param;
	selectedValue: string;
}

interface JsonFileMetaData {
	watcher: JsonWatcher;
	statusBarParams: StatusBarParam[];
	disposables: Disposable[];
}

let jsonFileToMetaData = new Map<Uri, JsonFileMetaData>();
let context: ExtensionContext;
let showParamName: boolean = false;
let workspaceInputFiles = ['.vscode/tasks.json', '.vscode/launch.json'];

export function activate(con: ExtensionContext) {
	console.log('activated');

	context = con;

	// init showParamName value
	showParamNameChanged();

	// listen for settings changes
	let disposable = workspace.onDidChangeConfiguration(e => {
		console.log('onDidChangeConfiguration');
		if (e.affectsConfiguration('statusBarParam')) {
			showParamNameChanged();
		}
	});
	context.subscriptions.push(disposable);

	// add command for creation of status bar items
	let command = commands.registerCommand('statusBarParam.add', addPramToJson);
	context.subscriptions.push(command);

	// listen for changes of workspace folders
	let workspaceWatcher = workspace.onDidChangeWorkspaceFolders((e) => {
		e.added.forEach(workspaceFolder => addWorkspaceFolder(workspaceFolder));
		e.removed.forEach(workspaceFolder => removeWorkspaceFolder(workspaceFolder));
	});
	context.subscriptions.push(workspaceWatcher);

	// listen for changes of the .code-workspace file
	if (workspace.workspaceFile && workspace.workspaceFile.scheme !== 'untitled:') {
		addJsonFile(workspace.workspaceFile);
	}
	// init workspace
	workspace.workspaceFolders?.forEach((workspaceFolder) => addWorkspaceFolder(workspaceFolder));
}

function addWorkspaceFolder(workspaceFolder: WorkspaceFolder) {
	console.log('addWorkspaceFolder', workspaceFolder.name);
	workspaceInputFiles.forEach(relativePath => {
		let watcher = JsonWatcher.FromInsideWorkspace(workspaceFolder, relativePath);
		let workspaceData = { watcher, statusBarParams: [], disposables: [] };
		jsonFileToMetaData.set(workspaceFolder.uri.with({ path: `${workspaceFolder.uri.path}/${relativePath}` }), workspaceData);
		watcher.onParamsChanged((params) => paramsChanged(workspaceData, params));

		// init statusBarItems manually the first time
		paramsChanged(workspaceData, watcher.params);
	});
}

function addJsonFile(jsonFile: Uri) {
	console.log('addJsonFile', jsonFile.toString());
	let watcher = JsonWatcher.FromOutsideWorkspace(jsonFile);
	let jsonFileMetaData = { watcher, statusBarParams: [], disposables: [] };
	jsonFileToMetaData.set(jsonFile, jsonFileMetaData);
	watcher.onParamsChanged((params) => paramsChanged(jsonFileMetaData, params));

	// init statusBarItems manually the first time
	paramsChanged(jsonFileMetaData, watcher.params);
}

function paramsChanged(jsonFileMetaData: JsonFileMetaData, params: Param[]) {
	console.log('paramsChanged');
	// remove old statusBarItems and commands
	clearJsonFileMetaData(jsonFileMetaData);
	// add new params
	params.forEach(param => addParamToStatusBar(jsonFileMetaData, param));
}

async function addParamToStatusBar(jsonFileMetaData: JsonFileMetaData, param: Param) {
	console.log('addParamToStatusBar', param.name);

	// create status bar item
	let statusBarItem = window.createStatusBarItem(StatusBarAlignment.Left, 100);
	statusBarItem.command = `statusBarParam.select.${param.name}`;
	let selectedValue: string | undefined = context.workspaceState.get(statusBarItem.command);
	if (!selectedValue) {
		let values = await param.getValues();
		if (!values) {
			return;
		}
		selectedValue = values[0];
	}
	let statusBarParam = { statusBarItem, param, selectedValue };
	jsonFileMetaData.statusBarParams.push(statusBarParam);
	updateStatusBarParamText(statusBarParam);
	jsonFileMetaData.disposables.push(statusBarItem);

	// create command for selection of status bar param
	try {
		// create command to retrieve the selected value (when input:<input_id> is used in json)
		let commandGetParam = commands.registerCommand(param.command, () => statusBarParam.selectedValue);
		jsonFileMetaData.disposables.push(commandGetParam);

		let commandIDPickParam = commands.registerCommand(statusBarItem.command, async () => {
			let value = await window.showQuickPick(param.getValues());
			if (value === undefined || !statusBarItem.command) {
				return;
			}
			statusBarParam.selectedValue = value;
			updateStatusBarParamText(statusBarParam);
		});
		jsonFileMetaData.disposables.push(commandIDPickParam);

		statusBarItem.show();
	} catch (err) {
		console.error(err);
		if (err instanceof Error) {
			window.showErrorMessage(err.message);
		}
	}
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
	context.workspaceState.update(statusBarParam.statusBarItem.command.toString(), statusBarParam.selectedValue);
	statusBarParam.statusBarItem.text = text;
}

function showParamNameChanged() {
	let value = workspace.getConfiguration('statusBarParam').get<boolean>('showNames');
	if (value === undefined || showParamName === value) {
		return;
	}
	showParamName = value;
	for (let workspaceData of jsonFileToMetaData.values()) {
		workspaceData.statusBarParams.forEach(statusBarParam => {
			updateStatusBarParamText(statusBarParam);
		});
	}
}

function removeWorkspaceFolder(workspaceFolder: WorkspaceFolder) {
	console.log('removeWorkspaceFolder', workspaceFolder.name);
	workspaceInputFiles.forEach(relativePath => {
		let uri = workspaceFolder.uri.with({ path: `${workspaceFolder.uri.path}/${relativePath}` });
		let jsonFileMetaData = jsonFileToMetaData.get(uri);

		if (!jsonFileMetaData) {
			console.error('Removed json file was not known');
			return;
		}

		jsonFileMetaData.watcher.dispose();
		clearJsonFileMetaData(jsonFileMetaData);
		jsonFileToMetaData.delete(uri);
	});
}

function clearJsonFileMetaData(jsonFileMetaData: JsonFileMetaData) {
	console.log('clearJsonFile');
	while (jsonFileMetaData.disposables.length > 0) {
		let disposable = jsonFileMetaData.disposables.pop();
		if (disposable) {
			disposable.dispose();
		}
	}
	jsonFileMetaData.statusBarParams = [];
}

// this method is called when your extension is deactivated
export function deactivate() {
	jsonFileToMetaData.forEach(jsonFileMetaData => {
		jsonFileMetaData.watcher.dispose();
		clearJsonFileMetaData(jsonFileMetaData);
	});

	console.log('extension deactivated');
}

async function addPramToJson() {
	// check if there is a workspace where a tasks.json can be written
	let jsonFile: Uri | null = null;
	if (jsonFileToMetaData.size === 0) {
		window.showWarningMessage('You need to open a folder or workspace first!');
	} else if (jsonFileToMetaData.size === 1) {
		jsonFile = jsonFileToMetaData.keys().next().value;
	} else {
		// jsonFile = await window.showWorkspaceFolderPick({
		// 	placeHolder: 'Select a json, where the created input should be stored.'
		// });
		let items: QuickPickItem[] = [...jsonFileToMetaData.keys()].map(uri => {
			return {
				label: path.basename(uri.fsPath),
				description: path.dirname(uri.fsPath),
				uri: uri
			};
		});
		let res: any = await window.showQuickPick(items,);
		if (res) {
			jsonFile = res.uri;
		}
	}
	if (!jsonFile) {
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
	let fileContent;
	try {
		fileContent = (await workspace.fs.readFile(jsonFile)).toString();
	} catch {
		fileContent = '{}';
	}

	// add to json
	try {
		let rootNode = jsonc.parse(fileContent);
		if (!rootNode) {
			rootNode = {};
		}
		let tasksRoot = rootNode;
		let versionPath = ['version'];
		let tasksPath = ['tasks'];
		let inputsPath = ['inputs'];

		if (jsonFile.path.endsWith('.code-workspace')) {
			if (!rootNode.tasks) {
				rootNode.tasks = {};
			}
			tasksRoot = rootNode.tasks;
			versionPath.unshift('tasks');
			tasksPath.unshift('tasks');
			inputsPath.unshift('tasks');
		}

		if (!jsonFile.path.endsWith('launch.json')) {
			if (!rootNode.version) {
				fileContent = jsonc.applyEdits(fileContent, jsonc.modify(fileContent, versionPath, "2.0.0", { formattingOptions: {} }));
			}
			if (!tasksRoot.tasks) {
				tasksRoot.tasks = [];
			}
			// add example task
			tasksRoot.tasks.push({
				label: `echo value of ${id}`,
				type: 'shell',
				command: `echo \"Current value of ${id} is '\${input:${id}}'\."`,
				problemMatcher: []
			});
			fileContent = jsonc.applyEdits(fileContent, jsonc.modify(fileContent, tasksPath, tasksRoot.tasks, { formattingOptions: {} }));
		}
		// add input
		if (!tasksRoot.inputs) {
			tasksRoot.inputs = [];
		}
		tasksRoot.inputs.push({
			id,
			type: 'command',
			command: `statusBarParam.get.${id}`,
			args
		});
		fileContent = jsonc.applyEdits(fileContent, jsonc.modify(fileContent, inputsPath, tasksRoot.inputs, { formattingOptions: {} }));

		workspace.fs.writeFile(jsonFile, Buffer.from(fileContent));
		// workspace.fs.writeFile(tasksUri, Buffer.from(JSON.stringify(tasks, undefined, 4)));
	} catch (err) {
		console.error(err);
	}
}