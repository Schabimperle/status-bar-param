import { env, commands, Disposable, Range, StatusBarAlignment, StatusBarItem, ThemeColor, ThemeIcon, Uri, window, workspace, QuickPickItem } from 'vscode';
import * as ext from './extension';
import { exec } from 'child_process';
import * as path from 'path';
import { Strings } from './strings';
import { ParameterProvider } from './parameterProvider';
import * as jsonc from 'jsonc-parser';
import { JsonFile } from './jsonFile';

export interface ParamOptions {
    canPickMany?: boolean;
}

interface ParamInput {
    id: string,
    command: string,
    args: any
}

/**
 * Abstract Param base class
 */
export abstract class Param {
    protected static readonly COLOR_INACTIVE = new ThemeColor('gitDecoration.ignoredResourceForeground');
    protected readonly statusBarItem: StatusBarItem;
    protected readonly disposables: Disposable[] = [];

    static getIcon(param: Param) {
        if (param instanceof ArrayParam) {
            return ArrayParam.icon;
        } else if (param instanceof CommandParam) {
            return CommandParam.icon;
        } else {
            return new ThemeIcon('');
        }
    }

    constructor(
        public readonly input: ParamInput,
        protected readonly priority: number,
        protected readonly jsonOffset: number,
        protected readonly jsonArrayIndex: number,
        protected readonly jsonFile: JsonFile) {

        // create status bar item
        this.statusBarItem = window.createStatusBarItem(StatusBarAlignment.Left, this.priority);
        this.statusBarItem.tooltip = this.input.id;
        this.disposables.push(this.statusBarItem);
        this.statusBarItem.command = {
            title: 'Select',
            command: Strings.COMMAND_SELECT,
            arguments: [this],
            tooltip: this.input.id
        };
        this.update();

        try {
            // create command to retrieve the selected value (when input:<input_id> is used in json)
            this.disposables.push(
                commands.registerCommand(this.input.command, () => this.onGet())
            );
            this.statusBarItem.show();
        } catch (err) {
            console.error(err);
            if (err instanceof Error) {
                window.showErrorMessage(err.message);
            }
        }
    }

    async update() {
        let selection = await this.getStoredValues();
        const values = await this.getValues();
        selection = selection?.filter(s => values.includes(s));
        if (!this.input.args.canPickMany && selection.length === 0) {
            selection = [values[0]];
        }
        if (selection === undefined) {
            window.showWarningMessage(`Parameter '${this.input.id}' has no arguments!`);
        }
        this.setSelectedValues(selection);
    }

    async onSelect() {
        const values = await this.getValues();
        const selection = await window.showQuickPick(values, { canPickMany: this.input.args.canPickMany });
        if (selection !== undefined) {
            this.setSelectedValues(typeof selection === 'string' ? [selection] : selection);
        }
    }

    async onEdit() {
        const textDocument = await workspace.openTextDocument(this.jsonFile.uri);
        const position = textDocument.positionAt(this.jsonOffset);
        const selection = new Range(position, position);
        await window.showTextDocument(textDocument, { selection });
    }

    setSelectedValues(values: string[]) {
        ext.getExtensionContext().workspaceState.update(this.input.command, values);
        this.setText(values);
        ParameterProvider.onDidChangeTreeDataEmitter.fire(this);
    }

    setText(selection: string[]) {
        let text;
        if (selection.length === 0 || selection.length === 1 && selection[0] === '') {
            this.statusBarItem.color = Param.COLOR_INACTIVE;
            text = this.input.id;
        } else if (ext.getShowNames()) {
            this.statusBarItem.color = '';
            text = `${this.input.id}: ${selection.join(' ')}`;
        } else {
            this.statusBarItem.color = '';
            text = `${selection.join(' ')}`;
        }
        this.statusBarItem.text = text;
    }

    onGet() {
        return this.getStoredValues().join(' ');
    }

    getStoredValues() {
        let values = ext.getExtensionContext().workspaceState.get<string[]>(this.input.command) || [];
        // to remain compatible for stored values of version 1.3.1 and before
        if (typeof values === 'string') {
            values = [values];
        }
        return values;
    }

