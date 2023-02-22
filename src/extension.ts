import { workspace, ExtensionContext, window, commands, Uri, WorkspaceFolder, QuickPickItem } from 'vscode';
import { JsonFile } from './jsonFile';
import { Strings } from './strings';
import { Param } from './param';
import { ParameterProvider } from './parameterProvider';

const jsonFiles: JsonFile[] = [];
const workspaceInputFiles = ['.vscode/tasks.json', '.vscode/launch.json'];
let extensionContext: ExtensionContext;
let showNames: boolean;
let showSelections: boolean;
let priority = 100;

export function getExtensionContext() {
	return extensionContext;
}

export function getShowNames() {
	return showNames;
}

export function getShowSelections() {
	return showSelections;
}

export function activate(context: ExtensionContext) {
	console.debug('activate');
	extensionContext = context;

	// init extension configuration
	configurationChanged();

	// add disposables to the context array to be disposed at extension shutdown
	context.subscriptions.push(

		// listen for extension configuration changes
		workspace.onDidChangeConfiguration(e => {
			console.debug('onDidChangeConfiguration');
			if (e.affectsConfiguration(Strings.EXTENSION_ID)) {
				configurationChanged();
			}
		}),

		// add command for creation of a parameter
		commands.registerCommand(Strings.COMMAND_ADD, addPramToJson),
		// add command for creation of a parameter
		commands.registerCommand(Strings.COMMAND_RESET_SELECTIONS, clearSelections),
		// add command for selection of a value of a parameter
		createParamCommand(Strings.COMMAND_SELECT, (param) => param.onSelect()),
		// add command for editing of a parameter
		createParamCommand(Strings.COMMAND_EDIT, (param) => param.onEdit()),
		// add command for editing of a parameter
		createParamCommand(Strings.COMMAND_COPY_CMD, (param) => param.onCopyCmd()),
		// add command for deletion of a parameter
		createParamCommand(Strings.COMMAND_DELETE, (param) => param.onDelete()),

		// listen for changes of workspace folders
		workspace.onDidChangeWorkspaceFolders((e) => {
			e.added.forEach(addWorkspaceFolder);
			e.removed.forEach(workspaceFolder => removeWorkspaceFolder(workspaceFolder));
			ParameterProvider.onDidChangeTreeDataEmitter.fire();
		})
	);
	// listen for changes of the global user tasks.json
	addJsonFile(Uri.joinPath(context.globalStorageUri, '../../tasks.json'));
	// listen for changes of the .code-workspace file
	if (workspace.workspaceFile && workspace.workspaceFile.scheme !== 'untitled') {
		addJsonFile(workspace.workspaceFile);
	}

	// init workspace
	workspace.workspaceFolders?.forEach(addWorkspaceFolder);

	// register status bar param tab in file explorer
	window.registerTreeDataProvider(Strings.EXTENSION_ID, new ParameterProvider(jsonFiles));
}

function createParamCommand(commandString: string, cb: (param: Param) => any) {
	return commands.registerCommand(commandString, async (param?: Param) => {
		if (!param) {
			const items = jsonFiles.map(jsonFile => jsonFile.params).reduce((a, b) => a.concat(b)).map(param => {
				return {
					label: `$(${Param.getIcon(param).id}) ${param.input.id}`,
					description: param.onGet(),
					param
				};
			});
			const res: any = await window.showQuickPick(items, {
				placeHolder: "Select a parameter.",
			});
			param = res?.param;
		}
		if (param) {
			cb(param);
		}
	});
}

function addWorkspaceFolder(workspaceFolder: WorkspaceFolder) {
	console.debug('addWorkspaceFolder', workspaceFolder.name);
	workspaceInputFiles.forEach(relativePath => {
		const jsonFile = JsonFile.createFromPathInsideWorkspace(priority--, workspaceFolder, relativePath);
		jsonFiles.push(jsonFile);
	});
}

function addJsonFile(path: Uri) {
	console.debug('addJsonFile', path.fsPath);
	const jsonFile = JsonFile.createFromPathOutsideWorkspace(priority--, path);
	jsonFiles.push(jsonFile);
}

function configurationChanged(forcedReload: boolean = false) {
	console.debug('configurationChanged');
	const currShowNames = workspace.getConfiguration(Strings.EXTENSION_ID).get<boolean>('showNames', false);
	const currShowSelection = workspace.getConfiguration(Strings.EXTENSION_ID).get<boolean>('showSelections', true);

	if (forcedReload === true || showNames !== currShowNames || showSelections !== currShowSelection) {
		showNames = currShowNames;
		showSelections = currShowSelection;
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

async function addPramToJson(jsonFile?: JsonFile) {
	console.debug('addPramToJson');
	if (!jsonFile) {
		const items: QuickPickItem[] = jsonFiles.map(jsonFile => {
			return {
				label: jsonFile.getFileName(),
				description: jsonFile.getDescription(),
				jsonFile
			};
		});
		let placeHolder = "Select the file where the parameter should be saved.";
		if (jsonFiles.length <= 1) {
			placeHolder += " Open a workspace or folder to extend this list.";
		}
		const res: any = await window.showQuickPick(items, {
			placeHolder,
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

function clearSelections() {
	extensionContext.workspaceState.keys().forEach((element) => {
		extensionContext.workspaceState.update(element, undefined);
	});
	const forcedReload = true;
	configurationChanged(forcedReload);
} 