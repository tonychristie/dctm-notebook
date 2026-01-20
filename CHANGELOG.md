# Changelog

All notable changes to the DCTM Notebook extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- Explorer, Users browser, and Groups browser now use REST endpoints instead of DQL when connected via REST. This improves compatibility with REST-only Documentum setups where DQL may not be available.

### Added
- New REST endpoint methods in dfcBridge.ts:
  - `getCabinets()` - List cabinets via REST
  - `getFolderContents()` - List folder contents via REST
  - `getUsers()` - List users via REST
  - `getUser()` - Get user details via REST
  - `getGroups()` - List groups via REST
  - `getGroup()` - Get group details via REST
  - `getGroupsForUser()` - Get groups containing a user via REST
  - `getParentGroups()` - Get parent groups via REST

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