    async onCopyCmd() {
        const inputStringLabel = "Copy Input String";
        const commandStringLabel = "Copy Command String";
        const items: QuickPickItem[] = [
            {
                label: inputStringLabel,
                description: 'To use only in the vscode configuration file where the parameter is defined.'
            },
            {
                label: commandStringLabel,
                description: 'To use across vscode configuration files.'
            }
        ];
        const copyType = await window.showQuickPick(items, {
            placeHolder: 'Select the string you want to copy.',
        });
        if (copyType?.label === inputStringLabel) {
            env.clipboard.writeText(`\${input:${this.input.id}}`);
        }
        else if (copyType?.label === commandStringLabel) {
            env.clipboard.writeText(`\${command:${Strings.EXTENSION_ID}.get.${this.input.id}}`);
        }
    }

    async onDelete() {
        const selection = await window.showQuickPick(["No", "Yes"], { placeHolder: 'Do you really want to delete ' + this.input.id + '?' });
        if (selection !== undefined) {
            let fileContent = (await workspace.fs.readFile(this.jsonFile.uri)).toString();
            const jsoncInputsPath = this.jsonFile.getJsoncPaths().inputsPath;
            jsoncInputsPath.push(this.jsonArrayIndex);
            fileContent = jsonc.applyEdits(fileContent, jsonc.modify(fileContent, jsoncInputsPath, undefined, { formattingOptions: {} }));
            workspace.fs.writeFile(this.jsonFile.uri, Buffer.from(fileContent));
        }
    }

    dispose() {
        this.disposables.forEach(disposable => disposable.dispose());
    }

    abstract getValues(): Promise<string[]>;
}

/**
 * Array Param
 */
export interface ArrayOptions extends ParamOptions {
    values: string[];
}
interface ArrayInput extends ParamInput {
    args: ArrayOptions
}
export class ArrayParam extends Param {
    static readonly icon = new ThemeIcon('array');

    constructor(input: ArrayInput, priority: number, jsonOffset: number, jsonArrayIndex: number, jsonFile: JsonFile) {
        super(input, priority, jsonOffset, jsonArrayIndex, jsonFile);
    }

    async getValues(): Promise<string[]> {
        return Promise.resolve(this.input.args.values);
    }
}

/**
 * CommandParam
 */
export interface CommandOptions extends ParamOptions {
    shellCmd: string;
    cwd?: string;
    separator?: string;
}
interface CommandInput extends ParamInput {
    args: CommandOptions
}
export class CommandParam extends Param {
    static readonly icon = new ThemeIcon('terminal');

    constructor(input: CommandInput, priority: number, jsonOffset: number, jsonArrayIndex: number, jsonFile: JsonFile) {
        super(input, priority, jsonOffset, jsonArrayIndex, jsonFile);
    }

    async getValues() {
        let execPath = path.dirname(this.jsonFile.uri.fsPath).replace(/.vscode$/, '');
        if (this.input.args.cwd) {
            execPath = path.resolve(execPath, this.input.args.cwd);;
        }
        try {
            await workspace.fs.stat(Uri.file(execPath));
            const stdout = await this.execCmd(this.input.args.shellCmd, execPath);
            const values = stdout.split(this.input.args.separator || '\n');
            if (values && values.length > 0 && values[values.length - 1] === '') {
                values.pop();
            }
            return values;
        } catch (e) {
            const error = `Failed to launch command of ${this.input.id}: Starting directory (cwd) "${execPath}" does not exist.`;
            console.error(error);
            window.showErrorMessage(error);
            return [];
        }
    }

    async execCmd(cmd: string, cwd: string): Promise<string> {
        return new Promise((resolve) => {
            exec(cmd, { cwd }, (error, stdout, stderr) => {
                if (error) {
                    console.error(error + ":", stderr);
                    window.showErrorMessage(`Executing ${this.input.args.shellCmd} failed: ${stderr}`);
                    return;
                }
                resolve(stdout);
            });
        });
    }
}