import { env, commands, Disposable, Range, StatusBarAlignment, StatusBarItem, ThemeColor, ThemeIcon, Uri, window, workspace, QuickPickItem } from 'vscode';
import * as ext from './extension';
import { exec } from 'child_process';
import * as path from 'path';
import { Strings } from './strings';
import { ParameterProvider } from './parameterProvider';
import * as jsonc from 'jsonc-parser';
import { JsonFile } from './jsonFile';

/**
 * Abstract Param base class
 */
export interface ParamOptions {
    canPickMany?: boolean;
    showName?: boolean;
    showSelection?: boolean;
    initialSelection?: string | string[];
}
interface ParamInput {
    id: string,
    command: string,
    args: ParamOptions
}
export abstract class Param {
    protected static readonly colorInactive = new ThemeColor('input.foreground');
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
        let selection = await this.loadSelectedValues();
        const values = await this.getValues();
        // Set to initial value if one is given and no value was selected for this param before
        if (!selection) {
            if (this.input.args.initialSelection) {
                if (this.input.args.initialSelection instanceof Array) {
                    selection = this.input.args.initialSelection;
                } else {
                    selection = [this.input.args.initialSelection];
                }
            } else {
                selection = [];
            }
        }
        // Delete selected values that are not selectable
        selection = selection.filter(s => values.includes(s));

        // Set default value if selection is empty and mulitple selection is not used. For multiple selection, leave emtpy.
        if (selection.length === 0 && !this.input.args.canPickMany) {
            selection = [values[0]];
        }

        this.storeSelectedValues(selection);
    }

    async onSelect() {
        const values = await this.getValues();
        const oldSelection = await this.loadSelectedValues() || [];
        // preselect single selection
        if (!this.input.args.canPickMany && oldSelection.length === 1) {
            const selectionIndex = values.findIndex(value => value === oldSelection[0]);
            if (selectionIndex !== -1) {
                values.unshift(values.splice(selectionIndex, 1)[0]);
            }
        }
        // preselect multiple selection
        const items = values.map(value => {
            return {
                label: value,
                picked: oldSelection.includes(value)
            };
        });
        const newSelection = await window.showQuickPick(items, { canPickMany: this.input.args.canPickMany, ignoreFocusOut: this.input.args.canPickMany });
        if (newSelection !== undefined) {
            this.storeSelectedValues(newSelection instanceof Array ? newSelection.map(value => value.label) : [newSelection.label]);
        }
    }

    async onEdit() {
        const textDocument = await workspace.openTextDocument(this.jsonFile.uri);
        const position = textDocument.positionAt(this.jsonOffset);
        const selection = new Range(position, position);
        await window.showTextDocument(textDocument, { selection });
    }

    storeSelectedValues(values: string[]) {
        ext.getExtensionContext().workspaceState.update(this.input.command, values);
        this.setText(values);
        ParameterProvider.onDidChangeTreeDataEmitter.fire(this);
    }

    setText(selection: string[]) {
        const showName = this.input.args.showName !== undefined ? this.input.args.showName : ext.getShowNames();
        const showSelection = this.input.args.showSelection !== undefined ? this.input.args.showSelection : ext.getShowSelections();
        const selectionEmpty = selection.length === 0 || (selection.length === 1 && selection[0] === '');
        // determine text
        let text = '';
        if (showName || (selectionEmpty && showSelection)) {
            text = this.input.id;
        }
        if (showSelection && !selectionEmpty) {
            if (showName) {
                text += ': ';
            }
            text += selection.join(' ');
        }
        // detemine color
        if (selectionEmpty) {
            this.statusBarItem.color = Param.colorInactive;
        } else {
            this.statusBarItem.color = '';
        }
        this.statusBarItem.text = text;
    }

    onGet() {
        let selection = this.loadSelectedValues();
        if (!selection) {
            selection = [];
        }
        return selection.join(' ');
    }

    loadSelectedValues() {
        let values = ext.getExtensionContext().workspaceState.get<string[]>(this.input.command);
        // to remain compatible for stored values of version 1.3.1 and before
        if (!values) {
            const oldKey = `${Strings.COMMAND_SELECT}.${this.input.id}`;
            const oldValues = ext.getExtensionContext().workspaceState.get<string>(oldKey);
            if (oldValues) {
                ext.getExtensionContext().workspaceState.update(oldKey, null);
                values = [oldValues];
            }
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

    constructor(public input: ArrayInput, priority: number, jsonOffset: number, jsonArrayIndex: number, jsonFile: JsonFile) {
        super(input, priority, jsonOffset, jsonArrayIndex, jsonFile);
    }

    async getValues(): Promise<string[]> {
        // return a copy of the array to preserve the order
        return Promise.resolve([...this.input.args.values]);
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

    constructor(public input: CommandInput, priority: number, jsonOffset: number, jsonArrayIndex: number, jsonFile: JsonFile) {
        super(input, priority, jsonOffset, jsonArrayIndex, jsonFile);
    }

    async getValues() {
        let execPath = path.dirname(this.jsonFile.uri.fsPath).replace(/.vscode$/, '');
        if (this.input.args.cwd) {
            execPath = path.resolve(execPath, this.input.args.cwd);
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
            const error = `Failed to launch command ${this.input.id}: ${JSON.stringify(e)}`;
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
                    window.showErrorMessage(`Executing "${this.input.args.shellCmd}" at path ${cwd} with shell ${process.env.shell || process.env.ComSpec} failed: ${stderr}`);
                    return;
                }
                resolve(stdout);
            });
        });
    }
}