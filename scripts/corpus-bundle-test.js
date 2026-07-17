'use strict';

const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const { bootstrapCorpus, verifyBundle } = require('./corpus-manager');

const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');

async function writeBundle(directory) {
  const snapshot = Buffer.from('synthetic-qdrant-snapshot-contract-test');
  const inventory = Buffer.from(`${JSON.stringify({ generatedAtUtc: '2026-07-17T00:00:00.000Z', chunks: [] }, null, 2)}\n`);
  const readme = Buffer.from('# Synthetic corpus fixture\n');
  await fs.mkdir(path.join(directory, 'mysql'), { recursive: true });
  await fs.mkdir(path.join(directory, 'qdrant'), { recursive: true });
  await fs.writeFile(path.join(directory, 'mysql', 'edurag.sql'), '-- synthetic\n');
  await fs.writeFile(path.join(directory, 'qdrant', 'education_docs.snapshot'), snapshot);
  await fs.writeFile(path.join(directory, 'inventory.json'), inventory);
  await fs.writeFile(path.join(directory, 'README.md'), readme);
  const files = {
    'mysql/edurag.sql': await fs.readFile(path.join(directory, 'mysql', 'edurag.sql')),
    'qdrant/education_docs.snapshot': snapshot,
    'inventory.json': inventory,
    'README.md': readme
  };
  const checksums = Object.fromEntries(Object.entries(files).map(([name, value]) => [name, hash(value)]));
  const manifest = {
    bundleFormatVersion: '1.0.0',
    createdAtUtc: '2026-07-17T00:00:00.000Z',
    databaseSchemaVersion: '1.0.0',
    mysqlServerVersion: '8.4.10',
    qdrantServerVersion: '1.18.2',
    qdrantCollectionName: 'education_docs',
    embeddingModel: 'gemini-embedding-001',
    embeddingDimension: 768,
    documentCount: 0,
    chunkCount: 0,
    qdrantPointCount: 0,
    originalFilesIncluded: false,
    files: { mysqlDump: 'mysql/edurag.sql', qdrantSnapshot: 'qdrant/education_docs.snapshot', inventory: 'inventory.json' },
    checksums
  };
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  await fs.writeFile(path.join(directory, 'manifest.json'), manifestBytes);
  const lines = [...Object.entries(checksums), ['manifest.json', hash(manifestBytes)]]
    .map(([name, digest]) => `${digest}  ${name}`).join('\n');
  await fs.writeFile(path.join(directory, 'checksums.sha256'), `${lines}\n`);
}

async function main() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'edurag-corpus-test-'));
  try {
    await writeBundle(directory);
    await verifyBundle(directory);
    await fs.appendFile(path.join(directory, 'inventory.json'), 'tampered');
    await assert.rejects(() => verifyBundle(directory), (error) => error.code === 'CORPUS_CHECKSUM_MISMATCH');
    const previousMode = process.env.CORPUS_BOOTSTRAP;
    process.env.CORPUS_BOOTSTRAP = 'required';
    try {
      await assert.rejects(
        () => bootstrapCorpus({ bundleDirectory: path.join(directory, 'missing') }),
        (error) => error.code === 'CORPUS_BUNDLE_MISSING'
      );
      await assert.rejects(
        () => bootstrapCorpus({ bundleDirectory: directory }),
        (error) => error.code === 'CORPUS_CHECKSUM_MISMATCH'
      );
    } finally {
      if (previousMode === undefined) delete process.env.CORPUS_BOOTSTRAP;
      else process.env.CORPUS_BOOTSTRAP = previousMode;
    }
    console.log('CORPUS_BUNDLE_TEST_OK valid=pass tamper=blocked required_missing=blocked required_tamper=blocked');
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`CORPUS_BUNDLE_TEST_FAILED: ${error.message}`);
  process.exit(1);
});
