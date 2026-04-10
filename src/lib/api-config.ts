/**
 * 外部 API 端点配置
 *
 * 当独立部署 api-validate / api-generate 服务后，
 * 修改这里的地址即可将前端指向外部 API。
 *
 * 设为空字符串 '' 表示使用当前 Next.js 内置的 API 路由（默认行为）。
 */

// 逻辑校验服务地址（API1）
// 示例: 'http://localhost:3010' 或 'https://api-validate.example.com'
export const API_VALIDATE_BASE = process.env.NEXT_PUBLIC_API_VALIDATE_BASE || 'http://localhost:3010';
// export const API_VALIDATE_BASE = process.env.NEXT_PUBLIC_API_VALIDATE_BASE || 'https://5a9438af-8bc8-4fdc-8278-c6a896f14167.dev.coze.site';
// export const API_VALIDATE_BASE = process.env.NEXT_PUBLIC_API_VALIDATE_BASE || 'https://vnb4mwm2zn.coze.site';
// export const API_VALIDATE_BASE = process.env.NEXT_PUBLIC_API_VALIDATE_BASE || 'https://vnb4mwm2zn.coze.site';

// JSON 工作流生成服务地址（API2）
// 示例: 'http://localhost:3011' 或 'https://api-generate.example.com'
export const API_GENERATE_BASE = process.env.NEXT_PUBLIC_API_GENERATE_BASE || 'http://localhost:3010';
// export const API_GENERATE_BASE = process.env.NEXT_PUBLIC_API_GENERATE_BASE || 'https://5a9438af-8bc8-4fdc-8278-c6a896f14167.dev.coze.site';
// export const API_GENERATE_BASE = process.env.NEXT_PUBLIC_API_GENERATE_BASE || 'https://vnb4mwm2zn.coze.site';
// export const API_GENERATE_BASE = process.env.NEXT_PUBLIC_API_GENERATE_BASE || 'https://vnb4mwm2zn.coze.site';
/**
 * 拼接完整的 API URL
 * 如果 base 为空，使用相对路径（Next.js 内置路由）
 */
export function apiUrl(base: string, path: string): string {
  if (!base) return path;
  return `${base.replace(/\/+$/, '')}${path}`;
}
