import { workspace, ExtensionContext, window, commands, Uri, WorkspaceFolder, QuickPickItem } from 'vscode';
import { JsonFile } from './jsonFile';
import * as jsonc from 'jsonc-parser';
import * as path from 'path';

let jsonFiles: JsonFile[] = [];
let workspaceInputFiles = ['.vscode/tasks.json', '.vscode/launch.json'];
let extensionContext: ExtensionContext;
let showParamNames: boolean;
let priority = 100;

export function getExtensionContext() {
	return extensionContext;
}

export function getShowParamNames() {
	return extensionContext;
}

export function activate(context: ExtensionContext) {
	console.debug('activate');

	extensionContext = context;

	// init showParamName value
	configurationChanged();

	// listen for settings changes
	let disposable = workspace.onDidChangeConfiguration(e => {
		console.debug('onDidChangeConfiguration');
		if (e.affectsConfiguration('statusBarParam')) {
			configurationChanged();
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
	console.debug('addWorkspaceFolder', workspaceFolder.name);
	workspaceInputFiles.forEach(relativePath => {
		let jsonFile = JsonFile.FromInsideWorkspace(workspaceFolder, relativePath, priority--);
		jsonFiles.push(jsonFile);
	});
}

function addJsonFile(path: Uri) {
	console.debug('addJsonFile', path.toString());
	let jsonFile = JsonFile.FromOutsideWorkspace(path, priority--);
	jsonFiles.push(jsonFile);
}

function configurationChanged() {
	console.debug('configurationChanged');
	let value = workspace.getConfiguration('statusBarParam').get<boolean>('showNames');
	if (value === undefined || showParamNames === value) {
		return;
	}
	showParamNames = value;
	jsonFiles.forEach(jsonFile => jsonFile.update());
}

function removeWorkspaceFolder(workspaceFolder: WorkspaceFolder) {
	console.debug('removeWorkspaceFolder', workspaceFolder.name);
	jsonFiles.forEach(jsonFile => {
		if (jsonFile.workspaceFolder === workspaceFolder) {
			jsonFile.dispose();
		}
	});
}

// this method is called when your extension is deactivated
export function deactivate() {
	console.debug('deactivate');
	jsonFiles.forEach(jsonFile => jsonFile.dispose());
}

async function addPramToJson() {
	console.debug('addPramToJson');
	// check if there is a workspace where a tasks.json can be written
	let jsonFile: Uri | null = null;
	if (jsonFiles.length === 0) {
		window.showWarningMessage('You need to open a folder or workspace first!');
	} else if (jsonFiles.length === 1) {
		jsonFile = jsonFiles[0].uri;
	} else {
		// jsonFile = await window.showWorkspaceFolderPick({
		// 	placeHolder: 'Select a json, where the created input should be stored.'
		// });
		let items: QuickPickItem[] = jsonFiles.map(jsonFile => {
			return {
				label: path.basename(jsonFile.uri.fsPath),
				description: path.dirname(jsonFile.uri.fsPath),
				uri: jsonFile.uri
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