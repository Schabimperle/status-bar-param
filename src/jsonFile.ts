import { workspace, Uri, WorkspaceFolder, RelativePattern, Disposable, QuickPickItem, window } from 'vscode';
import * as jsonc from 'jsonc-parser';
import * as fs from 'fs';
import { ArrayParam, CommandParam, SwitchParam, Param, CommandOptions, SwitchOptions } from './param';

export class JsonFile implements Disposable {
	readonly PRIORITY_STEP = 0.001;
	readonly uri: Uri;
	readonly priority: number;
	readonly workspaceFolder: WorkspaceFolder | undefined;
	lastRead: number = 0;
	params: Param[] = [];
	disposables: Disposable[] = [];

	static FromInsideWorkspace(workspaceFolder: WorkspaceFolder, relativePath: string, priority: number): JsonFile {
		console.debug('FromInsideWorkspace:', workspaceFolder.name, relativePath);

		// workaround for bug: https://github.com/microsoft/vscode/issues/10633
		const uri = workspaceFolder.uri.with({ path: `${workspaceFolder.uri.path}/${relativePath}` });

		// wait for changes of tasks.json
		const jsonFile = new JsonFile(uri, priority, workspaceFolder);
		const pattern = new RelativePattern(workspaceFolder, relativePath);
		const watcher = workspace.createFileSystemWatcher(pattern);
		watcher.onDidChange(() => jsonFile.multipleChangeTriggersWorkaound());
		watcher.onDidCreate(() => jsonFile.multipleChangeTriggersWorkaound());
		watcher.onDidDelete(() => jsonFile.clear());
		jsonFile.disposables.push(new Disposable(watcher.dispose));

		// init status bar items
		jsonFile.multipleChangeTriggersWorkaound();
		return jsonFile;
	}

	static FromOutsideWorkspace(path: Uri, priority: number): JsonFile {
		console.debug('FromOutsideWorkspace:', path.toString());

		// wait for changes of the given file
		const jsonFile = new JsonFile(path, priority);
		const watcher = fs.watch(path.fsPath);
		watcher.on('change', () => jsonFile.multipleChangeTriggersWorkaound());
		watcher.on('close', () => jsonFile.clear());
		jsonFile.disposables.push(new Disposable(() => watcher.close()));

		// init status bar items
		jsonFile.multipleChangeTriggersWorkaound();
		return jsonFile;
	}

	constructor(uri: Uri, priority: number, workspaceFolder?: WorkspaceFolder) {
		this.uri = uri;
		this.priority = priority;
		this.workspaceFolder = workspaceFolder;
	}

	// workaround for didChange event fired twice for one change
	async multipleChangeTriggersWorkaound() {
		console.debug('multipleChangeTriggersWorkaound');
		try {
			const stat = await workspace.fs.stat(this.uri);
			const lastWrite = stat.mtime;
			if (lastWrite === this.lastRead) {
				return;
			}
			this.lastRead = lastWrite;
			this.jsonFileChanged(this.uri);
		} catch (err) {
			this.clear();
			return;
		}
	}

	async jsonFileChanged(jsonFile: Uri) {
		console.debug('jsonFileChanged', jsonFile.toString());

		this.clear();
		try {
			const fileContent = await workspace.fs.readFile(jsonFile);
			let rootNode = jsonc.parseTree(fileContent.toString());
			const tasks = jsonc.findNodeAtLocation(rootNode, ['tasks']);
			if (tasks?.type === 'object') {
				rootNode = tasks;
			}
			const inputs = jsonc.findNodeAtLocation(rootNode, ['inputs']);

			this.params = [];
			inputs?.children?.forEach(inputNode => {
				// ignore inputs not intended for this extension
				const input = jsonc.getNodeValue(inputNode);
				if (!input.command || !input.command.startsWith('statusBarParam.get.') || input.args.length === 0) {
					return;
				}
				// calculate priority depending on the priority of this json file for the params to show in the correct order
				const paramPriority = this.priority - (this.params.length * this.PRIORITY_STEP);
				// create specific param and add it to the status bar
				if (input.args instanceof Array) {
					this.params.push(new ArrayParam(input.id, input.command, paramPriority, inputNode.offset, this.uri, input.args));
				} else if (input.args.shellCmd) {
					this.params.push(new CommandParam(input.id, input.command, paramPriority, inputNode.offset, this.uri, input.args));
				} else if (input.args.value) {
					this.params.push(new SwitchParam(input.id, input.command, paramPriority, inputNode.offset, this.uri, input.args));
				}
			});
		} catch (err) {
			console.error("Couldn't read/parse json:", err);
		}
	}

