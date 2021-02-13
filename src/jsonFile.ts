import { workspace, Uri, WorkspaceFolder, RelativePattern, Disposable } from 'vscode';
import * as jsonc from 'jsonc-parser';
import * as fs from 'fs';
import { ArrayParam, CommandParam, FlagParam, Param } from './param';

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
		let uri = workspaceFolder.uri.with({ path: `${workspaceFolder.uri.path}/${relativePath}` });

		// wait for changes of tasks.json
		let jsonFile = new JsonFile(uri, priority, workspaceFolder);
		let pattern = new RelativePattern(workspaceFolder, relativePath);
		let watcher = workspace.createFileSystemWatcher(pattern);
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
		let jsonFile = new JsonFile(path, priority);
		let watcher = fs.watch(path.fsPath);
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

	async multipleChangeTriggersWorkaound() {
		console.debug('multipleChangeTriggersWorkaound');
		try {
			let stat = await workspace.fs.stat(this.uri);
			// workaround for didChange event fired twice for one change
			let lastWrite = stat.mtime;
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
			let fileContent = await workspace.fs.readFile(jsonFile);
			let rootNode = jsonc.parseTree(fileContent.toString());
			let tasks = jsonc.findNodeAtLocation(rootNode, ['tasks']);
			if (tasks?.type === 'object') {
				rootNode = tasks;
			}
			const inputs = jsonc.findNodeAtLocation(rootNode, ['inputs']);

			this.params = [];
			inputs?.children?.forEach(inputNode => {
				// ignore inputs not intended for this extension
				let input = jsonc.getNodeValue(inputNode);
				if (!input.command || !input.command.startsWith('statusBarParam.get.') || input.args.length === 0) {
					return;
				}
				let paramPriority = this.priority - (this.params.length * this.PRIORITY_STEP);
				if (input.args instanceof Array) {
					this.params.push(new ArrayParam(input.id, input.command, paramPriority, inputNode.offset, this.uri, input.args));
				} else if (input.args.shellCmd) {
					this.params.push(new CommandParam(input.id, input.command, paramPriority, inputNode.offset, this.uri, input.args));
				} else if (input.args.flag) {
					this.params.push(new FlagParam(input.id, input.command, paramPriority, inputNode.offset, this.uri, input.args));
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
			let param = this.params.pop();
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
}