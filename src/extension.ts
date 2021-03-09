import { workspace, ExtensionContext, window, commands, Uri, WorkspaceFolder, QuickPickItem } from 'vscode';
import { JsonFile } from './jsonFile';
import * as path from 'path';

const jsonFiles: JsonFile[] = [];
const workspaceInputFiles = ['.vscode/tasks.json', '.vscode/launch.json'];
let extensionContext: ExtensionContext;
let showNames: boolean;
let priority = 100;

export function getExtensionContext() {
	return extensionContext;
}

export function getShowNames() {
	return showNames;
}

export function activate(context: ExtensionContext) {
	console.debug('activate');

	extensionContext = context;

	// init showParamName value
	configurationChanged();

	// listen for settings changes
	const disposable = workspace.onDidChangeConfiguration(e => {
		console.debug('onDidChangeConfiguration');
		if (e.affectsConfiguration('statusBarParam')) {
			configurationChanged();
		}
	});
	context.subscriptions.push(disposable);

	// add command for creation of status bar items
	const command = commands.registerCommand('statusBarParam.add', addPramToJson);
	context.subscriptions.push(command);

	// listen for changes of workspace folders
	const workspaceWatcher = workspace.onDidChangeWorkspaceFolders((e) => {
		e.added.forEach(workspaceFolder => addWorkspaceFolder(workspaceFolder));
		e.removed.forEach(workspaceFolder => removeWorkspaceFolder(workspaceFolder));
	});
	context.subscriptions.push(workspaceWatcher);

	// listen for changes of the .code-workspace file
	if (workspace.workspaceFile && workspace.workspaceFile.scheme !== 'untitled') {
		addJsonFile(workspace.workspaceFile);
	}
	// init workspace
	workspace.workspaceFolders?.forEach((workspaceFolder) => addWorkspaceFolder(workspaceFolder));
}

function addWorkspaceFolder(workspaceFolder: WorkspaceFolder) {
	console.debug('addWorkspaceFolder', workspaceFolder.name);
	workspaceInputFiles.forEach(relativePath => {
		const jsonFile = JsonFile.FromInsideWorkspace(workspaceFolder, relativePath, priority--);
		jsonFiles.push(jsonFile);
	});
}

function addJsonFile(path: Uri) {
	console.debug('addJsonFile', path.toString());
	const jsonFile = JsonFile.FromOutsideWorkspace(path, priority--);
	jsonFiles.push(jsonFile);
}

function configurationChanged() {
	console.debug('configurationChanged');
	const currShowNames = workspace.getConfiguration('statusBarParam').get<boolean>('showNames');
	const currShowEdit = workspace.getConfiguration('statusBarParam').get<boolean>('showEdit');
	if (currShowNames !== undefined && showNames !== currShowNames) {
		showNames = currShowNames;
		jsonFiles.forEach(jsonFile => jsonFile.update());
	}
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
	let jsonFile: JsonFile | null = null;
	if (jsonFiles.length === 0) {
		window.showWarningMessage('You need to open a folder or workspace first!');
	} else if (jsonFiles.length === 1) {
		jsonFile = jsonFiles[0];
	} else {
		const items: QuickPickItem[] = jsonFiles.map(jsonFile => {
			return {
				label: path.basename(jsonFile.uri.fsPath),
				description: path.dirname(jsonFile.uri.fsPath),
				jsonFile
			};
		});
		const res: any = await window.showQuickPick(items, {
			placeHolder: "Select the file to store the input parameter in.",
			ignoreFocusOut: true
		});
		if (res) {
			jsonFile = res.jsonFile;
		}
	}
	if (!jsonFile) {
		return;
	}
	jsonFile.createParam();
}