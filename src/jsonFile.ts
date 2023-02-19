import { workspace, Uri, WorkspaceFolder, RelativePattern, Disposable, QuickPickItem, window, Range } from 'vscode';
import * as jsonc from 'jsonc-parser';
import { JSONPath } from 'jsonc-parser';
import { ArrayParam, CommandParam, Param, ArrayOptions, CommandOptions } from './param';
import { Strings } from './strings';
import * as path from 'path';
import { ParameterProvider } from './parameterProvider';
import Ajv from 'ajv';
import * as chokidar from 'chokidar';

// create schema validator functions for status bar parameters
import inputSchema from './schemas/input_schema.json';
const ajv = new Ajv();
inputSchema.then.properties.args = (<any>{ type: ["array", "object"] });
const validateStatusBarParamInput = ajv.compile<any>(inputSchema);
inputSchema.definitions.arrayOptions.anyOf[1].allOf![0] = (<any>inputSchema.definitions.options);
const validateArrayInput = ajv.compile(inputSchema.definitions.arrayOptions);
inputSchema.definitions.commandOptions.allOf![0] = (<any>inputSchema.definitions.options);
const validateCommandInput = ajv.compile(inputSchema.definitions.commandOptions);

export interface JsoncPaths {
	versionPath: JSONPath
	tasksPath: JSONPath
	inputsPath: JSONPath
}

export class JsonFile implements Disposable {
	private static readonly priorityStep = 0.001;
	private disposables: Disposable[] = [];
	private paramIdToEditOnCreate: string = '';
	private busy: boolean = false;
	private changeWhileBusy: boolean = false;
	params: Param[] = [];

	constructor(private priority: number, public uri: Uri, public workspaceFolder?: WorkspaceFolder) {
		this.priority = priority;
		this.uri = uri;
		this.workspaceFolder = workspaceFolder;
		console.debug('JsonFile created:', uri.toString());

		const watcher = chokidar.watch(uri.fsPath);
		watcher
			.on('add', () => this.fileChangeDebounce())
			.on('change', () => this.fileChangeDebounce())
			.on('unlink', () => this.disposeParams());
		this.disposables.push(new Disposable(() => watcher.close()));
		this.disposables.push(new Disposable(() => this.disposeParams()));

		// init status bar items
		this.fileChangeDebounce();
	}

	hasParams() {
		return this.params.length > 0;
	}

	getFileName() {
		return path.basename(this.uri.path);
	}

