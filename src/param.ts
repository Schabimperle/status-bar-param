import { commands, Disposable, env, QuickPickItem, Range, StatusBarAlignment, StatusBarItem, ThemeColor, ThemeIcon, window, workspace } from 'vscode';
import * as ext from './extension';
import { Strings } from './strings';
import { ParameterProvider } from './parameterProvider';
import { JsonFile } from './jsonFile';
import { ValuesDelegate } from './valuesDelegate';
import * as jsonc from 'jsonc-parser';
import { Options } from './schemas';

export class Param {
    private static readonly COLOR_INACTIVE = new ThemeColor('input.foreground');
    private readonly statusBarItem: StatusBarItem;
    private readonly disposables: Disposable[] = [];

    constructor(
        public readonly id: string,
        public readonly command: string,
        public readonly opts: Options,
        private readonly priority: number,
        private readonly jsonOffset: number,
        private readonly jsonArrayIndex: number,
        private readonly jsonFile: JsonFile,
        private readonly valuesDelegate: ValuesDelegate) {

        // create status bar item
        this.statusBarItem = window.createStatusBarItem(StatusBarAlignment.Left, this.priority);
        this.statusBarItem.tooltip = this.id;
        this.disposables.push(this.statusBarItem);
        this.statusBarItem.command = {
            title: 'Select',
            command: Strings.COMMAND_SELECT,
            arguments: [this],
            tooltip: this.id
        };
        this.update();

        try {
            // create command to retrieve the selected value (when input:<input_id> is used in json)
            this.disposables.push(
                commands.registerCommand(this.command, () => this.onGet())
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
            if (this.opts.initialSelection) {
                if (this.opts.initialSelection instanceof Array) {
                    selection = this.opts.initialSelection;
                } else {
                    selection = [this.opts.initialSelection];
                }
            } else {
                selection = [];
            }
        }
        // Delete selected values that are not selectable
        selection = selection.filter(s => values.includes(s));

        // Set default value if selection is empty and mulitple selection is not used. For multiple selection, leave emtpy.
        if (selection.length === 0 && !this.opts.canPickMany) {
            selection = [values[0]];
        }

        this.storeSelectedValues(selection);
    }

    async onSelect() {
        const values = await this.getValues();
        const oldSelection = await this.loadSelectedValues() || [];
        // preselect single selection
        if (!this.opts.canPickMany && oldSelection.length === 1) {
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
        const newSelection = await window.showQuickPick(items, { canPickMany: this.opts.canPickMany, ignoreFocusOut: this.opts.canPickMany });
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
        ext.getExtensionContext().workspaceState.update(this.command, values);
        this.setText(values);
        ParameterProvider.onDidChangeTreeDataEmitter.fire(this);
    }

    setText(selection: string[]) {
        const showName = this.opts.showName !== undefined ? this.opts.showName : ext.getShowNames();
        const showSelection = this.opts.showSelection !== undefined ? this.opts.showSelection : ext.getShowSelections();
        const selectionEmpty = selection.length === 0 || (selection.length === 1 && selection[0] === '');
        // determine text
        let text = '';
        if (showName || (selectionEmpty && showSelection)) {
            text = this.id;
        }
        if (showSelection && !selectionEmpty) {
            if (showName) {
                text += ': ';
            }
            text += selection.join(' ');
        }
        // detemine color
        if (selectionEmpty) {
            this.statusBarItem.color = Param.COLOR_INACTIVE;
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
        let values = ext.getExtensionContext().workspaceState.get<string[]>(this.command);
        // to remain compatible for stored values of version 1.3.1 and before
        if (!values) {
            const oldKey = `${Strings.COMMAND_SELECT}.${this.id}`;
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
            env.clipboard.writeText(`\${input:${this.id}}`);
        }
        else if (copyType?.label === commandStringLabel) {
            env.clipboard.writeText(`\${command:${Strings.EXTENSION_ID}.get.${this.id}}`);
        }
    }

    async onDelete() {
        const selection = await window.showQuickPick(["No", "Yes"], { placeHolder: 'Do you really want to delete ' + this.id + '?' });
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

    getValues(): Promise<string[]> {
        return this.valuesDelegate.getValues();
    }

    getIcon(): ThemeIcon {
        return this.valuesDelegate.getIcon();
    }
}