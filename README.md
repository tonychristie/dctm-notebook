# DCTM Notebook

A VS Code notebook interface for DQL queries with REST and DFC connectivity to OpenText Documentum repositories.

## Installation

### From VS Code Marketplace

1. Open VS Code
2. Go to Extensions (Ctrl+Shift+X / Cmd+Shift+X)
3. Search for "DCTM Notebook"
4. Click Install

### From VSIX

1. Download the `.vsix` file from the [releases page](https://github.com/tonychristie/dctm-notebook/releases)
2. In VS Code, go to Extensions
3. Click the `...` menu and select "Install from VSIX..."
4. Select the downloaded file

## Getting connected

1. **Start the bridge**: the DFC Bridge for DFC connections, the REST Bridge for REST connections. If it is not on `localhost:9876` (DFC) or `localhost:9877` (REST), set `documentum.bridge.host`, `documentum.bridge.port` and `documentum.bridge.restPort`.
2. **Add a connection**: run "Documentum: Manage Connections", or click "Add Connection" in the Connections view. Use Test Connection to check it.
3. **Connect**: click the connection in the Connections view. It connects and opens the connection's workspace. The plug button on the connection does the same. Enter the password when asked. Passwords are not stored and are asked for on each connect.
4. **Notebooks**: a notebook runs on the connection it is bound to. Running a cell in a notebook with no binding asks for a connection and binds the notebook to it. "Bind to Connection" in the notebook toolbar changes the binding.
5. **DQL files**: a `.dql` file is linked to a connection. The first Execute DQL on a file uses the only open connection, or asks which connection to use when none or several are open, and links the file to it. "Link to Connection" in the editor context menu changes the link. The line above the first line of the file shows the link, and its Change or Link action changes it. Links of saved files are kept across window reloads. An untitled DQL document that is saved to a file keeps its link.

The status bar shows the connection of the active notebook or `.dql` file. Click it to change the binding or the link. DQL type names are coloured from the types of that connection, once it is open.

### Connections view

The Documentum sidebar has one view, Connections, with one item per configured connection. An open connection shows its repository and user; a closed one shows "disconnected".

- Click a connection to open its workspace, connecting first when needed.
- The plug button connects a closed connection and opens its workspace, and the disconnect button closes an open one.
- The title bar has Refresh and Manage Connections.
- To work as another user on the same repository, add a second connection with that username.

### Connection fields

Connections are stored in `documentum.connections` in the user or workspace `settings.json`.

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `name` | DFC and REST | Yes | | Connection name, unique among the connections |
| `type` | DFC and REST | Yes | `dfc` | `dfc` connects through the DFC Bridge, `rest` through the REST Bridge |
| `repository` | DFC and REST | Yes | | Repository name |
| `username` | DFC and REST | No | | When empty, the username is asked for on connect |
| `docbroker` | DFC | Yes | | Docbroker host name or IP address |
| `port` | DFC | Yes | `1489` | Docbroker port |
| `endpoint` | REST | Yes | | REST API endpoint URL |

A DFC connection:

```json
"documentum.connections": [
  { "name": "dctm_242", "type": "dfc", "repository": "dctm_242", "docbroker": "127.0.0.1", "port": 1489 }
]
```

A REST connection:

```json
"documentum.connections": [
  { "name": "dctm_242_rest", "type": "rest", "repository": "dctm_242", "endpoint": "http://127.0.0.1:8080/dctm-rest" }
]
```

## Connection workspace

Click a connection in the Connections view to open its workspace, an editor tab titled with the connection name. When the connection is not open, it connects first and asks for the password. "Documentum: Open Workspace" in the Command Palette does the same for a connection you pick. Each connection has one workspace; clicking the connection again shows it. Several workspaces can be open at the same time, one per connection.

The header shows the connection name, the repository and the user. Below it are the tabs.

The header also has two notebook buttons:

- **New DQL notebook** opens a new notebook with one empty DQL cell, bound to the workspace's connection.
- **Open notebook** asks for a `.dctmbook` file. A notebook with no binding is bound to the workspace's connection and opened. A notebook bound to this connection is opened. A notebook bound to another connection asks whether to bind it to this one: Bind binds it and opens it, Open as is opens it with its binding unchanged.

### Cabinets tab

- A tree of the repository's cabinets, folders and documents. Folders are listed before documents, each by name. A folder's contents load when you first expand it.
- Click a cabinet or folder to expand it. Click a document to show it in the Dump tab.
- Refresh reloads the cabinet list.
- Right-click an item for Dump, Execute API Method and, on a cabinet or folder, Refresh. A document also has Checkout, Checkin and Cancel Checkout.

### Types, Users and Groups tabs

- Types shows the type tree, each type under its supertype. Users and Groups list the user and group names.
- A tab loads its list the first time you show it. Refresh reloads the list and shows how many were loaded. If the list cannot load, the tab shows the error with Retry.
- Type in the search box to show the names that contain the text, in any case. In Types, a search shows the matching types as a flat list; clear the box to see the tree again. The number of items shown is next to the Refresh button.
- Click a type, user or group to show it in the Dump tab. In Types, click the arrow to expand a type.
- Right-click an item for Dump and Generate DQL Query. Generate DQL Query opens the query in a new DQL document, linked to the workspace's connection.

### DQL tab

- A query box with DQL colouring and completion, on the workspace's connection. Keywords, functions and constants are coloured, and so are the connection's types where a type name is expected. Attribute names are plain.
- Completion opens while you type, after a `.` and on Ctrl+Space. It offers the connection's types after `FROM`, `JOIN`, `INTO`, `UPDATE` and `TYPE`, the attributes of a type after `<type or alias>.`, and elsewhere the keywords, the DQL functions and the attributes of the query's types. A query is the lines around the cursor up to a blank line or a `;`.
- Click Run, or press Ctrl+Enter (Cmd+Enter on macOS), to run the selection, or the whole query when nothing is selected.
- Results show in the same grid as notebooks. Click an object ID to show it in the Dump tab.
- The history below the results keeps the last 10 queries, with the time and the row count or Error. Click an entry to put its query in the box; it does not run.
- The query text, the result and the history stay when the workspace is hidden, and the query text stays after a window reload.

### Dump tab

- Enter an object ID in the box and press Enter or click Dump. An object ID is 16 hexadecimal characters.
- An object dump shows the object's attributes in groups, with a filter, Refresh, Copy Object ID, Collapse All and Expand All.
- Type, user and group dumps show the type's attributes, the user's details and groups, and the group's members and parent groups, each with Generate DQL.
- Click an object ID value, a supertype or child type, a user's group, a group's parent group or a group member to show it in the same tab. Back and Forward move through everything shown, objects, types, users and groups in one history.
- Click an object ID in a notebook result to show it in the Dump tab of the notebook's connection. Click an object ID in the Execute DQL results to show it in the Dump tab of the connection the query ran on. The workspace opens when it is not open.

### API tab

- Executes API methods on the workspace's connection. See [Using the API tab](#using-the-api-tab).
- Execute API Method on a cabinet, folder or document in the Cabinets tab shows the API tab with the object ID filled in.
- Click an object ID in a result to show it in the Dump tab.

### Disconnects and reloads

- When the connection closes, the workspace stays open with a "Disconnected" banner, and its tabs are disabled. Click Connect in the banner to connect again. The Dump tab keeps its dump and history; click Refresh for current data.
- When the connection is deleted or renamed in Manage Connections, its workspace closes.
- Workspaces are restored after a window reload. Passwords are not stored, so a restored workspace opens disconnected.

## Features

### DQL Editor

- **Syntax Highlighting**: Full DQL syntax highlighting for `.dql` files
- **Semantic Token Support**: Dynamic highlighting of the type names of the file's connection
- **Completion**: In `.dql` files and notebook DQL cells, completion of keywords, functions, the connection's types and the attributes of the query's types, by the same rules as the DQL tab. It opens while you type, after a `.` and on Ctrl+Space, and uses the connection of the file or the notebook. When that connection is not open, it offers keywords and functions only. VS Code's suggestions of words from open documents are off for DQL; set `editor.wordBasedSuggestions` under `[dql]` in `settings.json` to turn them on.
- **Connection Line**: A `.dql` file and an untitled DQL document show their connection above the first line: `Connection: <name> · <repository> as <user>` when the connection is open, `Connection: <name> · disconnected` when it is not, `Connection: <name> · not found` for a link to a name that is not a configured connection, and `Connection: none` when there is no link. Click Change or Link next to it to run Link to Connection for that document. Notebook DQL cells show no connection line; the notebook toolbar shows the binding.
- **Execute Queries**: Run DQL queries directly from the editor (Ctrl+Shift+E / Cmd+Shift+E), on the file's connection. Execute DQL shows its results in the same grid as notebooks. Comments, `--` and `/* */`, are removed before the query is sent, in notebook cells, the DQL tab and Execute DQL.

### API Method Support

- **Autocomplete**: When typing API method names in dmAPI notebook cells or `.dmapi` files, autocomplete suggestions appear with method signatures
- **Hover Documentation**: In the same places, hover over a method name (e.g., `save`, `checkout`, `query`) to see the full dmAPI signature and description

Supported method categories:
- `dmAPIExec` - Commands that modify state (save, destroy, link, etc.)
- `dmAPIGet` - Commands that return values (connect, query, create, etc.)
- `dmAPISet` - Commands that set values (set, append, insert, etc.)

### API Execution

- **Method Browser**: Browse and search available DFC API methods in the workspace's API tab
- **Execute Methods**: Execute API methods on repository objects
- **Quick Actions**: Checkout, Checkin, Cancel Checkout from context menus

## Using the API tab

The API tab of a connection workspace executes DFC methods on repository objects interactively, on the workspace's connection. Each workspace has its own API tab and its own execution history.

### Opening the API tab

1. **From the workspace**: Click the API tab.
2. **From the Cabinets tab**: Right-click a cabinet, folder or document and select "Execute API Method". The API tab shows with the object ID filled in.

### Executing Methods

1. **Enter Object ID** (optional): If you're executing methods on a specific object, enter its `r_object_id`. Leave empty for session-level operations like `getSessionId`. The methods in the Session category always run on the session, even when the box holds an object ID.

2. **Select a Method**:
   - Browse methods by category (Object Operations, Query, Version Control, etc.)
   - Or type in the search box to find methods by name or description

3. **Fill Parameters**: If the method requires parameters, input fields appear automatically. Required parameters are marked with `*`.

4. **Click Execute**: Results appear in the Result panel below with execution time.

### Example Workflows

#### Check Out a Document

1. In the workspace's Cabinets tab, right-click a document
2. Select "Checkout" from the context menu
3. Or use the API tab:
   - Right-click the document and select "Execute API Method"
   - Select `checkout` method
   - Click Execute

#### Query Object Properties

1. Open the workspace's API tab
2. Enter object ID (e.g., `0900000180001234`)
3. Select `getString` method
4. Enter attribute name (e.g., `object_name`)
5. Click Execute to see the value

#### Get Session Information

1. Open the workspace's API tab
2. Leave Object ID empty
3. Select `getSessionId` method
4. Click Execute to see current session ID

### Available Method Categories

| Category | Description | Example Methods |
|----------|-------------|-----------------|
| Session | Session and repository information; runs on the session, never on the object ID | `getSessionId`, `getLoginTicket`, `getDocbaseName`, `getServerVersion` |
| Object Operations | Basic object manipulation | `save`, `destroy`, `fetch`, `revert` |
| Query | Execute queries and get values | `query`, `next`, `getString`, `getInt` |
| Version Control | Document versioning | `checkout`, `checkin`, `cancelCheckout` |
| Links & Relations | Folder and relation management | `link`, `unlink`, `getPath` |
| Attributes | Get/set object attributes | `get`, `set`, `append`, `remove` |

### Keyboard Shortcuts

| Action | Shortcut |
|--------|----------|
| Execute DQL Query | `Ctrl+Shift+E` / `Cmd+Shift+E` |
| Run query in the DQL tab | `Ctrl+Enter` / `Cmd+Enter` |

## Requirements

- VS Code 1.84.0 or higher
- DFC Bridge service for DFC connectivity (optional for REST-only connections)

## DQL Syntax Highlighting

### Token Types

DQL syntax highlighting uses standard TextMate scopes that work with any VS Code colour theme. Type names come from the connection, as the semantic token type `type`:

| Element | Scope | Description |
|---------|-------|-------------|
| Keywords | `keyword.control.dql` | SELECT, FROM, WHERE, etc. |
| DML Keywords | `keyword.other.dml.dql` | INSERT, UPDATE, DELETE, etc. |
| Operators | `keyword.operator.*.dql` | =, <>, +, -, etc. |
| Strings | `string.quoted.*.dql` | 'text' or "text" |
| Numbers | `constant.numeric.dql` | 123, 45.67 |
| Comments | `comment.*.dql` | -- or /* */ |
| Functions | `support.function.*.dql` | COUNT(), UPPER(), etc. |
| Types | semantic token type `type` | The types of the document's connection, where a type name is expected |
| Constants | `constant.language.*.dql` | TRUE, FALSE, NULL |
| Hints | `keyword.other.hint.dql` | /*+ SQL_DEF_RESULT_SET */ |

### Customising Colours

You can customise DQL syntax colours in your VS Code `settings.json` using `editor.tokenColorCustomizations`, and the type colour using `editor.semanticTokenColorCustomizations`:

```json
{
  "editor.tokenColorCustomizations": {
    "textMateRules": [
      {
        "scope": "keyword.control.dql",
        "settings": {
          "foreground": "#0077CC",
          "fontStyle": "bold"
        }
      },
      {
        "scope": "support.function",
        "settings": {
          "foreground": "#8250DF"
        }
      }
    ]
  },
  "editor.semanticTokenColorCustomizations": {
    "rules": {
      "type:dql": { "foreground": "#E67700" }
    }
  }
}
```

### Colourblind-Safe Palettes

The default theme colours depend on your VS Code colour theme. For users who need accessible colour schemes, here are recommended palettes that avoid red/green distinctions:

#### Blue-Orange Palette (Deuteranopia/Protanopia friendly)

```json
{
  "editor.tokenColorCustomizations": {
    "textMateRules": [
      {
        "scope": ["keyword.control.dql", "keyword.other.dml.dql"],
        "settings": { "foreground": "#0077CC", "fontStyle": "bold" }
      },
      {
        "scope": "string.quoted",
        "settings": { "foreground": "#E67700" }
      },
      {
        "scope": "support.function",
        "settings": { "foreground": "#0550AE" }
      },
      {
        "scope": "comment",
        "settings": { "foreground": "#656D76", "fontStyle": "italic" }
      },
      {
        "scope": "constant.numeric",
        "settings": { "foreground": "#953800" }
      },
      {
        "scope": "constant.language",
        "settings": { "foreground": "#0077CC", "fontStyle": "bold" }
      }
    ]
  },
  "editor.semanticTokenColorCustomizations": {
    "rules": {
      "type:dql": { "foreground": "#6E5494", "fontStyle": "italic" }
    }
  }
}
```

#### High Contrast Palette (Uses bold/italic for additional distinction)

```json
{
  "editor.tokenColorCustomizations": {
    "textMateRules": [
      {
        "scope": ["keyword.control.dql", "keyword.other.dml.dql"],
        "settings": { "foreground": "#005A9E", "fontStyle": "bold" }
      },
      {
        "scope": "string.quoted",
        "settings": { "foreground": "#B35900", "fontStyle": "" }
      },
      {
        "scope": "support.function",
        "settings": { "foreground": "#005A9E", "fontStyle": "underline" }
      },
      {
        "scope": "comment",
        "settings": { "foreground": "#5A5A5A", "fontStyle": "italic" }
      },
      {
        "scope": "constant",
        "settings": { "foreground": "#7B3F00", "fontStyle": "bold" }
      }
    ]
  },
  "editor.semanticTokenColorCustomizations": {
    "rules": {
      "type:dql": { "foreground": "#5C2D91", "fontStyle": "italic" }
    }
  }
}
```

#### Monochrome with Styles (Maximum accessibility)

For users who prefer minimal colour variation, this palette uses font styles as the primary differentiator:

```json
{
  "editor.tokenColorCustomizations": {
    "textMateRules": [
      {
        "scope": ["keyword.control.dql", "keyword.other.dml.dql"],
        "settings": { "foreground": "#1F2328", "fontStyle": "bold" }
      },
      {
        "scope": "string.quoted",
        "settings": { "foreground": "#1F2328", "fontStyle": "" }
      },
      {
        "scope": "support.function",
        "settings": { "foreground": "#1F2328", "fontStyle": "italic" }
      },
      {
        "scope": "comment",
        "settings": { "foreground": "#656D76", "fontStyle": "italic" }
      },
      {
        "scope": "constant",
        "settings": { "foreground": "#1F2328", "fontStyle": "bold italic" }
      }
    ]
  },
  "editor.semanticTokenColorCustomizations": {
    "rules": {
      "type:dql": { "foreground": "#1F2328", "fontStyle": "italic underline" }
    }
  }
}
```

## Extension Settings

This extension contributes the following settings:

* `documentum.connections`: List of Documentum connection configurations
* `documentum.bridge.host`: Hostname or IP address where the bridge services are running (default: localhost)
* `documentum.bridge.port`: Port for DFC Bridge microservice (default: 9876)
* `documentum.bridge.restPort`: Port for REST Bridge microservice (default: 9877)
* `documentum.bridge.queryTimeout`: Timeout in seconds for DQL queries, dmAPI commands and API method calls; 0 means no timeout (default: 300)

## Sample Files

The `samples/` directory contains example DQL files to help you get started:

- `basic-queries.dql` - Common queries: listing cabinets, searching documents, counting by format
- `advanced-queries.dql` - Complex queries: full-text search, joins, version history, ACLs

Open these files to see syntax highlighting in action and use them as templates for your own queries.

## Data Files

The extension includes reference data for API methods:

- `data/api-methods.json`: Comprehensive reference for 159 Documentum Server API methods

To add or modify API method documentation, edit the JSON file following the existing format.

## Development

```bash
# Install dependencies
npm install

# Compile
npm run compile

# Run tests
npm test

# Watch for changes
npm run watch
```

## License

MIT License - see [LICENSE](LICENSE) file for details.

Copyright (c) 2024-2026 Spire Professional Services Ltd
