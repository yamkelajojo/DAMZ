/**
 * TC-DB-SETUP — every app that opens the encrypted database must enable SQLCipher.
 *
 * `expo-sqlite` does not take an encryption key in its JS API: encryption is a
 * *native build flag*. The `expo-sqlite` config plugin translates
 * `plugins: [["expo-sqlite", { useSQLCipher: true }]]` into
 * `expo.sqlite.useSQLCipher=true` in `android/gradle.properties` and the iOS
 * Podfile properties (verified in `expo-sqlite@57.0.3` `plugin/src/withSQLite.ts`).
 *
 * Getting this wrong is silent: without the flag the native library is built
 * without SQLCipher, the adapter's `PRAGMA key` has no effect, and — since the
 * adapter now fails closed — the app cannot open its database at all. The Runner
 * app shipped without any `app.json`, so its database could never have been
 * created; this test makes that a build failure rather than a runtime surprise.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const APPS_DIR = path.join(REPO_ROOT, 'apps');

type AppManifest = {
  plugins?: (string | [string, Record<string, unknown>])[];
};

type AppConfig = {
  expo?: AppManifest;
};

type PackageManifest = {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

function appDirectories(): string[] {
  return fs
    .readdirSync(APPS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
}

function isTracked(filePath: string): boolean {
  try {
    execFileSync(
      'git',
      ['ls-files', '--error-unmatch', '--', path.relative(REPO_ROOT, filePath)],
      { cwd: REPO_ROOT, stdio: 'ignore' },
    );
    return true;
  } catch {
    return false;
  }
}

function hasDatabaseDependency(appDir: string): boolean {
  const manifest = readJson<PackageManifest>(path.join(APPS_DIR, appDir, 'package.json'));
  const dependencies = { ...manifest.dependencies, ...manifest.devDependencies };
  return '@damz/db' in dependencies || 'expo-sqlite' in dependencies;
}

/** The `expo-sqlite` plugin entry, whichever of the two shapes it uses. */
function sqlitePlugin(config: AppConfig): Record<string, unknown> | undefined {
  for (const plugin of config.expo?.plugins ?? []) {
    if (plugin === 'expo-sqlite') return {};
    if (Array.isArray(plugin) && plugin[0] === 'expo-sqlite') {
      return (plugin[1] ?? {}) as Record<string, unknown>;
    }
  }
  return undefined;
}

const apps = appDirectories();
const databaseApps = apps.filter(hasDatabaseDependency);

describe('TC-DB-SETUP — SQLCipher build configuration', () => {
  it('finds the apps and the ones that open the database', () => {
    expect(apps.length).toBeGreaterThanOrEqual(3);
    expect(databaseApps.length).toBeGreaterThanOrEqual(3);
  });

  it.each(databaseApps)('%s declares the expo-sqlite plugin with useSQLCipher', (appDir) => {
    const appJsonPath = path.join(APPS_DIR, appDir, 'app.json');
    expect(fs.existsSync(appJsonPath)).toBe(true);

    const props = sqlitePlugin(readJson<AppConfig>(appJsonPath));
    expect(props).toBeDefined();
    expect(props?.useSQLCipher).toBe(true);
  });

  it.each(databaseApps)('%s keeps its committed native build in sync', (appDir) => {
    // `android/` and `ios/` are prebuild output; where they are committed, the
    // generated flag must be present too, or a native build from the checkout
    // silently produces a plaintext-capable library.
    const gradleProperties = path.join(APPS_DIR, appDir, 'android', 'gradle.properties');
    if (fs.existsSync(gradleProperties) && isTracked(gradleProperties)) {
      expect(fs.readFileSync(gradleProperties, 'utf8')).toMatch(
        /^expo\.sqlite\.useSQLCipher=true$/m,
      );
    }

    const podfileProperties = path.join(APPS_DIR, appDir, 'ios', 'Podfile.properties.json');
    if (fs.existsSync(podfileProperties) && isTracked(podfileProperties)) {
      const podfile = readJson<Record<string, string>>(podfileProperties);
      expect(podfile['expo.sqlite.useSQLCipher']).toBe('true');
    }
  });
});
