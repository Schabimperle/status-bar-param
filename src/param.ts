import { commands, Disposable, Range, StatusBarAlignment, StatusBarItem, ThemeColor, Uri, window, workspace } from 'vscode';
import * as ext from './extension';
import { exec } from 'child_process';
import * as path from 'path';
import { Strings } from './strings';

export interface ParamOptions {
    multipleSelection?: boolean;
}

/**
 * Abstract Param base class
 */
export abstract class Param {
    readonly COLOR_INACTIVE = new ThemeColor('gitDecoration.ignoredResourceForeground');
    name: string;
    commandGet: string;
    statusBarItem: StatusBarItem;
    disposables: Disposable[] = [];
    priority: number;
    offset: number;
    jsonFile: Uri;

    constructor(name: string, command: string, priority: number, offset: number, jsonFile: Uri) {
        this.name = name;
        this.commandGet = command;
        this.priority = priority;
        this.offset = offset;
        this.jsonFile = jsonFile;

        // create status bar item
        this.statusBarItem = window.createStatusBarItem(StatusBarAlignment.Left, this.priority);
        this.statusBarItem.tooltip = this.name;
        this.disposables.push(this.statusBarItem);
        this.statusBarItem.command = {
            title: 'Select',
            command: Strings.COMMAND_SELECT,
            arguments: [this],
            tooltip: this.name
        };
        this.update();

        try {
            // create command to retrieve the selected value (when input:<input_id> is used in json)
            this.disposables.push(
                commands.registerCommand(this.commandGet, () => this.onGet())
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
        let value = await this.onGet();
        const values = await this.getValues();
        if (value === undefined || values.indexOf(value) === -1) {
            value = values[0];
        }
        if (value === undefined) {
            window.showWarningMessage(`Parameter '${this.name}' has no arguments!`);
        }
        this.setSelectedValue(value);
    }

    async onSelect() {
        const values = await this.getValues();
        const selection = await window.showQuickPick(values);
        if (selection !== undefined) {
            this.setSelectedValue(selection);
        }
    }

    async onEdit() {
        const textDocument = await workspace.openTextDocument(this.jsonFile);
        const position = textDocument.positionAt(this.offset);
        const selection = new Range(position, position);
        await window.showTextDocument(textDocument, { selection });
    }

    setSelectedValue(value: string) {
        ext.getExtensionContext().workspaceState.update(this.commandGet, value);
        this.setText(value);
    }

    setText(text: string) {
        if (text === '') {
            this.statusBarItem.color = this.COLOR_INACTIVE;
            text = this.name;
        } else if (ext.getShowNames()) {
            this.statusBarItem.color = '';
            text = `${this.name}: ${text}`;
        } else {
            this.statusBarItem.color = '';
        }
        this.statusBarItem.text = text;
    }

    onGet() {
        return ext.getExtensionContext().workspaceState.get<string>(this.commandGet);
    }

    dispose() {
        this.disposables.forEach(disposable => disposable.dispose());
    }

    abstract getValues(): Promise<string[]>;
}

/**
 * Array Param
 */
export class ArrayParam extends Param {
    values: string[];

    constructor(name: string, command: string, priority: number, offset: number, jsonFile: Uri, values: string[]) {
        super(name, command, priority, offset, jsonFile);
        this.values = values;
    }

    async getValues(): Promise<string[]> {
        return this.values;
    }
}

/**
 * Flag Param
 */
export interface SwitchOptions extends ParamOptions {
    value: string;
}
export class SwitchParam extends Param {
    options: SwitchOptions;

    constructor(name: string, command: string, priority: number, offset: number, jsonFile: Uri, options: SwitchOptions) {
        super(name, command, priority, offset, jsonFile);
        this.options = options;
        this.statusBarItem.text = this.name;
    }

    async onSelect() {
        this.setSelectedValue(!this.onGet() ? this.options.value : '');
    }

    setText(text: string) {
        this.statusBarItem.color = text ? '' : this.COLOR_INACTIVE;
    }

    async getValues(): Promise<string[]> {
        return [this.options.value, ''];
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
export class CommandParam extends Param {
    options: CommandOptions;

    constructor(name: string, command: string, priority: number, offset: number, jsonFile: Uri, options: CommandOptions) {
        super(name, command, priority, offset, jsonFile);
        this.options = options;
    }

    async getValues() {
        let execPath = path.dirname(this.jsonFile.fsPath).replace(/.vscode$/, '');
        if (this.options.cwd) {
            execPath = path.resolve(execPath, this.options.cwd);;
        }
        try {
            await workspace.fs.stat(Uri.file(execPath));
            const stdout = await this.execCmd(this.options.shellCmd, execPath);
            const values = stdout.split(this.options.separator || '\n');
            if (values && values.length > 0 && values[values.length - 1] === '') {
                values.pop();
            }
            return values;
        } catch (e) {
            const error = `Failed to launch command of ${this.name}: Starting directory (cwd) "${execPath}" does not exist.`;
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
                    window.showErrorMessage(`Executing ${this.options.shellCmd} failed: ${stderr}`);
                    return;
                }
                resolve(stdout);
            });
        });
    }
}