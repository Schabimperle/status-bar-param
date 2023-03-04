import Ajv from 'ajv';
import optionsSchema from './schemas/options_schema.json';
import stringArraySchema from './schemas/string_array_schema.json';
import arrayOptionsSchema from './schemas/array_options_schema.json';
import commandOptionsSchema from './schemas/command_options_schema.json';
import inputSchema from './schemas/input_schema.json';

export class Options {
    canPickMany?: boolean;
    showName?: boolean;
    showSelection?: boolean;
    initialSelection?: string | string[];
}

export interface ArrayOptions extends Options {
    values: string[];
}

export interface CommandOptions extends Options {
    shellCmd: string;
    cwd?: string;
    separator?: string;
}

export interface Input {
    id: string,
    command: string,
    args: string[] | ArrayOptions | CommandOptions
}

// compile schema validators for ArrayInput/CommandInput
const ajv = new Ajv();
ajv.addSchema(optionsSchema)
    .addSchema(stringArraySchema)
    .addSchema(arrayOptionsSchema)
    .addSchema(commandOptionsSchema);

// create schema validator to identify array options
export const validateStringArrayInput = ajv.getSchema<string[]>("string_array_schema.json")!;
// create schema validator to identify array options
export const validateArrayOptionsInput = ajv.getSchema<ArrayOptions>("array_options_schema.json")!;
// create schema validator to identify command options
export const validateCommandOptionsInput = ajv.getSchema<CommandOptions>("command_options_schema.json")!;

// manipulate input args types to simplify validateStatusBarParamInput function
inputSchema.then.properties.args = (<any>{
    oneOf: [
        { "type": "array" },
        { "type": "object" }
    ]
});
// create schema validator to identify input options meant for this extension
export const validateStatusBarParamInput = ajv.compile<Input>(inputSchema);