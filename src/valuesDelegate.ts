import { exec } from 'child_process';
import * as path from 'path';
import { ThemeIcon, Uri, window, workspace } from 'vscode';
import { CommandOptions } from './schemas';

/**
 * A delegate interface for handling parameter values.
 */
export interface ValuesDelegate {
    /**
     * Returns an icon representing the value type.
     */
    getIcon(): ThemeIcon;

    /**
     * Returns the values to select from by the user.
     */
    getValues(): Promise<string[]>;
}

/**
 * The implementation of the ValuesDelegate interface for a simple array of strings.
 */
export class ArrayValuesDelegate implements ValuesDelegate {
    static readonly ICON = new ThemeIcon('array');

    constructor(private values: string[]) { }

    getIcon() {
        return ArrayValuesDelegate.ICON;
    }

    getValues() {
        // return a copy of the array to preserve the order
        return Promise.resolve([...this.values]);
    }
}

/**
 * The implementation of the ValuesDelegate interface for values that shall be parsed from the output of a shell command to execute.
 */
export class CommandValuesDelegate implements ValuesDelegate {
    static readonly ICON = new ThemeIcon('terminal');
    private cwd: string;

    constructor(private opts: CommandOptions, defaultCwd: string) {
        if (this.opts.cwd) {
            this.cwd = path.resolve(defaultCwd, this.opts.cwd);
        } else {
            this.cwd = defaultCwd;
        }
    }

    getIcon() {
        return CommandValuesDelegate.ICON;
    }

    async getValues() {
        try {
            await workspace.fs.stat(Uri.file(this.cwd));
            const stdout = await this.execCmd(this.opts.shellCmd, this.cwd);
            const values = stdout.split(this.opts.separator || '\n');
            if (values && values.length > 0 && values[values.length - 1] === '') {
                values.pop();
            }
            return values;
        } catch (e) {
            const error = `Failed to launch command ${this.opts.shellCmd}: ${JSON.stringify(e)}`;
            console.error(error);
            window.showErrorMessage(error);
            return [];
        }
    }

    private async execCmd(cmd: string, cwd: string): Promise<string> {
        return new Promise((resolve) => {
            exec(cmd, { cwd }, (error, stdout, stderr) => {
                if (error) {
                    console.error(error + ":", stderr);
                    window.showErrorMessage(`Executing "${this.opts.shellCmd}" at path ${cwd} with shell ${process.env.shell || process.env.ComSpec} failed: ${stderr}`);
                    return;
                }
                resolve(stdout);
            });
        });
    }
}