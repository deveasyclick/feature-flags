import { readFile, mkdir, rm, writeFile, copyFile } from "node:fs/promises";
import { dirname, resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { build } from "esbuild";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryDir = resolve(packageDir, "../..");
const outputDir = resolve(packageDir, "dist");
if (dirname(outputDir) !== packageDir) throw new Error("Invalid package output directory.");
const source = JSON.parse(await readFile(resolve(packageDir, "package.json"), "utf8"));
const contracts = JSON.parse(await readFile(resolve(repositoryDir, "packages/contracts/package.json"), "utf8"));
await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });

await build({ entryPoints: [resolve(packageDir, "src/index.ts")], outfile: resolve(outputDir, "index.js"), bundle: true, platform: "node", target: "node20.9", format: "esm", external: ["zod", "zod/*"], legalComments: "eof" });

const config = ts.readConfigFile(resolve(packageDir, "tsconfig.json"), ts.sys.readFile);
if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, "\n"));
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, packageDir);
const options = { ...parsed.options, noEmit: false, declaration: true, emitDeclarationOnly: true, rootDir: repositoryDir, outDir: resolve(outputDir, "types") };
const discovery = ts.createProgram([resolve(packageDir, "src/index.ts")], options);
const roots = discovery.getSourceFiles().filter((file) => !file.isDeclarationFile && file.fileName.startsWith(resolve(repositoryDir, "packages") + sep) && !file.fileName.includes(`${sep}node_modules${sep}`)).map((file) => file.fileName);
const program = ts.createProgram(roots, options);
const diagnostics = ts.getPreEmitDiagnostics(program);
if (diagnostics.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCanonicalFileName: (file) => file, getCurrentDirectory: () => repositoryDir, getNewLine: () => "\n" }));
const result = program.emit(undefined, undefined, undefined, true, { afterDeclarations: [(context) => (sourceFile) => {
  if (!ts.isSourceFile(sourceFile)) return sourceFile;
  function specifier(node) {
    const resolved = ts.resolveModuleName(node.text, sourceFile.fileName, options, ts.sys).resolvedModule?.resolvedFileName;
    if (!resolved || !resolved.startsWith(resolve(repositoryDir, "packages") + sep) || resolved.includes(`${sep}node_modules${sep}`)) return node;
    let path = relative(dirname(sourceFile.fileName), resolved).split(sep).join("/").replace(/\.(?:ts|tsx)$/, ".js");
    if (!path.startsWith(".")) path = `./${path}`;
    return ts.factory.createStringLiteral(path);
  }
  function visit(node) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) return ts.factory.updateImportDeclaration(node, node.modifiers, node.importClause, specifier(node.moduleSpecifier), node.attributes);
    if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) return ts.factory.updateExportDeclaration(node, node.modifiers, node.isTypeOnly, node.exportClause, specifier(node.moduleSpecifier), node.attributes);
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) return ts.factory.updateImportTypeNode(node, ts.factory.createLiteralTypeNode(specifier(node.argument.literal)), node.attributes, node.qualifier, node.typeArguments, node.isTypeOf);
    return ts.visitEachChild(node, visit, context);
  }
  return ts.visitNode(sourceFile, visit);
}] });
if (result.emitSkipped) throw new Error("SDK declaration emit was skipped.");
await copyFile(resolve(packageDir, "README.md"), resolve(outputDir, "README.md"));
await writeFile(resolve(outputDir, "package.json"), JSON.stringify({ name: source.name, version: source.version, description: source.description, type: "module", main: "./index.js", types: "./types/packages/sdk-node/src/index.d.ts", exports: { ".": { types: "./types/packages/sdk-node/src/index.d.ts", import: "./index.js" } }, files: ["index.js", "types", "README.md"], engines: { node: ">=20.9.0" }, license: source.license ?? "UNLICENSED", dependencies: { zod: contracts.dependencies.zod } }, null, 2) + "\n");
console.info(`Prepared ${source.name}@${source.version} in ${outputDir}`);
