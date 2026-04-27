import { execa } from 'execa';
import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';

const COLORS = {
  primary: chalk.cyan,
  success: chalk.green,
  warning: chalk.yellow,
  error: chalk.red,
  info: chalk.blue,
};

/**
 * Automates bundling of local libraries for Sandpack consumption using tsup.
 */
export async function bundleLocalLibrary(libPath: string): Promise<{ name: string; code: string } | null> {
  try {
    const pkgPath = path.join(libPath, 'package.json');
    if (!await fs.pathExists(pkgPath)) return null;

    const pkg = await fs.readJson(pkgPath);
    const libName = pkg.name || path.basename(libPath);
    const buildDir = path.join(libPath, 'build-sandpack');

    console.log(COLORS.info(`[Bundler] Bundling local library: ${libName}...`));

    // Run tsup to generate a browser-safe bundle
    await execa('npx', [
      'tsup', 
      'index.ts', 
      '--format', 'esm', 
      '--outDir', 'build-sandpack', 
      '--minify', 
      '--no-dts',
      '--clean'
    ], { cwd: libPath });

    const bundledCode = await fs.readFile(path.join(buildDir, 'index.js'), 'utf-8');

    return {
      name: libName,
      code: bundledCode
    };
  } catch (error: any) {
    console.warn(COLORS.warning(`[Bundler] Failed to bundle ${libPath}: ${error.message}`));
    return null;
  }
}

/**
 * Scans the workspace for local file-based dependencies.
 */
export async function scanLocalDependencies(projectRoot: string): Promise<string[]> {
  try {
    const pkg = await fs.readJson(path.join(projectRoot, 'package.json'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const localPaths: string[] = [];

    for (const [name, version] of Object.entries(deps)) {
      if (typeof version === 'string' && version.startsWith('file:')) {
        const relativePath = version.replace('file:', '');
        localPaths.push(path.resolve(projectRoot, relativePath));
      }
    }
    return localPaths;
  } catch {
    return [];
  }
}
