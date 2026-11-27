const esbuild = require('esbuild');
const fs = require('fs');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
  name: 'esbuild-problem-matcher',
  setup(build) {
    build.onStart(() => {
      console.log('[watch] build started');
    });
    build.onEnd(result => {
      result.errors.forEach(({ text, location }) => {
        console.error(`✘ [ERROR] ${text}`);
        console.error(`    ${location.file}:${location.line}:${location.column}:`);
      });
      console.log('[watch] build finished');
    });
  }
};

// The DQL grammar is generated from the shared vocabulary, so the file colouring matches the DQL tab.
async function writeGrammar() {
  const result = await esbuild.build({
    entryPoints: ['src/dql/grammar.ts'],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    write: false,
    logLevel: 'silent'
  });
  const module = { exports: {} };
  new Function('module', 'exports', result.outputFiles[0].text)(module, module.exports);
  // The generated grammar is the only file in syntaxes, so a clean checkout has no syntaxes directory.
  fs.mkdirSync('syntaxes', { recursive: true });
  fs.writeFileSync('syntaxes/dql.tmLanguage.json', JSON.stringify(module.exports.dqlGrammar(), null, 2) + '\n');
}

async function main() {
  await writeGrammar();

  const ctx = await esbuild.context({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    format: 'cjs',
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: 'node',
    outfile: 'out/extension.js',
    external: ['vscode'],
    logLevel: 'silent',
    plugins: [
      esbuildProblemMatcherPlugin
    ]
  });

  // Build the renderer separately for webview context
  const rendererCtx = await esbuild.context({
    entryPoints: ['src/notebook/renderer.ts'],
    bundle: true,
    format: 'esm',
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: 'browser',
    loader: { '.css': 'text' },
    outfile: 'out/notebook/renderer.js',
    logLevel: 'silent',
    plugins: [
      esbuildProblemMatcherPlugin
    ]
  });

  const webviewsCtx = await esbuild.context({
    entryPoints: [
      'src/webviews/connectionWorkspace.ts',
      'src/webviews/connectionWorkspace.css',
      'src/webviews/connectionsPanel.ts',
      'src/webviews/resultsPanel.ts',
      'src/webviews/resultsPanel.css'
    ],
    bundle: true,
    format: 'iife',
    loader: { '.ttf': 'file' },
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: 'browser',
    outdir: 'out/webviews',
    logLevel: 'silent',
    plugins: [
      esbuildProblemMatcherPlugin
    ]
  });

  if (watch) {
    await ctx.watch();
    await rendererCtx.watch();
    await webviewsCtx.watch();
  } else {
    fs.rmSync('out', { recursive: true, force: true });
    await ctx.rebuild();
    await rendererCtx.rebuild();
    await webviewsCtx.rebuild();
    await ctx.dispose();
    await rendererCtx.dispose();
    await webviewsCtx.dispose();
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
