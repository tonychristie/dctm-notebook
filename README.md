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

## DQL Syntax Highlighting

### Token Types

DQL syntax highlighting uses standard TextMate scopes that work with any VS Code colour theme:

| Element | Scope | Description |
|---------|-------|-------------|
| Keywords | `keyword.control.dql` | SELECT, FROM, WHERE, etc. |
| DML Keywords | `keyword.other.dml.dql` | INSERT, UPDATE, DELETE, etc. |
| Operators | `keyword.operator.*.dql` | =, <>, +, -, etc. |
| Strings | `string.quoted.*.dql` | 'text' or "text" |
| Numbers | `constant.numeric.dql` | 123, 45.67 |
| Comments | `comment.*.dql` | -- or /* */ |
| Functions | `support.function.*.dql` | COUNT(), UPPER(), etc. |
| Types | `storage.type.*.dql` | dm_document, dm_folder, etc. |
| Constants | `constant.language.*.dql` | TRUE, FALSE, NULL |
| Hints | `keyword.other.hint.dql` | /*+ SQL_DEF_RESULT_SET */ |

### Customising Colours

You can customise DQL syntax colours in your VS Code `settings.json` using `editor.tokenColorCustomizations`:

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
        "scope": "storage.type.dm.dql",
        "settings": {
          "foreground": "#E67700"
        }
      },
      {
        "scope": "support.function",
        "settings": {
          "foreground": "#8250DF"
        }
      }
    ]
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
        "scope": ["storage.type.dm.dql", "storage.type.dmi.dql"],
        "settings": { "foreground": "#6E5494", "fontStyle": "italic" }
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
        "scope": ["storage.type.dm.dql", "storage.type.dmi.dql"],
        "settings": { "foreground": "#5C2D91", "fontStyle": "italic" }
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
        "scope": ["storage.type.dm.dql", "storage.type.dmi.dql"],
        "settings": { "foreground": "#1F2328", "fontStyle": "italic underline" }
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
  }
}
```

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
