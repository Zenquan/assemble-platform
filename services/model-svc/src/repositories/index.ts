import type { ModelAssetVersion } from '@assemble/domain';
import { createRepo, resolveBackend, type Repository } from '@assemble/storage';
import { err, ok } from '@assemble/http';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface ModelRepos {
  assets: Repository<ModelAssetVersion>;
}

export function createModelRepos(): ModelRepos {
  const backend = resolveBackend();
  const dataDir =
    process.env['ASSEMBLE_DATA_DIR'] ?? path.resolve(__dirname, '../../.assemble-data');
  return {
    assets: createRepo<ModelAssetVersion>({ backend, dataDir }, 'model-assets'),
  };
}
