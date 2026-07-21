'use strict';

const crypto = require('crypto');
const fsp = require('fs/promises');
const path = require('path');

const { compose, composeProject, docker } = require('../remote-test-utils');
const { releaseError, validateLocalStorageKey } = require('./corpus-release');

const APP_UPLOAD_DESTINATION = '/usr/src/app/uploads';

function dockerResultSucceeded(result) {
  return typeof result === 'string' || (result && result.status === 0);
}

function helperPath(storageKey) {
  return `/uploads/${validateLocalStorageKey(storageKey)}`;
}

class DockerUploadVolume {
  constructor(options = {}) {
    this.compose = options.compose || compose;
    this.docker = options.docker || docker;
    this.project = options.composeProject || composeProject;
  }

  resolve() {
    try {
      const containerId = String(this.compose(['ps', '-aq', 'app'], { allowFailure: true }) || '').trim();
      if (containerId) {
        const mounts = JSON.parse(this.docker(['inspect', '--format', '{{json .Mounts}}', containerId]));
        const mount = mounts.find((item) => item.Type === 'volume'
          && item.Destination === APP_UPLOAD_DESTINATION);
        if (mount?.Name) return { resolvable: true, volumeName: mount.Name };
      }
      const fallback = `${this.project}_uploads_data`;
      const inspected = this.docker(['volume', 'inspect', fallback], { allowFailure: true });
      if (dockerResultSucceeded(inspected)) return { resolvable: true, volumeName: fallback };
      return { resolvable: false, reason: 'UPLOAD_VOLUME_MISSING' };
    } catch (_error) {
      return { resolvable: false, reason: 'DOCKER_UNAVAILABLE' };
    }
  }

  appImage() {
    const image = String(this.compose(['images', '-q', 'app'], { allowFailure: true }) || '').trim()
      .split(/\r?\n/).filter(Boolean)[0];
    if (!image) {
      throw releaseError(
        'CORPUS_APP_IMAGE_MISSING',
        'Build the remote app image before accessing the upload volume.'
      );
    }
    return image;
  }

  ensure() {
    let resolved = this.resolve();
    if (resolved.resolvable) return resolved;

    // A standalone corpus:restore starts only MySQL and Qdrant. Create the
    // stopped app container so Compose materializes the canonical upload
    // volume and we can discover its exact name without guessing.
    this.compose(['create', 'app']);
    resolved = this.resolve();
    if (!resolved.resolvable) {
      throw releaseError('CORPUS_UPLOAD_VOLUME_UNAVAILABLE', 'Docker upload volume is unavailable.');
    }
    return resolved;
  }

  async withHelper(callback) {
    const resolved = this.ensure();
    const name = `edurag-corpus-release-${crypto.randomUUID()}`;
    const image = this.appImage();
    try {
      this.docker([
        'run', '-d', '--name', name,
        '-v', `${resolved.volumeName}:/uploads`,
        image, 'node', '-e', 'setInterval(() => {}, 1000)'
      ]);
      return await callback(name, resolved.volumeName);
    } finally {
      this.docker(['rm', '-f', name], { allowFailure: true });
    }
  }

  async stat(storageKey) {
    return this.withHelper(async (helper) => {
      const target = helperPath(storageKey);
      const script = [
        "const fs=require('fs'),crypto=require('crypto');",
        'const p=process.argv[1];',
        "if(!fs.existsSync(p)){console.log(JSON.stringify({exists:false}));process.exit(0)}",
        'const s=fs.statSync(p);',
        "if(!s.isFile()){console.error('NOT_FILE');process.exit(2)}",
        "const h=crypto.createHash('sha256');",
        "const r=fs.createReadStream(p);r.on('data',c=>h.update(c));",
        "r.on('end',()=>console.log(JSON.stringify({exists:true,sizeBytes:s.size,sha256:h.digest('hex')})));"
      ].join('');
      try {
        return JSON.parse(this.docker(['exec', helper, 'node', '-e', script, target]));
      } catch (_error) {
        throw releaseError('CORPUS_ORIGINAL_LOCAL_READ_FAILED', 'Cannot inspect an original in the upload volume.');
      }
    });
  }

  async copyOut(storageKey, destination) {
    await this.withHelper(async (helper) => {
      const target = helperPath(storageKey);
      const exists = this.docker(['exec', helper, 'test', '-f', target], { allowFailure: true });
      if (!dockerResultSucceeded(exists)) {
        throw releaseError('CORPUS_ORIGINAL_SOURCE_MISSING', 'Approved original is missing from the upload volume.');
      }
      try {
        this.docker(['cp', `${helper}:${target}`, destination]);
      } catch (_error) {
        throw releaseError('CORPUS_ORIGINAL_LOCAL_READ_FAILED', 'Cannot copy the approved original from the upload volume.');
      }
    });
  }

  async putAtomic(sourceFile, storageKey, expected) {
    return this.withHelper(async (helper, volumeName) => {
      const target = helperPath(storageKey);
      const statScript = [
        "const fs=require('fs'),crypto=require('crypto');",
        'const p=process.argv[1];',
        "if(!fs.existsSync(p)){console.log(JSON.stringify({exists:false}));process.exit(0)}",
        'const s=fs.statSync(p);',
        "const h=crypto.createHash('sha256');const r=fs.createReadStream(p);",
        "r.on('data',c=>h.update(c));r.on('end',()=>console.log(JSON.stringify({exists:true,sizeBytes:s.size,sha256:h.digest('hex')})));"
      ].join('');
      const current = JSON.parse(this.docker(['exec', helper, 'node', '-e', statScript, target]));
      if (current.exists) {
        if (current.sha256 === expected.sha256 && current.sizeBytes === expected.sizeBytes) {
          return { restored: false, skipped: true, volumeName };
        }
        throw releaseError(
          'CORPUS_ORIGINAL_LOCAL_MISMATCH',
          'Existing local original differs from the approved checksum; refusing overwrite.'
        );
      }
      const temporary = `/uploads/.corpus-release-${crypto.randomUUID()}`;
      try {
        this.docker(['cp', sourceFile, `${helper}:${temporary}`]);
        const finalize = [
          "const fs=require('fs'),path=require('path');",
          'const [tmp,target]=process.argv.slice(1);',
          "if(fs.existsSync(target)){console.error('TARGET_EXISTS');process.exit(3)}",
          'fs.mkdirSync(path.dirname(target),{recursive:true});',
          'fs.renameSync(tmp,target);'
        ].join('');
        this.docker(['exec', helper, 'node', '-e', finalize, temporary, target]);
      } catch (error) {
        this.docker(['exec', helper, 'rm', '-f', temporary], { allowFailure: true });
        if (error.code) throw error;
        throw releaseError('CORPUS_ORIGINAL_LOCAL_WRITE_FAILED', 'Atomic upload-volume restore failed.');
      }
      const restored = JSON.parse(this.docker(['exec', helper, 'node', '-e', statScript, target]));
      if (!restored.exists || restored.sha256 !== expected.sha256
        || restored.sizeBytes !== expected.sizeBytes) {
        throw releaseError('CORPUS_ORIGINAL_LOCAL_VERIFY_FAILED', 'Restored original failed local verification.');
      }
      return { restored: true, skipped: false, volumeName };
    });
  }
}

module.exports = { APP_UPLOAD_DESTINATION, DockerUploadVolume };