	update() {
		console.debug('update');
		this.params.forEach(param => param.update());
	}

	clear() {
		console.debug('clear');
		while (this.params.length > 0) {
			const param = this.params.pop();
			if (param) {
				param.dispose();
			}
		}
	}

	dispose() {
		console.debug('dispose');
		this.clear();
		this.disposables.forEach(disposable => disposable.dispose());
	}

	async createParam() {
		// select param type to add
		const items: QuickPickItem[] = [
			{
				label: 'Array',
				description: 'Use values from a given Array.'
			},
			{
				label: 'Command',
				description: 'Use values parsed from a given shell command.'
			},
			{
				label: 'Switch',
				description: 'Either returning the given string (on) or an empty one (off).'
			}
		];
		const paramType = await window.showQuickPick(items, {
			placeHolder: 'Select the type of the parameter.',
			ignoreFocusOut: true
		});
		if (!paramType) {
			return;
		}

		// get command id by input box
		const id = await window.showInputBox({
			prompt: 'Enter the name of the parameter.',
			ignoreFocusOut: true,
			validateInput: (value: string) => value.includes(' ') ? 'No spaces allowed here!' : undefined
		});
		if (!id) {
			return;
		}

		let args: any;
		switch (paramType.label) {
			case 'Array': {
				args = [];
				// get args by input box
				let arg: string | undefined = "";
				let i = 1;
				while (true) {
					arg = await window.showInputBox({
						prompt: `Enter the ${i++}. parameter, leave empty when finished.`,
						ignoreFocusOut: true
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
					window.showWarningMessage('You need to add at least one value.');
					return;
				}
				break;
			}
			case 'Command': {
				// get args by input box
				const shellCmd = await window.showInputBox({
					prompt: `Enter the command to execute to receive the values.`,
					ignoreFocusOut: true
				});
				if (!shellCmd) {
					return;
				}
				const separator = await window.showInputBox({
					prompt: `Optional: Enter the separator to split the values by. Defaults to '\\n.'`,
					ignoreFocusOut: true
				});
				const cwd = await window.showInputBox({
					prompt: `Optional: Enter the path to execute the command from. Defaults to workspace root.`,
					ignoreFocusOut: true
				});
				const options: CommandOptions = { shellCmd, separator, cwd };
				args = options;
				break;
			}
			case 'Switch': {
				// get args by input box
				const value = await window.showInputBox({
					prompt: `Enter the value to return when the switch is enabled.`,
					ignoreFocusOut: true
				});
				if (!value) {
					return;
				}
				const options: SwitchOptions = { value };
				args = options;
				break;
			}
		}

		// read current tasks.json
		let fileContent;
		try {
			fileContent = (await workspace.fs.readFile(this.uri)).toString();
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
			const versionPath = ['version'];
			const tasksPath = ['tasks'];
			const inputsPath = ['inputs'];

			if (this.uri.path.endsWith('.code-workspace')) {
				if (!rootNode.tasks) {
					rootNode.tasks = {};
				}
				tasksRoot = rootNode.tasks;
				versionPath.unshift('tasks');
				tasksPath.unshift('tasks');
				inputsPath.unshift('tasks');
			}

			if (!this.uri.path.endsWith('launch.json')) {
				if (!rootNode.version) {
					fileContent = jsonc.applyEdits(fileContent, jsonc.modify(fileContent, versionPath, "2.0.0", { formattingOptions: {} }));
				}
				if (!tasksRoot.tasks) {
					tasksRoot.tasks = [];
				}
				// add example task
				const task = {
					label: `echo value of ${id}`,
					type: 'shell',
					command: `echo \"Current value of ${id} is '\${input:${id}}'\."`,
					problemMatcher: []
				};
				tasksPath.push(tasksRoot.tasks.length);
				fileContent = jsonc.applyEdits(fileContent, jsonc.modify(fileContent, tasksPath, task, { formattingOptions: {} }));
			}
			// add input
			if (!tasksRoot.inputs) {
				tasksRoot.inputs = [];
			}
			const input = {
				id,
				command: `statusBarParam.get.${id}`,
				args
			};
			inputsPath.push(tasksRoot.inputs.length);
			const modifications = jsonc.modify(fileContent, inputsPath, input, { formattingOptions: {} });
			// workaround to prevent escaping of backslashes by jsonc.modify (or JSON.stringify)
			modifications.forEach(modification => modification.content = modification.content.replace(/\\\\/g, '\\'));
			fileContent = jsonc.applyEdits(fileContent, modifications);
			workspace.fs.writeFile(this.uri, Buffer.from(fileContent));
		} catch (err) {
			console.error(err);
		}
	}
}