	getDescription() {
		return this.workspaceFolder?.name || this.uri?.fsPath;
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

	// prevent race condition by parallel change events
	private fileChangeDebounce() {
		if (this.busy === true) {
			this.changeWhileBusy = true;
			return;
		}

		this.busy = true;
		this.onFileChange();
		this.busy = false;

		if (this.changeWhileBusy === true) {
			this.changeWhileBusy = false;
			this.fileChangeDebounce();
		}
	}

	private async onFileChange() {
		console.debug('onFileChange', this.uri.fsPath);
		this.disposeParams();
		let oldParamLength = 0;
		try {
			const fileContent = await workspace.fs.readFile(this.uri);

			oldParamLength = this.params.length;
			this.params = [];

			const rootNode = jsonc.parseTree(fileContent.toString());
			const jsoncPaths = this.getJsoncPaths();
			this.parseInputs(jsonc.findNodeAtLocation(rootNode, jsoncPaths.inputsPath));
			if (this.uri.path.endsWith('.code-workspace')) {
				// TODO: clean up mess with jsoncPaths for launch section in .code-workspace files
				this.parseInputs(jsonc.findNodeAtLocation(rootNode, ['launch', 'inputs']));
			}
		} catch (err) {
			console.log("File doesn't exist (yet)", this.uri.fsPath);
		}
		if (oldParamLength === 0 || this.params.length === 0 && oldParamLength !== this.params.length) {
			ParameterProvider.onDidChangeTreeDataEmitter.fire();
		} else {
			ParameterProvider.onDidChangeTreeDataEmitter.fire(this);
		}
	}

	private parseInputs(inputs: jsonc.Node | undefined) {
		if (!inputs?.children) {
			return;
		}
		for (let i = 0; i < inputs.children.length; i++) {
			const inputNode = inputs.children[i];
			// ignore inputs not intended for this extension
			const input = jsonc.getNodeValue(inputNode);
			// calculate priority depending on the priority of this json file for the params to show in the correct order
			const paramPriority = this.priority - (this.params.length * JsonFile.priorityStep);
			// check if input is a statusBarParam
			if (!validateStatusBarParamInput(input)) {
				return;
			}

			if (input.args instanceof Array) {
				input.args.values = input.args;
			}

			// create specific param and add it to the status bar
			let param;
			if (validateArrayInput(input.args)) {
				param = new ArrayParam(input, paramPriority, inputNode.offset, i, this);
			} else if (validateCommandInput(input.args)) {
				param = new CommandParam(input, paramPriority, inputNode.offset, i, this);
			} else {
				continue;
			}
			this.params.push(param);

			// open param added before
			if (this.paramIdToEditOnCreate === input.id) {
				param.onEdit();
				this.paramIdToEditOnCreate = '';
			}
		}
	}

	update() {
		console.debug('update');
		this.params.forEach(param => param.update());
	}

	disposeParams() {
		console.debug('disposeParams');
		while (this.params.length > 0) {
			const param = this.params.pop();
			if (param) {
				param.dispose();
			}
		}
		ParameterProvider.onDidChangeTreeDataEmitter.fire();
	}

	dispose() {
		console.debug('dispose');
		this.disposables.forEach(disposable => disposable.dispose());
	}

	async createParam() {
		// select param type to add
		const arrayLabel = `\$(${ArrayParam.icon.id}) Array`;
		const commandLabel = `\$(${CommandParam.icon.id}) Command`;
		const items: QuickPickItem[] = [
			{
				label: arrayLabel,
				description: 'A list of parameter values to select from.'
			},
			{
				label: commandLabel,
				description: 'A shell command that outputs parameter values to select from.'
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

		let args: Array<string> | ArrayOptions | CommandOptions;
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
						return;
					}
					args.push(arg);
				}
				break;
			}
			case commandLabel: {
				const shellCmd = await window.showInputBox({
					prompt: `Enter a shell command that outputs parameter values to select from.`,
					ignoreFocusOut: true
				});
				if (!shellCmd) {
					return;
				}
				const options: CommandOptions = { shellCmd };
				const separator = await window.showInputBox({
					prompt: `Optional: Enter a string to separate the command output to selectable values. Defaults to '\\n'`,
					ignoreFocusOut: true,
					placeHolder: '\\n'
				});
				if (separator) {
					options.separator = separator;
				}
				const cwd = await window.showInputBox({
					prompt: `Optional: Enter the working directory to execute the shell command from. Defaults to the workspace root.`,
					ignoreFocusOut: true,
					placeHolder: this.workspaceFolder ? this.workspaceFolder.uri.fsPath : this.uri.fsPath
				});
				if (cwd) {
					options.cwd = cwd;
				}
				args = options;
				break;
			}
		}

		// read canPickMany
		const boolItems: QuickPickItem[] = [
			{ label: 'No' },
			{ label: 'Yes' }
		];
		const canPickManyselection = await window.showQuickPick(boolItems, {
			placeHolder: 'Enable checkboxes for selection of multiple values?'
		});
		if (canPickManyselection?.label === 'Yes') {
			if (args! instanceof Array) {
				args = { values: args };
			}
			args!.canPickMany = true;
		}

		// add sample task?
		let addSampleTask = false;
		if (!this.uri.path.endsWith('launch.json')) {
			const addSampleTaskSelection = await window.showQuickPick(boolItems, {
				placeHolder: 'Add sample task to demonstrate usage?'
			});
			if (addSampleTaskSelection?.label === 'Yes') {
				addSampleTask = true;
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

			if (!rootNode.version && !this.uri.path.endsWith('launch.json')) {
				fileContent = jsonc.applyEdits(fileContent, jsonc.modify(fileContent, jsoncPaths.versionPath, "2.0.0", { formattingOptions: {} }));
			}
			if (addSampleTask) {
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
				args: args!
			};
			jsoncPaths.inputsPath.push(tasksRoot.inputs.length);
			const modifications = jsonc.modify(fileContent, jsoncPaths.inputsPath, input, { formattingOptions: {} });
			// workaround to prevent escaping of backslashes by jsonc.modify (or JSON.stringify)
			modifications.forEach(modification => modification.content = modification.content.replace(/\\\\/g, '\\'));
			fileContent = jsonc.applyEdits(fileContent, modifications);
			workspace.fs.writeFile(this.uri, Buffer.from(fileContent));

			// open added param
			this.paramIdToEditOnCreate = input.id;
		} catch (err) {
			console.error(err);
		}
	}
}