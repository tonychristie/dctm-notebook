# Changelog

All notable changes to the DCTM Notebook extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Removed
- `documentum.defaultConnection` and `documentum.dfc.profiles` settings, and the `dfcProfile` field of a connection. None of them had any effect.
- The standalone API panel and the "Documentum: Open API Panel" command. The API tab of the connection workspace replaces them.
- The Type Browser, User Browser and Group Browser views. The Types, Users and Groups tabs of the connection workspace replace them.
- The Object Dump view and the separate object, type, user and group dump panels. The Dump tab of the connection workspace replaces them.
- The `documentum.panels.reuseWindow` setting, which only applied to the separate dump panels.
- The "Documentum: Dump Object" command. An object ID clicked in a notebook result shows in the Dump tab of the notebook's connection.
- The Cabinets under a connection in the sidebar, with Show Properties and Refresh. The Cabinets tab of the connection workspace replaces them.
- The selected connection and the global "Documentum: ..." status bar item. Every notebook and DQL file uses its own connection.
- Switch User. A different user on the same repository is a separate connection.
- Export CSV in the Execute DQL results. Export Excel and Export JSON replace it.

### Fixed
- The Connections view now updates when connection settings change. An open connection whose settings change is disconnected.
- DQL results are no longer cut at 100 rows. Queries in notebooks and DQL files, and the user, cabinet and folder lists, return every row.
- The null object ID `0000000000000000` shows as a plain value in dumps, notebook results and API results, not as a link that fails to load.

### Changed
- The Documentum sidebar is one view, Connections, which lists the connections. Clicking a connection opens its workspace.
- Execute DQL runs on the connection the `.dql` file is linked to. A file with no link uses the only open connection, or asks for one, and keeps it as its link. "Documentum: Link to Connection" changes the link.
- Running a cell in a notebook with no binding asks for a connection and binds the notebook to it.
- DQL type colouring uses the types of the document's own connection: the notebook binding for a cell, the link for a `.dql` file.
- Execute DQL results use the notebook results grid, with sorting, the context menu, Export Excel, Export JSON and object ID links. An object ID opens in the Dump tab of the connection the query ran on.
- DQL type names in `.dql` files and notebook cells are coloured only from the types of the connection, in a type position. The fixed list of type names and the `_c` and `_s` suffix rule are gone. Attribute names are no longer coloured, including the name of a repeating attribute such as `r_version_label[0]`.
- The status bar shows the connection of the active notebook or `.dql` file, and clicking it changes the binding or the link.
- Connect to Documentum opens the workspace of the connection it connects. Disconnect from Documentum asks which connection when several are open. Show Connections lists every connection with its state and opens the workspace of the one picked.
- Generate DQL Query links its new document to the workspace's connection.
- Renamed `DfcBridge` to `DctmBridge` to better reflect its role as a unified interface to Documentum (both DFC and REST)
- Refactored bridge architecture to use polymorphism instead of if/else branching:
  - `IUnifiedBridge` interface defines the contract for unified API methods
  - `DfcBridgeImpl` contains pure DFC/DQL implementation (no branching)
  - `RestBridgeImpl` contains pure REST implementation (no branching)
  - `DctmBridge` creates the appropriate implementation at connect time
- The Cabinets, Users and Groups tabs use REST endpoints instead of DQL when connected via REST. This improves compatibility with REST-only Documentum setups where DQL may not be available.

### Added
- DQL tab in the connection workspace: a query box with DQL colouring and completion of keywords, functions, the connection's types and the attributes of the query's types. Run or Ctrl+Enter runs the selection or the whole query on the workspace's connection. Results show in the notebook results grid, and the last 10 queries are kept in a history.
- Connection workspace: one editor tab per connection, opened by clicking the connection in the Connections view or with "Documentum: Open Workspace". It has a Cabinets tab to browse cabinets, folders and documents, and a Dump tab with Back, Forward and an object ID box.
- Types, Users and Groups tabs in the connection workspace, with search, Refresh, and Dump and Generate DQL Query on the context menu. Type, user and group dumps show in the Dump tab and share its history with object dumps.
- API tab in the connection workspace, to execute API methods on the workspace's connection. Execute API Method on a cabinet, folder or document shows it with the object ID filled in.
- Session methods in the API tab: `getSessionId`, `getLoginTicket`, `getLoginUserName`, `getDocbaseName`, `getDocbaseId`, `getDocbaseOwnerName`, `getServerVersion`, `getDBMSName` and `isConnected`. They run on the session, so the README's Get Session Information example works.
- New DQL notebook and Open notebook buttons in the connection workspace header. Both open a notebook bound to the workspace's connection.
- "Documentum: Manage Connections" panel to add, edit, duplicate, delete and test connections without editing `settings.json`
- Completion snippets for a DFC and a REST connection in `documentum.connections`, and a problem marker for a DFC connection without `docbroker` or a REST connection without `endpoint`
- New `bridgeTypes.ts` with shared type definitions (`ObjectInfo`, `UserInfo`, `GroupInfo`, etc.)
- New `dfcBridgeImpl.ts` with pure DFC/DQL implementation of `IUnifiedBridge`
- New `restBridgeImpl.ts` with pure REST implementation of `IUnifiedBridge`
- Unified API methods in dctmBridge.ts that automatically route to REST or DQL based on session type:
  - `getCabinets()` - List cabinets
  - `getFolderContents()` - List folder contents
  - `getUsers()` - List users
  - `getUser()` - Get user details
  - `getGroups()` - List groups
  - `getGroup()` - Get group details
  - `getGroupsForUser()` - Get groups containing a user
  - `getParentGroups()` - Get parent groups
- Tests for polymorphic implementation pattern and interface contract

## [1.0.3] - 2026-01-19

### Added
- New `documentum.bridge.host` setting to configure remote bridge host (default: localhost)

### Changed
- Lowered minimum VS Code version requirement from 1.85.0 to 1.84.0 for broader compatibility

### Removed
- Removed unimplemented `documentum.bridge.autoStart` setting

## [1.0.2] - 2026-01-14

### Added
- Initial marketplace release
- DQL editor with syntax highlighting
- Repository browser (objects, types, users, groups)
- Notebook interface for DQL queries
- DFC and REST connectivity support
- API method execution panel
