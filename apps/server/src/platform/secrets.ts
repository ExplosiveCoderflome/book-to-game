import { randomBytes, randomUUID, createCipheriv, createDecipheriv } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, linkSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { AppError } from '../shared/errors.js';
import type { SecretCodec } from '../modules/model-settings/index.js';

export class LocalSecretCodec implements SecretCodec {
  private readonly filename: string;
  constructor(private readonly dataDir: string) {this.filename = path.join(dataDir, 'model-key.bin');}
  private key(create: boolean): Buffer {
    try {
      const key = readFileSync(this.filename);
      if (key.length !== 32) throw new Error('invalid key');
      return key;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || !create) {
        throw new AppError('MODEL_KEY_UNAVAILABLE', '无法读取模型密钥保护文件，请恢复数据目录中的 model-key.bin；若文件丢失，可在页面重新填写 API Key', 503);
      }
    }
    mkdirSync(this.dataDir, {recursive: true});
    const temporary = path.join(this.dataDir, `model-key-${randomUUID()}.tmp`);
    writeFileSync(temporary, randomBytes(32), {flag: 'wx', mode: 0o600});
    try {linkSync(temporary, this.filename);}
    catch (error) {if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;}
    finally {unlinkSync(temporary);}
    return this.key(false);
  }
  encrypt(value: string): string {
    const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', this.key(true), iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), encrypted].map(b => b.toString('base64')).join('.');
  }
  decrypt(value: string): string {
    const key = this.key(false);
    try {
      const [iv, tag, encrypted] = value.split('.').map(p => Buffer.from(p, 'base64'));
      const decipher = createDecipheriv('aes-256-gcm', key, iv); decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
    } catch {throw new AppError('MODEL_KEY_UNAVAILABLE', '模型 API Key 无法解密，请在模型设置中重新填写', 503);}
  }
}
