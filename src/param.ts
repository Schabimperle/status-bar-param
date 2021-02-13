import { commands, Disposable, Range, StatusBarAlignment, StatusBarItem, Uri, window, workspace } from 'vscode';
import * as ext from './extension';
import { exec } from 'child_process';
import * as path from 'path';

/**
 * Abstract Param base class
 */
export abstract class Param {
    readonly FONT_COLOR_DISABLED = '#cccccc';
    readonly EDIT_STRING = '$(settings) Edit...';
    name: string;
    commandGetValue: string;
    commandSelectValue: string;
    statusBarItem: StatusBarItem;
    disposables: Disposable[] = [];
    priority: number;
    offset: number;
    jsonFile: Uri;

    constructor(name: string, command: string, priority: number, offset: number, jsonFile: Uri) {
        this.name = name;
        this.commandGetValue = command;
        this.priority = priority;
        this.offset = offset;
        this.jsonFile = jsonFile;

        // create status bar item
        this.statusBarItem = window.createStatusBarItem(StatusBarAlignment.Left, this.priority);
        this.statusBarItem.tooltip = this.name;
        this.disposables.push(this.statusBarItem);
        this.commandSelectValue = `statusBarParam.select.${this.name}`;
        this.statusBarItem.command = this.commandSelectValue;
        this.update();

        try {
            // create command to retrieve the selected value (when input:<input_id> is used in json)
            let displosable = commands.registerCommand(this.commandGetValue, () => this.getSelectedValue());
            this.disposables.push(displosable);

            // create command for selection of status bar param
            displosable = commands.registerCommand(this.statusBarItem.command, () => this.onClick());
            this.disposables.push(displosable);

            this.statusBarItem.show();
        } catch (err) {
            console.error(err);
            if (err instanceof Error) {
                window.showErrorMessage(err.message);
            }
        }
    }

    async update() {
        let value = await this.getSelectedValue();
        let values = await this.getValues();
        if (value === undefined || values.indexOf(value) === -1) {
            value = values[0];
        }
        if (value === undefined) {
            window.showWarningMessage(`Parameter '${this.name}' has no arguments!`);
        }
        this.setSelectedValue(value);
    }

    async onClick() {
        const values = await this.getValues();
        values.push(this.EDIT_STRING);
        const value = await window.showQuickPick(values);
        if (value === this.EDIT_STRING) {
            this.showParamInJson();
        }
        else if (value !== undefined) {
            this.setSelectedValue(value);
        }
    }

    async showParamInJson() {
        const textDocument = await workspace.openTextDocument(this.jsonFile);
        const position = textDocument.positionAt(this.offset);
        const selection = new Range(position, position);
        await window.showTextDocument(textDocument, {selection});
    }

    setSelectedValue(value: string) {
        ext.getExtensionContext().workspaceState.update(this.commandGetValue, value);
        this.setText(value);
    }

    setText(text: string) {
        if (text === '') {
            this.statusBarItem.color = this.FONT_COLOR_DISABLED;
            text = this.name;
        } else if (ext.getShowParamNames()) {
            this.statusBarItem.color = '';
            text = `${this.name}: ${text}`;
        } else {
            this.statusBarItem.color = '';
        }
        this.statusBarItem.text = text;
    }

    getSelectedValue() {
        return ext.getExtensionContext().workspaceState.get<string>(this.commandGetValue);
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
interface FlagOptions {
    flag: string;
}
export class FlagParam extends Param {
    options: FlagOptions;

    constructor(name: string, command: string, priority: number, offset: number, jsonFile: Uri, options: FlagOptions) {
        super(name, command, priority, offset, jsonFile);
        this.options = options;
        this.statusBarItem.text = this.name;
    }

    async onClick() {
        this.setSelectedValue(!this.getSelectedValue() ? this.options.flag : '');
    }

    setText(text: string) {
        // text = `${this.name} ${text ? '\u25cb' : '\u25c9'}`;
        this.statusBarItem.color = text ? '' : this.FONT_COLOR_DISABLED;
    }

    async getValues(): Promise<string[]> {
        return [this.options.flag, ''];
    }
}

/**
 * CommandParam
 */
interface CommandOptions {
    shellCmd: string;
    cwd: string | undefined;
    separator: string | undefined;
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
            let stdout = await this.execCmd(this.options.shellCmd, execPath);
            let values = stdout.split(this.options.separator || '\n');
            if (values && values.length > 0 && values[values.length - 1] === '') {
                values.pop();
            }
            return values;
        } catch (e) {
            let error = `Failed to launch command of ${this.name}: Starting directory (cwd) "${execPath}" does not exist.`;
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