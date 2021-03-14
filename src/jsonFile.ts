import { workspace, Uri, WorkspaceFolder, RelativePattern, Disposable, QuickPickItem, window } from 'vscode';
import * as jsonc from 'jsonc-parser';
import { JSONPath } from 'jsonc-parser';
import * as fs from 'fs';
import { ArrayParam, CommandParam, SwitchParam, Param, CommandOptions, SwitchOptions } from './param';
import { Strings } from './strings';
import * as path from 'path';
import { ParameterProvider } from './parameterProvider';

export interface JsoncPaths {
	versionPath: JSONPath
	tasksPath: JSONPath
	inputsPath: JSONPath
}

export class JsonFile implements Disposable {
	private static readonly PRIORITY_STEP = 0.001;
	private lastRead: number = 0;
	private disposables: Disposable[] = [];
	params: Param[] = [];

	static FromInsideWorkspace(priority: number, workspaceFolder: WorkspaceFolder, relativePath: string): JsonFile {
		console.debug('FromInsideWorkspace:', workspaceFolder.name, relativePath);

		// workaround for bug: https://github.com/microsoft/vscode/issues/10633
		const uri = workspaceFolder.uri.with({ path: `${workspaceFolder.uri.path}/${relativePath}` });

		// wait for changes of tasks.json
		const jsonFile = new JsonFile(priority, uri, workspaceFolder);
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

	static FromOutsideWorkspace(priority: number, path: Uri): JsonFile {
		console.debug('FromOutsideWorkspace:', path.toString());

		// wait for changes of the given file
		const jsonFile = new JsonFile(priority, path);
		const watcher = fs.watch(path.fsPath);
		watcher.on('change', () => jsonFile.multipleChangeTriggersWorkaound());
		watcher.on('close', () => jsonFile.clear());
		jsonFile.disposables.push(new Disposable(() => watcher.close()));

		// init status bar items
		jsonFile.multipleChangeTriggersWorkaound();
		return jsonFile;
	}

	constructor(private priority: number, public uri: Uri, public workspaceFolder?: WorkspaceFolder) {
		this.priority = priority;
		this.uri = uri;
		this.workspaceFolder = workspaceFolder;
	}

	getFileName() {
		return path.basename(this.uri.fsPath);
	}

	getJsoncPaths() {
		const res: JsoncPaths = {
			versionPath: ['version'],
			tasksPath: ['tasks'],
			inputsPath: ['inputs'],
		};
		if (this.uri.path.endsWith('.code-workspace')) {
			res.versionPath.unshift('tasks');
			res.tasksPath.unshift('tasks');
			res.inputsPath.unshift('tasks');
		}
		return res;
	}

	// workaround for didChange event fired twice for one change
	private async multipleChangeTriggersWorkaound() {
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

	private async jsonFileChanged(jsonFile: Uri) {
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
			if (!inputs?.children) {
				return;
			}
			for (let i = 0; i < inputs.children.length; i++) {
				const inputNode = inputs.children[i];
				// ignore inputs not intended for this extension
				const input = jsonc.getNodeValue(inputNode);
				if (!input.command || !input.command.startsWith(`${Strings.EXTENSION_ID}.get.`) || input.args.length === 0) {
					return;
				}
				// calculate priority depending on the priority of this json file for the params to show in the correct order
				const paramPriority = this.priority - (this.params.length * JsonFile.PRIORITY_STEP);
				// create specific param and add it to the status bar
				if (input.args instanceof Array) {
					this.params.push(new ArrayParam(input.id, input.command, paramPriority, inputNode.offset, i, this, input.args));
				} else if (input.args.shellCmd) {
					this.params.push(new CommandParam(input.id, input.command, paramPriority, inputNode.offset, i, this, input.args));
				} else if (input.args.value) {
					this.params.push(new SwitchParam(input.id, input.command, paramPriority, inputNode.offset, i, this, input.args));
				}
			}
		} catch (err) {
			console.error("Couldn't read/parse json:", err);
		}
		ParameterProvider.onDidChangeTreeDataEmitter.fire(this);
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
		const arrayLabel = `\$(${ArrayParam.icon.id}) Array`;
		const commandLabel = `\$(${CommandParam.icon.id}) Command`;
		const switchLabel = `\$(${SwitchParam.icon.id}) Switch`;
		const items: QuickPickItem[] = [
			{
				label: arrayLabel,
				description: 'Use values from a given Array.'
			},
			{
				label: commandLabel,
				description: 'Use values parsed from a given shell command.'
			},
			{
				label: switchLabel,
				description: 'Either returning the given string (on) or an empty one (off).'
			}
		];
		const paramType = await window.showQuickPick(items, {
			placeHolder: 'Select the type of the parameter.',
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
			case arrayLabel: {
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
			case commandLabel: {
				// get args by input box
				const shellCmd = await window.showInputBox({
					prompt: `Enter the command to execute to receive the values.`,
					ignoreFocusOut: true
				});
				if (!shellCmd) {
					return;
				}
				const options: CommandOptions = { shellCmd };
				const separator = await window.showInputBox({
					prompt: `Optional: Enter the separator to split the values by. Defaults to '\\n.'`,
					ignoreFocusOut: true
				});
				if (separator) {
					options.separator = separator;
				}
				const cwd = await window.showInputBox({
					prompt: `Optional: Enter the path to execute the command from. Defaults to workspace root.`,
					ignoreFocusOut: true
				});
				if (cwd) {
					options.cwd = cwd;
				}
				args = options;
				break;
			}
			case switchLabel: {
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

			const jsoncPaths = this.getJsoncPaths();

			if (this.uri.path.endsWith('.code-workspace')) {
				if (!rootNode.tasks) {
					rootNode.tasks = {};
				}
				tasksRoot = rootNode.tasks;
			}

			if (!this.uri.path.endsWith('launch.json')) {
				if (!rootNode.version) {
					fileContent = jsonc.applyEdits(fileContent, jsonc.modify(fileContent, jsoncPaths.versionPath, "2.0.0", { formattingOptions: {} }));
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
				jsoncPaths.tasksPath.push(tasksRoot.tasks.length);
				fileContent = jsonc.applyEdits(fileContent, jsonc.modify(fileContent, jsoncPaths.tasksPath, task, { formattingOptions: {} }));
			}
			// add input
			if (!tasksRoot.inputs) {
				tasksRoot.inputs = [];
			}
			const input = {
				id,
				type: 'command',
				command: `${Strings.EXTENSION_ID}.get.${id}`,
				args
			};
			jsoncPaths.inputsPath.push(tasksRoot.inputs.length);
			const modifications = jsonc.modify(fileContent, jsoncPaths.inputsPath, input, { formattingOptions: {} });
			// workaround to prevent escaping of backslashes by jsonc.modify (or JSON.stringify)
			modifications.forEach(modification => modification.content = modification.content.replace(/\\\\/g, '\\'));
			fileContent = jsonc.applyEdits(fileContent, modifications);
			workspace.fs.writeFile(this.uri, Buffer.from(fileContent));
		} catch (err) {
			console.error(err);
		}
	}
}