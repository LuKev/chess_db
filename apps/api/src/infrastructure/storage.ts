import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { Readable } from "node:stream";
import type { AppConfig } from "../config.js";

export type ObjectStorage = {
  ensureBucket(): Promise<void>;
  uploadObject(params: {
    key: string;
    body: Readable;
    contentType: string;
  }): Promise<void>;
  getObjectStream(key: string): Promise<Readable>;
  close(): Promise<void>;
};

export function buildImportObjectKey(params: {
  userId: number;
  importJobId: number;
  fileName: string;
}): string {
  const safeName = params.fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `imports/user-${params.userId}/job-${params.importJobId}/${Date.now()}-${safeName}`;
}

export function createObjectStorage(config: AppConfig): ObjectStorage {
  const client = new S3Client({
    region: config.s3Region,
    endpoint: config.s3Endpoint,
    forcePathStyle: config.s3ForcePathStyle,
    credentials: {
      accessKeyId: config.s3AccessKey,
      secretAccessKey: config.s3SecretKey,
    },
  });

  let bucketEnsured = false;

  return {
    async ensureBucket(): Promise<void> {
      if (bucketEnsured) {
        return;
      }

      try {
        await client.send(new HeadBucketCommand({ Bucket: config.s3Bucket }));
      } catch {
        await client.send(new CreateBucketCommand({ Bucket: config.s3Bucket }));
      }

      bucketEnsured = true;
    },

    async uploadObject(params): Promise<void> {
      await this.ensureBucket();
      await client.send(
        new PutObjectCommand({
          Bucket: config.s3Bucket,
          Key: params.key,
          Body: params.body,
          ContentType: params.contentType,
        })
      );
    },

    async getObjectStream(key: string): Promise<Readable> {
      await this.ensureBucket();
      const result = await client.send(
        new GetObjectCommand({
          Bucket: config.s3Bucket,
          Key: key,
        })
      );

      if (!result.Body || typeof (result.Body as Readable)[Symbol.asyncIterator] !== "function") {
        throw new Error("Storage returned a non-stream response body");
      }

      return result.Body as Readable;
    },

    async close(): Promise<void> {
      client.destroy();
    },
  };
}
