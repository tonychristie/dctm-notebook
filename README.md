# Documentum Tools for VS Code

A VS Code extension for Documentum development - DQL queries and DFC integration.

## Features

### DQL Editor

- **Syntax Highlighting**: Full DQL syntax highlighting for `.dql` files
- **Semantic Token Support**: Dynamic highlighting of repository type names
- **Execute Queries**: Run DQL queries directly from the editor (Ctrl+Shift+E / Cmd+Shift+E)

### Repository Browser

- **Object Browser**: Navigate repository folders and objects
- **Type Browser**: Explore type hierarchy and attributes
- **Properties View**: View object properties and metadata

### API Method Support

- **Autocomplete**: When typing API method names in DQL files or `.api` files, autocomplete suggestions appear with method signatures
- **Hover Documentation**: Hover over a method name (e.g., `save`, `checkout`, `query`) to see the full dmAPI signature and description

Supported method categories:
- `dmAPIExec` - Commands that modify state (save, destroy, link, etc.)
- `dmAPIGet` - Commands that return values (connect, query, create, etc.)
- `dmAPISet` - Commands that set values (set, append, insert, etc.)

### API Execution Panel

- **Method Browser**: Browse and search available DFC API methods
- **Execute Methods**: Execute API methods on repository objects
- **Quick Actions**: Checkout, Checkin, Cancel Checkout from context menus

## Requirements

- VS Code 1.85.0 or higher
- DFC Bridge service for DFC connectivity (optional for REST-only connections)

## Extension Settings

This extension contributes the following settings:

* `documentum.connections`: List of Documentum connection configurations
* `documentum.defaultConnection`: Name of the default connection
* `documentum.dfc.profiles`: DFC profile configurations
* `documentum.bridge.port`: Port for DFC Bridge microservice (default: 9876)
* `documentum.bridge.autoStart`: Automatically start DFC Bridge when connecting

## Data Files

The extension includes reference data for API methods:

- `data/api-methods.json`: Comprehensive reference for ~140 Documentum Server API methods

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

See LICENSE file.
