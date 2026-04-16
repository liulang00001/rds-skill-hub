/**
 * 数据存储目录 — 统一管理 skills / scripts 等持久化文件的存放路径
 *
 * 默认使用系统临时目录（FaaS 上为 /tmp），可通过环境变量 DATA_DIR 覆盖。
 * 本地开发若想写到项目根目录，设置 DATA_DIR=. 即可。
 */
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdirSync } from 'fs';

const BASE = process.env.DATA_DIR || join(tmpdir(), 'rds-data');

export const SKILLS_DIR = join(BASE, 'skills');
export const SCRIPTS_DIR = join(BASE, 'scripts');

/** 确保目录存在（仅在进程首次访问时创建） */
export function ensureDir(dir: string) {
  mkdirSync(dir, { recursive: true });
}
