'use strict';

const fs = require('fs');
const { Storage } = require('@google-cloud/storage');
const { normalizeRemoteReadError } = require('./corpus-bootstrap-errors');

function gcsError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function mapReadError(error, missingCode = 'GCS_OBJECT_MISSING') {
  return normalizeRemoteReadError(error, missingCode);
}

function upstreamStatus(error) {
  return Number(error?.code || error?.statusCode || error?.response?.status || 0);
}

class GcsObjectStore {
  constructor({ projectId, bucket, credentialsFile, privateTargetOwnerAttestation }) {
    this.projectId = projectId;
    this.bucketName = bucket;
    this.credentialsFile = credentialsFile;
    this.privateTargetOwnerAttestation = privateTargetOwnerAttestation;
    this.storage = new Storage({ projectId, keyFilename: credentialsFile });
    this.bucket = this.storage.bucket(bucket);
  }

  assertOwnerAttestation() {
    const expected = `${this.projectId}/${this.bucketName}`;
    if (this.privateTargetOwnerAttestation !== expected) {
      throw gcsError(
        'GCS_BUCKET_PRIVACY_UNVERIFIED',
        'Bucket privacy introspection was denied and no matching Owner attestation is configured.'
      );
    }
    let credential;
    try {
      credential = JSON.parse(fs.readFileSync(this.credentialsFile, 'utf8'));
    } catch (_error) {
      throw gcsError('GCS_CREDENTIAL_INVALID', 'GCS credential identity could not be verified.');
    }
    const identity = String(credential?.client_email || '').trim().toLowerCase();
    const localPart = identity.split('@', 1)[0];
    if (credential?.type !== 'service_account'
      || credential?.project_id !== this.projectId
      || !/(?:^|[-_])corpus[-_]?writer$/.test(localPart)) {
      throw gcsError(
        'GCS_WRITER_IDENTITY_MISMATCH',
        'Owner-attested publishing requires the configured corpus-writer service account.'
      );
    }
    console.warn(
      `GCS_PRIVATE_TARGET_OWNER_ATTESTED project=${this.projectId} bucket=${this.bucketName} identity=corpus-writer`
    );
  }

  async assertPrivateTarget() {
    let metadata;
    try {
      [metadata] = await this.bucket.getMetadata();
    } catch (error) {
      const status = upstreamStatus(error);
      if (status === 403) {
        this.assertOwnerAttestation();
        return;
      }
      if (status === 401) {
        throw gcsError(
          'GCS_BUCKET_PRIVACY_UNVERIFIED',
          'Bucket privacy verification was rejected because the credential is not authenticated.'
        );
      }
      throw gcsError('GCS_BUCKET_PRIVACY_UNVERIFIED', 'Target bucket privacy metadata is unavailable.');
    }
    if (metadata.iamConfiguration?.publicAccessPrevention === 'enforced') return;

    let policy;
    try {
      [policy] = await this.bucket.iam.getPolicy({ requestedPolicyVersion: 3 });
    } catch (_error) {
      throw gcsError(
        'GCS_BUCKET_PRIVACY_UNVERIFIED',
        'Public access prevention is not enforced and bucket IAM cannot be verified.'
      );
    }
    const publicBinding = (policy.bindings || []).some((binding) =>
      (binding.members || []).some((member) => member === 'allUsers' || member === 'allAuthenticatedUsers'));
    if (publicBinding) {
      throw gcsError(
        'GCS_PUBLIC_BUCKET_BLOCKED',
        'Simplified operator-reviewed corpus publishing is not allowed for a public bucket.'
      );
    }
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

  async list(objectPrefix) {
    try {
      const prefix = `${String(objectPrefix).replace(/\/+$/, '')}/`;
      const [files] = await this.bucket.getFiles({ prefix });
      return files.map((file) => ({
        objectKey: file.name,
        sizeBytes: Number(file.metadata?.size || 0),
        generation: String(file.metadata?.generation || '')
      }));
    } catch (error) {
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
