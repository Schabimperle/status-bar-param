# Change Log

All notable changes to the "status-bar-param" extension will be documented in this file.

## [1.6.0]

- Added parsing the 'initialSelection' value from the argument section of parameters., which can be used to set an initial selection.
- Fixed not parsing the inputs section of the 'launch' configuration of .code-workspace files.

## [1.5.0]

- Added hide options, globally and per parameter (showName/s, showSelection/s).
- Moved tree view to its own view container.

## [1.4.0]

- Added retrieving values from shell commands.
- Added option for multiple selection.
- Added tree view (tab in file explorer).
- Added commands to....
    - ... Edit a parameter.
    - ... Copy the retrieval string for a parameter.
    - ... Delete a parameter.
    - ... Select a parameter.
- Added json schema validation for input sections .
- Minor improvements and bugfixes.
    - Preselection of the last picked value in selection list.
    - Made adding sample task optional.
    - Added icons for array and command parameters.
    - Updated extension overview.

## [1.3.1]

- Added parsing inputs from launch.json.

## [1.3.0]

- Added parsing inputs from .code-workspace file.

## [1.2.4]

- Fixed "Feature Contributions" listing in extensions view of status bar param.

## [1.2.3]

- Fixed bug from 1.0.7.

## [1.2.0 - 1.2.2]

- Increased version accidentially. Unpublishing not possible...

## [1.0.7]

- Tried Fixing bug at loading inputs in tasks.json (didn't work).

## [1.0.6]

- Storing selection of status bar items in workspace instead of global storage.

## [1.0.5]

- Added setting to show the param names in the status bar.

## [1.0.4]

- Fixed multiple bugs with multi root workspaces.
- Added Workspace picker for adding inputs by command.
- Shortened command prefix for getting the selected value (`statusBarParam.getSelected.<name>` -> `statusBarParam.get.<name>`)

## [1.0.3]

- Added multi root

## [1.0.2]

- Added icon.

## [1.0.1]

- Updated Readme.

## [1.0.0]

- Initial release