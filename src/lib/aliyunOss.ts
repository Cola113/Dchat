import { createHmac } from 'crypto';

export type AliyunOssConfig = {
  region: string;
  bucket: string;
  accessKeyId: string;
  accessKeySecret: string;
  endpointHost: string;
  securityToken?: string;
};

export function getAliyunOssConfig(): AliyunOssConfig | null {
  const region = process.env.ALI_OSS_REGION?.trim();
  const bucket = process.env.ALI_OSS_BUCKET?.trim();
  const accessKeyId = process.env.ALI_OSS_ACCESS_KEY_ID?.trim();
  const accessKeySecret = process.env.ALI_OSS_ACCESS_KEY_SECRET?.trim();
  const securityToken = process.env.ALI_OSS_SECURITY_TOKEN?.trim();

  if (!region || !bucket || !accessKeyId || !accessKeySecret) return null;

  const endpointHost = (
    process.env.ALI_OSS_ENDPOINT?.trim() || `${bucket}.${region}.aliyuncs.com`
  ).replace(/^https?:\/\//, '').replace(/\/+$/, '');

  return {
    region,
    bucket,
    accessKeyId,
    accessKeySecret,
    endpointHost,
    securityToken: securityToken || undefined,
  };
}

export function getAliyunOssPrefix(envName: string, fallback: string) {
  return (process.env[envName] || fallback).trim().replace(/^\/+|\/+$/g, '') || fallback;
}

export function sanitizeOssSegment(value: string, fallback: string, maxLength = 120) {
  const sanitized = value
    .normalize('NFKD')
    .replace(/[\\/:*?"<>|\u0000-\u001F]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, maxLength);

  return sanitized || fallback;
}

function encodeOssKey(key: string) {
  return key.split('/').map(encodeURIComponent).join('/');
}

function buildCanonicalizedOssHeaders(headers: Record<string, string>) {
  return Object.entries(headers)
    .map(([key, value]) => [key.toLowerCase(), value.trim()] as const)
    .filter(([key]) => key.startsWith('x-oss-'))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}:${value}\n`)
    .join('');
}

function signOssRequest({
  config,
  method,
  key,
  dateOrExpires,
  contentType,
  ossHeaders,
}: {
  config: AliyunOssConfig;
  method: 'GET' | 'PUT';
  key: string;
  dateOrExpires: string;
  contentType: string;
  ossHeaders: Record<string, string>;
}) {
  const stringToSign = [
    method,
    '',
    contentType,
    dateOrExpires,
    `${buildCanonicalizedOssHeaders(ossHeaders)}/${config.bucket}/${key}`,
  ].join('\n');

  return createHmac('sha1', config.accessKeySecret).update(stringToSign).digest('base64');
}

export async function putObjectToAliyunOss({
  config,
  key,
  body,
  contentType,
}: {
  config: AliyunOssConfig;
  key: string;
  body: BodyInit;
  contentType: string;
}) {
  const date = new Date().toUTCString();
  const ossHeaders: Record<string, string> = {};
  if (config.securityToken) {
    ossHeaders['x-oss-security-token'] = config.securityToken;
  }

  const signature = signOssRequest({
    config,
    method: 'PUT',
    key,
    dateOrExpires: date,
    contentType,
    ossHeaders,
  });

  const headers: Record<string, string> = {
    Authorization: `OSS ${config.accessKeyId}:${signature}`,
    Date: date,
    'Content-Type': contentType,
    ...ossHeaders,
  };

  const response = await fetch(`https://${config.endpointHost}/${encodeOssKey(key)}`, {
    method: 'PUT',
    headers,
    body,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`OSS PutObject failed: ${response.status} ${errorText}`);
  }
}

export function createAliyunOssReadUrl({
  config,
  key,
  expiresInSeconds = 24 * 60 * 60,
}: {
  config: AliyunOssConfig;
  key: string;
  expiresInSeconds?: number;
}) {
  const expires = String(Math.floor(Date.now() / 1000) + expiresInSeconds);
  const ossHeaders: Record<string, string> = {};
  const signature = signOssRequest({
    config,
    method: 'GET',
    key,
    dateOrExpires: expires,
    contentType: '',
    ossHeaders,
  });

  const params = new URLSearchParams({
    OSSAccessKeyId: config.accessKeyId,
    Expires: expires,
    Signature: signature,
  });

  if (config.securityToken) {
    params.set('security-token', config.securityToken);
  }

  return `https://${config.endpointHost}/${encodeOssKey(key)}?${params.toString()}`;
}
