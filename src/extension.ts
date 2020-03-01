import { workspace, ExtensionContext, WorkspaceFolder, window, commands } from 'vscode';
import { TaskFileWatcher } from './TaskFileWatcher';
import * as jsonc from 'jsonc-parser';

let taskFileWatchers: Map<WorkspaceFolder, TaskFileWatcher> = new Map();

export function activate(context: ExtensionContext) {
	console.log('activated');

	// add command for creation of status bar items
	let command = commands.registerCommand('statusBarParam.add', onAddPramToTasksJson);
	context.subscriptions.push(command);

	let workspaceWatcher = workspace.onDidChangeWorkspaceFolders((e) => {
		e.added.forEach((workspaceFolder) => onWorkspaceFolderAdded(context, workspaceFolder));
		e.removed.forEach(onWorkspaceFolderRemoved);
	});
	context.subscriptions.push(workspaceWatcher);

	if (!workspace.workspaceFolders) {
		return;
	}
	workspace.workspaceFolders.forEach((workspaceFolder) => onWorkspaceFolderAdded(context, workspaceFolder));
}

function onWorkspaceFolderAdded(context: ExtensionContext, workspaceFolder: WorkspaceFolder) {
	taskFileWatchers.set(workspaceFolder, new TaskFileWatcher(context, workspaceFolder));
}

function onWorkspaceFolderRemoved(workspaceFolder: WorkspaceFolder) {
	let taskFileWatcher = taskFileWatchers.get(workspaceFolder);
	if (!taskFileWatcher) {
		return;
	}
	taskFileWatcher.cleanup();
	taskFileWatchers.delete(workspaceFolder);
}

async function onAddPramToTasksJson() {
	// check if there is a workspace opened where a tasks.json can be written
	if (taskFileWatchers.size === 0) {
		return;
	}

	// get command id by input box
	let id = await window.showInputBox({
		prompt: "Enter the input name, usable in tasks with ${input:<name>}.",
		validateInput: (value: string) => value.includes(' ') ? 'No spaces allowed here' : undefined
	});
	if (!id) {
		window.showWarningMessage("Canceled adding status bar parameter. A status bar parameter needs a name to get used by ${input:<name>}!");
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
		window.showWarningMessage("Canceled adding status bar parameter. Adding a status bar parameter without selectable values is not allowed!");
		return;
	}

	// read current tasks.json
	let tasksFile;
	let workspaceUri = taskFileWatchers.keys().next().value.uri;
	let tasksUri = workspaceUri.with({path: `${workspaceUri.path}/.vscode/tasks.json`});
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

		workspace.fs.writeFile(tasksUri, Buffer.from(JSON.stringify(tasks, undefined, 4)));
	} catch (err) {
		console.error(err);
	}
}

// this method is called when your extension is deactivated
export function deactivate() {
	taskFileWatchers.forEach(taskFileWatcher => {
		taskFileWatcher.cleanup();
	});
	console.log('deactivated');
}