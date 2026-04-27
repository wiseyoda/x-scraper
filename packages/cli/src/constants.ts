/**
 * CLI constants. Default paths, environment variable names, exit codes.
 */

import * as os from 'node:os';
import * as path from 'node:path';

// ~/Documents on macOS is typically symlinked to iCloud Drive when
// Desktop & Documents Folders sync is enabled. iCloud's conflict
// resolution renames concurrently-touched dirs to "<name> 2", which
// corrupts the vault's directory layout (e.g. spurious "topics 2/").
// Default to a non-iCloud-synced path under $HOME and let users
// override via $XSCRAPER_VAULT.
export const DEFAULT_VAULT_DIR = path.join(os.homedir(), 'x-scraper-vault');
export const DEFAULT_QUEUE_PATH = path.join(os.homedir(), '.config', 'x-scraper', 'queue.sqlite');
export const ENV_FILE_PATH = path.join(os.homedir(), '.config', 'x-scraper', '.env');

export const ENV_VAULT = 'XSCRAPER_VAULT';
export const ENV_QUEUE = 'XSCRAPER_QUEUE';

export const EXIT_OK = 0;
export const EXIT_USAGE = 64;
export const EXIT_FAIL = 1;
