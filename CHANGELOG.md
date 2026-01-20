# Changelog

All notable changes to the DCTM Notebook extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- Renamed `DfcBridge` to `DctmBridge` to better reflect its role as a unified interface to Documentum (both DFC and REST)
- Refactored bridge to encapsulate connection type routing internally - feature files no longer need to branch on connection type
- Explorer, Users browser, and Groups browser now use REST endpoints instead of DQL when connected via REST. This improves compatibility with REST-only Documentum setups where DQL may not be available.

### Added
- Unified API methods in dctmBridge.ts that automatically route to REST or DQL based on session type:
  - `getCabinets()` - List cabinets
  - `getFolderContents()` - List folder contents
  - `getUsers()` - List users
  - `getUser()` - Get user details
  - `getGroups()` - List groups
  - `getGroup()` - Get group details
  - `getGroupsForUser()` - Get groups containing a user
  - `getParentGroups()` - Get parent groups
- Tests for unified API response format consistency

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
