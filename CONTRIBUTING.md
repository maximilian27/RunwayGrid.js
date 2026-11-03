# Contributing to runway-grid

Thank you for your interest in runway-grid! This document explains the contribution policy and provides development reference information.

## Contribution Policy

I currently maintain full control over the core codebase to ensure architectural consistency. Bug reports via [GitHub Issues](https://github.com/maximilian27/RunwayGrid/issues) are the preferred way to request fixes. Exceptional contributions (critical security fixes, performance regressions) may be considered on a case-by-case basis.

**However, I strongly encourage community contributions for framework wrappers!** If you build a wrapper for React, Angular, Vue, Svelte, or any other framework, you have my full blessing. See the [Framework Wrappers](#framework-wrappers) section below for details.

The sections below provide development setup and build instructions for reference, in case you want to understand the internals, create a fork, or build a framework wrapper.

---

## Development Setup

### Prerequisites

- **Node.js** (latest stable LTS recommended)
- **Rust** (edition 2024 toolchain) — required only if modifying the WASM engine
- **wasm-pack** — required only if modifying the WASM engine
- **npm**

### Installation

```sh
git clone https://github.com/maximilian27/RunwayGrid.git
cd RunwayGrid
npm install
```

### Optional: Rust Toolchain

If you plan to modify the Rust/WebAssembly engine (`runway_engine/`), install Rust and wasm-pack:

```sh
# Install Rust (if not already installed)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Install wasm-pack
cargo install wasm-pack
```

---

## Project Structure

```
runway-grid/
├── src/                          # JavaScript source files
│   ├── runway-grid.js            # Main custom element implementation
│   ├── styles.js                 # Shadow DOM styles
│   ├── template.js               # Cell template rendering logic
│   └── index.js                  # Public API exports
├── runway_engine/                # Rust/WebAssembly layout engine
│   ├── src/                      # Rust source code (Fenwick tree, geometry math)
│   ├── Cargo.toml                # Rust dependencies (wasm-bindgen)
│   └── pkg/                      # Generated WASM artifacts (git-ignored)
├── dist/                         # Built library output (git-ignored)
├── demo/                         # Demo site with examples
│   ├── index.html                # Demo site entry point
│   └── examples/                 # Individual example pages
├── tests/                        # End-to-end tests (Playwright)
├── scripts/                      # Build automation scripts
│   ├── build-wasm.mjs            # wasm-pack build wrapper
│   └── generate-wasm-base64.mjs  # Embeds WASM binary as base64 string
├── vite.config.js                # Demo site Vite configuration
├── vite.lib.config.js            # Library build Vite configuration
└── package.json
```

### Key Design Decisions

- The WASM binary is **embedded as a base64 string** (`src/runway-engine-wasm.js`) rather than fetched as a separate `.wasm` file. This avoids bundler configuration issues (especially with Angular/webpack) at the cost of ~33% base64 overhead (~30 KB JS payload).
- The library is authored in **plain JavaScript with JSDoc type annotations**, not TypeScript. A hand-written declaration file (`dist/runway-grid.d.ts`) ships with the package for TypeScript consumers.

---

## Building

### Development Server

Run the demo site with hot reload:

```sh
npm run dev
```

This starts a Vite dev server serving the `demo/` folder. The demo site requires a bundler to resolve `?raw` imports used for the "Code" tab syntax highlighting.

### Library Build

Build the distributable library package:

```sh
npm run build:lib
```

This command:
1. Runs Vite library build (`vite build --config vite.lib.config.js`)
2. Copies the TypeScript declaration file to `dist/`

The output is placed in `dist/` and includes:
- `runway-grid.js` — ES module
- `runway-grid.umd.cjs` — UMD bundle
- `runway-grid.d.ts` — TypeScript declarations

### WASM Engine Build

If you modify the Rust engine (`runway_engine/`), rebuild the WASM binary:

```sh
# Step 1: Compile Rust to WASM with wasm-pack
npm run build:wasm

# Step 2: Embed the WASM binary as a base64 string in JS
npm run build:wasm-base64

# Or run both steps together
npm run build:engine
```

**Important:** After rebuilding the engine, commit the updated `src/runway-engine-wasm.js` file. The `runway_engine/pkg/` directory is git-ignored; only the embedded base64 version is published.

### Demo Site Build

Build the demo site for production deployment:

```sh
npm run build
```

Preview the built demo site locally:

```sh
npm run preview
```

---

## Testing

### End-to-End Tests

The project uses Playwright for end-to-end testing:

```sh
npx playwright install    # First time: install browser binaries
npm run test:e2e
```

Tests are located in the `tests/` directory and configured via `playwright.config.js`.

---

## Type Checking

The library uses JSDoc annotations for type checking. Run the TypeScript compiler over the source files to verify type consistency:

```sh
npm run typecheck
```

This runs `tsc` with `allowJs`/`checkJs` over `src/*.js`, using the JSDoc comments as type annotations. It does **not** generate or replace `dist/runway-grid.d.ts` — it's a safety net that flags places where the implementation and its JSDoc types have drifted apart.

**Always run `npm run typecheck` after changing `src/runway-grid.js` and ensure it passes before submitting a PR.**

---

## Code Style

- **Indentation:** 2 spaces (JavaScript), 4 spaces (Rust)
- **Quotes:** Single quotes for JavaScript strings
- **Semicolons:** Used consistently
- **JSDoc:** All public APIs must have JSDoc comments with `@param`, `@returns`, and `@description` tags
- **Rust:** Follow standard Rustfmt conventions

---

## Framework Wrappers

`runway-grid` is a framework-agnostic Web Component — it works in any environment that supports Custom Elements, without needing a framework-specific wrapper.

**I don't plan to actively maintain official framework wrappers** (React, Angular, Vue, etc.), but if someone wants to build one and publish an npm package, they have my blessing. Community wrappers are welcome and will be featured in the README once they're available.

**Attribution requirement:** Any community wrapper must prominently credit `runway-grid` as the underlying library. Specifically, the wrapper's `README.md` (or equivalent documentation) should include a clear link back to the original [runway-grid repository](https://github.com/maximilian27/RunwayGrid) and mention that it is built on top of runway-grid. This ensures proper attribution regardless of how popular the wrapper becomes.

For reference implementations, see the [demo site](https://maximilian27.github.io/RunwayGrid.js/) which shows how to integrate `<runway-grid>` with different frameworks.

---

## Reporting Issues

While I don't accept code contributions to the core repo, I do welcome bug reports and feature requests via [GitHub Issues](https://github.com/maximilian27/RunwayGrid/issues). Please include:

- A clear description of the issue or request
- Steps to reproduce (for bugs)
- Expected vs actual behavior
- Browser and version information

---

## License

runway-grid is licensed under the [Apache-2.0 License](./LICENSE). See the [NOTICE](./NOTICE) file for attribution requirements.
