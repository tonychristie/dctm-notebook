# Changelog

All notable changes to the DCTM Notebook extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- Renamed `DfcBridge` to `DctmBridge` to better reflect its role as a unified interface to Documentum (both DFC and REST)
- Refactored bridge architecture to use polymorphism instead of if/else branching:
  - `IUnifiedBridge` interface defines the contract for unified API methods
  - `DfcBridgeImpl` contains pure DFC/DQL implementation (no branching)
  - `RestBridgeImpl` contains pure REST implementation (no branching)
  - `DctmBridge` creates the appropriate implementation at connect time
- Explorer, Users browser, and Groups browser now use REST endpoints instead of DQL when connected via REST. This improves compatibility with REST-only Documentum setups where DQL may not be available.

### Added
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
