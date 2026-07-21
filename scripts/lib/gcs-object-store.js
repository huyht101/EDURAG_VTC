'use strict';

const { Storage } = require('@google-cloud/storage');

function gcsError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function upstreamStatus(error) {
  return Number(error?.code || error?.statusCode || error?.response?.status || 0);
}

function mapReadError(error, missingCode = 'GCS_OBJECT_MISSING') {
  const status = upstreamStatus(error);
  if (status === 404) return gcsError(missingCode, 'The requested GCS release object does not exist.');
  if (status === 401 || status === 403) {
    return gcsError('GCS_READ_PERMISSION_REQUIRED', 'GCS reader permission or valid credentials are required.');
  }
  return gcsError('GCS_REMOTE_READ_FAILED', 'GCS object verification/download failed.');
}

class GcsObjectStore {
  constructor({ projectId, bucket, credentialsFile }) {
    this.bucketName = bucket;
    this.storage = new Storage({ projectId, keyFilename: credentialsFile });
    this.bucket = this.storage.bucket(bucket);
  }

  async metadata(objectKey) {
    try {
      const [metadata] = await this.bucket.file(objectKey).getMetadata();
      return {
        exists: true,
        sizeBytes: Number(metadata.size),
        sha256: String(metadata.metadata?.sha256 || '').toLowerCase(),
        documentId: String(metadata.metadata?.documentId || ''),
        kind: String(metadata.metadata?.kind || ''),
        releaseId: String(metadata.metadata?.releaseId || ''),
        generation: String(metadata.generation || '')
      };
    } catch (error) {
      if (upstreamStatus(error) === 404) return { exists: false };
      throw mapReadError(error);
    }
  }

  async uploadCreateOnly(sourceFile, objectKey, metadata) {
    try {
      await this.bucket.upload(sourceFile, {
        destination: objectKey,
        resumable: false,
        validation: 'crc32c',
        preconditionOpts: { ifGenerationMatch: 0 },
        metadata: {
          contentType: metadata.contentType,
          metadata: {
            ...(metadata.documentId === undefined ? {} : { documentId: String(metadata.documentId) }),
            kind: String(metadata.kind || ''),
            releaseId: String(metadata.releaseId || ''),
            sha256: metadata.sha256,
            schemaVersion: String(metadata.schemaVersion || ''),
            sizeBytes: String(metadata.sizeBytes)
          }
        }
      });
      return { uploaded: true };
    } catch (error) {
      const status = upstreamStatus(error);
      if (status === 412) return { uploaded: false, preconditionFailed: true };
      if (status === 401 || status === 403) {
        throw gcsError('GCS_WRITE_PERMISSION_REQUIRED', 'GCS writer permission is required to publish a corpus release.');
      }
      throw gcsError('GCS_UPLOAD_FAILED', 'GCS create-only upload failed.');
    }
  }

  async download(objectKey, destination) {
    try {
      await this.bucket.file(objectKey).download({ destination, validation: true });
    } catch (error) {
      throw mapReadError(error);
    }
  }
}

module.exports = { GcsObjectStore, gcsError };
